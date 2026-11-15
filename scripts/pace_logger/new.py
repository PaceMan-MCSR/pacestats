#!/usr/bin/env python3
"""PaceMan ingestion with a durable local outbox and one MySQL writer (Python 3.10+)."""
from __future__ import annotations

import argparse
import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
import json
import logging
import math
import os
from pathlib import Path
import random
import signal
import sqlite3
import sys
from threading import Event as ThreadEvent
import time
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

def bootstrap_runtime(script_path: "Path", install: bool) -> None:
    """Use only the script's private environment; install solely on request.

    This function runs before any third-party imports.  A normal service start
    never downloads packages or changes its environment.
    """
    import json
    import os
    from pathlib import Path
    import shlex
    import shutil
    import subprocess
    import sys
    import venv

    script_path = Path(script_path).resolve()
    setup_command = "python3 {} --install".format(shlex.quote(str(script_path)))

    def fail(message: str) -> None:
        raise SystemExit("{}\nRun: {}".format(message, setup_command))

    if sys.version_info < (3, 10):
        fail("This logger needs Python 3.10 or newer. Install a supported Python first.")

    environment = script_path.parent / ".new-venv"
    executable = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    is_current_environment = Path(sys.prefix).resolve() == environment.resolve()

    if not executable.is_file() or not (environment / "pyvenv.cfg").is_file():
        if not install:
            fail("The logger's private Python environment has not been installed.")
        print("Creating the logger's private Python environment at {}".format(environment), flush=True)
        try:
            # Debian/Ubuntu may ship venv without the ensurepip wheels. Create
            # the interpreter first, then repair pip explicitly below. This also
            # supports environments left incomplete by an earlier setup attempt.
            venv.EnvBuilder(with_pip=False, system_site_packages=False).create(str(environment))
        except (OSError, subprocess.SubprocessError) as exc:
            fail(
                "Could not create the private Python environment: {}. "
                "On Debian/Ubuntu, install python3-venv (or python3.10-venv for "
                "Python 3.10) and retry.".format(exc)
            )

    # Probe with the target interpreter, not the caller's global packages.  The
    # prefix check also prevents an invalid environment causing an exec loop.
    probe_program = "\n".join((
        "import importlib.metadata, importlib.util, json, sys",
        "versions = {}",
        "for name in json.loads(sys.argv[1]):",
        "    try:",
        "        versions[name] = importlib.metadata.version(name)",
        "    except importlib.metadata.PackageNotFoundError:",
        "        versions[name] = None",
        "print(json.dumps({'prefix': sys.prefix, 'python': list(sys.version_info[:3]), 'versions': versions, 'pip': importlib.util.find_spec('pip') is not None}))",
    ))
    pins = {
        "aiohttp": "3.14.5",
        "mysql-connector-python": "9.7.0",
        "python-dotenv": "1.2.4",
        "websockets": "16.1.1",
        "twitchAPI": "4.5.0",
    }
    # Include async-timeout in the probe even when the caller is a newer Python:
    # an already installed environment may still use Python 3.10.
    probe_names = list(pins) + ["async-timeout"]

    def probe() -> dict:
        try:
            result = subprocess.run(
                [str(executable), "-I", "-c", probe_program, json.dumps(probe_names)],
                check=False, capture_output=True, text=True, timeout=60,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            fail("Could not run the private Python environment: {}.".format(exc))
        if result.returncode:
            fail(
                "The private Python environment could not be checked. "
                "Its interpreter may need to be repaired. {}".format(result.stderr.strip())
            )
        try:
            status = json.loads(result.stdout)
            version = tuple(status["python"])
            prefix = Path(status["prefix"]).resolve()
            versions = status["versions"]
            if len(version) != 3 or not isinstance(versions, dict) or type(status["pip"]) is not bool:
                raise ValueError("invalid environment probe result")
        except (TypeError, KeyError, ValueError, OSError) as exc:
            fail("The private Python environment returned an invalid check: {}.".format(exc))
        if prefix != environment.resolve():
            fail("The private Python environment points to a different directory and must be repaired.")
        if version < (3, 10):
            fail("The private Python environment needs Python 3.10 or newer; recreate it with a supported Python.")
        if version < (3, 11):
            pins["async-timeout"] = "5.0.1"
        else:
            pins.pop("async-timeout", None)
        return status

    status = probe()
    if install and not status["pip"]:
        print("Repairing pip in the logger's existing private Python environment", flush=True)
        ensurepip_command = [str(executable), "-I", "-m", "ensurepip", "--upgrade", "--default-pip"]

        def run_ensurepip():
            try:
                subprocess.run(ensurepip_command, check=False, capture_output=True, text=True, timeout=120)
            except (OSError, subprocess.SubprocessError):
                pass  # The subsequent probe distinguishes success from failure.

        run_ensurepip()
        status = probe()
        if not status["pip"]:
            package = "python{}.{}-venv".format(*status["python"][:2])
            apt = shutil.which("apt-get")
            if sys.platform != "linux" or not hasattr(os, "geteuid") or os.geteuid() != 0 or apt is None:
                fail("pip is missing and ensurepip could not repair it. On Debian/Ubuntu, run as root: "
                     "apt-get update && apt-get install --yes {}. Then rerun setup; the existing environment can be kept.".format(package))
            print("Installing {} to provide the missing pip bootstrap support".format(package), flush=True)
            for command in ([apt, "update"], [apt, "install", "--yes", "--no-install-recommends", package]):
                try:
                    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=600,
                                            env=dict(os.environ, DEBIAN_FRONTEND="noninteractive"))
                except (OSError, subprocess.SubprocessError):
                    fail("Could not install {}. Run apt-get update and apt-get install --yes {} as root, then retry setup.".format(package, package))
                if result.returncode:
                    fail("System package setup failed. Run apt-get update and apt-get install --yes {} as root, then retry setup.".format(package))
            run_ensurepip()
            status = probe()
            if not status["pip"]:
                fail("pip is still missing after installing {}. Run {} manually, then retry setup. "
                     "The private environment has been kept.".format(package, shlex.join(ensurepip_command)))

    versions = status["versions"]
    mismatches = [name for name, version in pins.items() if versions.get(name) != version]
    if mismatches:
        if not install:
            fail("The logger's private environment needs these dependencies installed or updated: {}.".format(", ".join(mismatches)))
        print("Installing the logger's pinned dependencies in {}".format(environment), flush=True)
        try:
            result = subprocess.run(
                [str(executable), "-I", "-m", "pip", "--disable-pip-version-check", "install", "--no-input", "--upgrade"]
                + ["{}=={}".format(name, version) for name, version in pins.items()],
                check=False, timeout=900,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            fail("Dependency installation failed: {}. Check internet access and available disk space.".format(exc))
        if result.returncode:
            fail("Dependency installation failed. Check the pip error above and internet access, then rerun --install. The private environment has been kept.")
        versions = probe()["versions"]
        mismatches = [name for name, version in pins.items() if versions.get(name) != version]
        if mismatches:
            fail("The installed dependency versions could not be verified: {}.".format(", ".join(mismatches)))

    if not is_current_environment:
        try:
            os.execv(str(executable), [str(executable), str(script_path), *sys.argv[1:]])
        except OSError as exc:
            fail("Could not start the logger in its private Python environment: {}.".format(exc))


if __name__ == "__main__":
    bootstrap_runtime(Path(__file__), install=("--install" in sys.argv))

import aiohttp
from dotenv import load_dotenv
import mysql.connector
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

if sys.version_info >= (3, 11):
    from asyncio import timeout as timeout_after
else:
    from async_timeout import timeout as timeout_after

LOG = logging.getLogger("pace_logger")
MAX_WS_MESSAGE_SIZE = 1_048_576
MAX_WS_FRAGMENTS = 4096
SPLITS = {
    "nether": "rsg.enter_nether", "bastion": "rsg.enter_bastion",
    "fortress": "rsg.enter_fortress", "first_portal": "rsg.first_portal",
    "second_portal": "rsg.second_portal", "stronghold": "rsg.enter_stronghold",
    "end": "rsg.enter_end", "finish": "rsg.credits",
}
CONTEXT = {
    "obtainIron": "rsg.obtain_iron_ingot", "obtainPick": "rsg.obtain_iron_pickaxe",
    "obtainLava": "rsg.obtain_lava_bucket", "distractPiglin": "rsg.distract_piglin",
    "lootBastion": "rsg.loot_bastion", "obtainObsidian": "rsg.obtain_obsidian",
    "obtainCryingObsidian": "rsg.obtain_crying_obsidian", "obtainRod": "rsg.obtain_blaze_rod",
}
INVENTORY = {
    "bastion": "rsg.enter_bastion", "fort": "rsg.enter_fortress",
    "first_portal": "rsg.first_portal", "stronghold": "rsg.enter_stronghold",
}
ITEMS = {"Pearls": "minecraft:ender_pearl", "Obsidian": "minecraft:obsidian", "Rods": "minecraft:blaze_rod"}
TIME_COLUMNS = tuple(SPLITS) + tuple(f"{name}Rta" for name in SPLITS) + tuple(CONTEXT)
ITEM_COLUMNS = tuple(f"{prefix}{suffix}" for prefix in INVENTORY for suffix in ITEMS)
RUN_COLUMNS = ("worldId", "uuid", "nickname", "twitch") + TIME_COLUMNS + ITEM_COLUMNS + ("sourceLastUpdatedMs",)
TRANSIENT_ERRNOS = {1040, 1042, 1047, 1053, 1158, 1159, 1160, 1161, 1205, 1213, 2002, 2003, 2006, 2013, 2055}


class PayloadError(ValueError):
    """An invalid upstream record; never put this record into the outbox."""


class SchemaError(RuntimeError):
    pass


def bounded_int(value: Any, name: str, maximum: int = 2_147_483_647, *, optional: bool = True) -> int | None:
    if value is None and optional:
        return None
    if type(value) is not int or not 0 <= value <= maximum:
        raise PayloadError(f"{name} must be an integer between 0 and {maximum}")
    return value


def text_value(value: Any, name: str, maximum: int, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise PayloadError(f"{name} must be nonempty text of at most {maximum} characters")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise PayloadError(f"{name} is not valid UTF-8 text") from error
    return value


def run_key(data: dict[str, Any]) -> tuple[str, str]:
    if not isinstance(data, dict) or not isinstance(data.get("user"), dict):
        raise PayloadError("run and user must be objects")
    return (text_value(data.get("worldId"), "worldId", 64),
            text_value(data["user"].get("uuid"), "uuid", 36))


def allowed_run(data: dict[str, Any]) -> bool:
    for name in ("isHidden", "isCheated"):
        if name in data and type(data[name]) is not bool:
            raise PayloadError(f"{name} must be boolean")
    return data.get("gameVersion", "1.16.1") == "1.16.1" and not data.get("isHidden", False) and not data.get("isCheated", False)


def event_map(data: dict[str, Any], name: str) -> tuple[dict[str, dict], str | None]:
    events = data.get(name, [])
    if events is None:
        events = []
    if not isinstance(events, list) or len(events) > 1024:
        raise PayloadError(f"{name} must be a list of at most 1024 events")
    result = {}
    last = None
    for event in events:
        if not isinstance(event, dict):
            raise PayloadError(f"{name} contains a non-object")
        last = text_value(event.get("eventId"), "eventId", 128)
        # Match the original first-event semantics when an ID repeats.
        result.setdefault(last, event)
    return result, last


def normalize_run(data: dict[str, Any], received_at: float | None = None) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        raise PayloadError("run must be an object")
    if not allowed_run(data):
        return None
    world, uuid = run_key(data)
    source = bounded_int(data.get("lastUpdated"), "lastUpdated", 9_223_372_036_854_775_807, optional=False)
    received_at = time.time() if received_at is None else received_at
    if source > (received_at + 60) * 1000:
        raise PayloadError("lastUpdated is more than 60 seconds in the future")
    events, last = event_map(data, "eventList")
    context, _ = event_map(data, "contextEventList")
    row = {"worldId": world, "uuid": uuid,
           "nickname": text_value(data.get("nickname"), "nickname", 16, optional=True),
           "twitch": text_value(data["user"].get("liveAccount"), "liveAccount", 64, optional=True),
           "sourceLastUpdatedMs": source}
    for column, event_id in SPLITS.items():
        event = events.get(event_id, {})
        row[column] = bounded_int(event.get("igt"), f"{event_id}.igt")
        row[f"{column}Rta"] = bounded_int(event.get("rta"), f"{event_id}.rta")
    for column, event_id in CONTEXT.items():
        row[column] = bounded_int(context.get(event_id, {}).get("igt"), f"{event_id}.igt")
    item_data = data.get("itemData")
    item_data = {} if item_data is None else item_data
    if not isinstance(item_data, dict):
        raise PayloadError("itemData must be an object")
    counts_present = item_data.get("estimatedCounts") is not None
    counts = item_data.get("estimatedCounts")
    counts = {} if counts is None else counts
    if not isinstance(counts, dict):
        raise PayloadError("estimatedCounts must be an object")
    for prefix, event_id in INVENTORY.items():
        for suffix, item in ITEMS.items():
            # The tracker serializes only positive estimates; absent keys in an
            # explicitly supplied map mean zero. An absent map remains unknown.
            row[f"{prefix}{suffix}"] = bounded_int(counts.get(item, 0), item, 32767) if last == event_id and counts_present else None
    raw_events = data.get("eventList") or []
    anchor_rta = bounded_int(raw_events[-1].get("rta"), "last event.rta") if raw_events else None
    return {"row": row, "received_at": received_at, "last_event": last, "anchor_rta": anchor_rta}


def upsert_statement() -> str:
    columns = ", ".join(f"`{column}`" for column in RUN_COLUMNS)
    assignments = []
    for column in ("nickname", "twitch") + TIME_COLUMNS + ITEM_COLUMNS:
        value = f"COALESCE(`{column}`, %s)" if column in ITEM_COLUMNS else f"COALESCE(%s, `{column}`)"
        assignments.append(f"`{column}`=IF(`sourceLastUpdatedMs` IS NULL OR %s >= `sourceLastUpdatedMs`, {value}, `{column}`)")
    assignments.append("`realUpdated`=IF(`sourceLastUpdatedMs` IS NULL OR %s >= `sourceLastUpdatedMs`, CURRENT_TIMESTAMP, `realUpdated`)")
    # MySQL evaluates assignments left to right. Update the ordering watermark LAST.
    assignments.append("`sourceLastUpdatedMs`=GREATEST(COALESCE(`sourceLastUpdatedMs`, 0), %s)")
    return f"INSERT INTO `pace` ({columns}, `realUpdated`) VALUES ({', '.join(['%s'] * len(RUN_COLUMNS))}, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE " + ", ".join(assignments)


UPSERT_SQL = upsert_statement()


def upsert_values(row: dict[str, Any]) -> tuple:
    values = [row[column] for column in RUN_COLUMNS]
    for column in ("nickname", "twitch") + TIME_COLUMNS + ITEM_COLUMNS:
        values.extend((row["sourceLastUpdatedMs"], row[column]))
    values.extend((row["sourceLastUpdatedMs"], row["sourceLastUpdatedMs"]))
    return tuple(values)


@dataclass(frozen=True)
class Config:
    ws_url: str
    ws_token: str = field(repr=False)
    db: dict = field(repr=False)
    ars_url: str = "http://localhost:8001/api/ars/liveruns"
    spool_path: Path = Path("pace-outbox.sqlite3")
    heartbeat: Path = Path("lastPace")
    poll_interval: float = 2.0
    spool_limit: int = 100_000
    batch_size: int = 50
    client_id: str | None = None
    client_secret: str | None = field(default=None, repr=False)

    @classmethod
    def from_env(cls) -> Config:
        def required(name: str) -> str:
            value = os.getenv(name)
            if not value:
                raise ValueError(f"{name} is required")
            return value

        def number(name: str, default: str, low: float, high: float) -> float:
            value = float(os.getenv(name, default))
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{name} must be between {low} and {high}")
            return value

        def integer(name: str, default: str, low: int, high: int) -> int:
            value = number(name, default, low, high)
            if not value.is_integer():
                raise ValueError(f"{name} must be a whole number")
            return int(value)

        ws_url = required("PACEMAN_WS_SERVER")
        ars_url = os.getenv("ARS_URL", "http://localhost:8001/api/ars/liveruns")
        if urlsplit(ws_url).scheme not in {"ws", "wss"} or not urlsplit(ws_url).hostname:
            raise ValueError("PACEMAN_WS_SERVER must be a ws:// or wss:// URL")
        if urlsplit(ars_url).scheme not in {"http", "https"} or not urlsplit(ars_url).hostname:
            raise ValueError("ARS_URL must be an http:// or https:// URL")
        token = required("PACEMAN_WS_TOKEN")
        if any(c in token for c in "\r\n"):
            raise ValueError("PACEMAN_WS_TOKEN contains a newline")
        db = dict(host=required("DB_HOST"), database=required("DB_NAME"), user=required("DB_USERNAME"),
                  password=os.getenv("DB_PASSWORD", ""), port=integer("DB_PORT", "3306", 1, 65535),
                  connection_timeout=10, read_timeout=15, write_timeout=15, use_pure=True,
                  autocommit=False, charset="utf8mb4", time_zone="+00:00",
                  sql_mode="STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION")
        if os.getenv("DB_SSL_CA"):
            db.update(ssl_ca=os.environ["DB_SSL_CA"], ssl_verify_cert=True, ssl_verify_identity=True)
        if os.getenv("DB_UNIX_SOCKET"):
            db["unix_socket"] = os.environ["DB_UNIX_SOCKET"]
        client_id, secret = os.getenv("TWITCH_CLIENT_ID"), os.getenv("TWITCH_CLIENT_SECRET")
        if bool(client_id) != bool(secret):
            raise ValueError("Set both TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, or neither")
        return cls(ws_url, token, db, ars_url, Path(os.getenv("PACE_SPOOL_PATH", "pace-outbox.sqlite3")).resolve(),
                   Path(os.getenv("HEARTBEAT_FILE", "lastPace")).resolve(),
                   number("PACE_UPDATE_INTERVAL", "2", 0.1, 3600),
                   integer("PACE_SPOOL_LIMIT", "100000", 1, 10_000_000),
                   integer("PACE_DB_BATCH_SIZE", "50", 1, 1000), client_id, secret)


class ThreadOwner:
    """Every call for a resource runs on its one dedicated thread."""
    def __init__(self, name: str):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=name)

    async def call(self, function, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, partial(function, *args))

    async def shutdown(self):
        await self.call(self.close)
        self.executor.shutdown(wait=True)


class Outbox(ThreadOwner):
    def __init__(self, path: Path, limit: int):
        super().__init__("pace-outbox")
        self.path, self.limit = path, limit
        self.connection = None

    def open(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, timeout=1)
        # EXCLUSIVE + WAL holds the lock until close: a second logger fails startup.
        self.connection.execute("PRAGMA locking_mode=EXCLUSIVE")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS active (world TEXT NOT NULL, uuid TEXT NOT NULL, PRIMARY KEY(world, uuid));
            CREATE TABLE IF NOT EXISTS terminal (world TEXT NOT NULL, uuid TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(world, uuid));
        """)
        self.count = self.connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]

    def append(self, kind: str, payload: dict) -> bool:
        if self.count >= self.limit:
            return False
        with self.connection:
            if kind == "run":
                row = payload["row"]
                terminal = self.connection.execute("SELECT token FROM terminal WHERE world=? AND uuid=?", (row["worldId"], row["uuid"])).fetchone()
                if terminal:
                    payload = dict(payload, terminal_token=terminal[0])
            self.connection.execute("INSERT INTO jobs(kind, payload) VALUES (?, ?)", (kind, json.dumps(payload, separators=(",", ":"))))
        self.count += 1
        return True

    def snapshot(self, current: set[tuple[str, str]]) -> bool:
        previous = set(self.connection.execute("SELECT world, uuid FROM active"))
        ended = previous - current
        if self.count + len(ended) > self.limit:
            return False
        transitions = [(world, uuid, uuid4().hex) for world, uuid in sorted(ended)]
        with self.connection:
            self.connection.executemany("INSERT INTO jobs(kind, payload) VALUES ('touch', ?)",
                                        [(json.dumps({"worldId": world, "uuid": uuid, "terminal_token": token}),) for world, uuid, token in transitions])
            self.connection.executemany("INSERT OR REPLACE INTO terminal(world, uuid, token) VALUES (?, ?, ?)", transitions)
            self.connection.executemany("DELETE FROM active WHERE world=? AND uuid=?", sorted(ended))
            self.connection.executemany("INSERT OR IGNORE INTO active(world, uuid) VALUES (?, ?)", sorted(current - previous))
        self.count += len(ended)
        return True

    def peek(self, limit: int) -> list[tuple[int, str, dict]]:
        return [(seq, kind, json.loads(payload)) for seq, kind, payload in
                self.connection.execute("SELECT id, kind, payload FROM jobs ORDER BY id LIMIT ?", (limit,))]

    def acknowledge(self, through_id: int, resolved: tuple | list[tuple[str, str, str]] = ()):
        with self.connection:
            deleted = self.connection.execute("DELETE FROM jobs WHERE id<=?", (through_id,)).rowcount
            self.connection.executemany("DELETE FROM terminal WHERE world=? AND uuid=? AND token=?", resolved)
        self.count -= deleted

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None


class Database(ThreadOwner):
    def __init__(self, config: Config):
        super().__init__("pace-mysql")
        self.config = config
        self.connection = None
        self.stop_event = ThreadEvent()

    def open(self):
        self.close()
        self.connection = mysql.connector.connect(**self.config.db)
        with self.connection.cursor(dictionary=True) as cursor:
            cursor.execute("SHOW COLUMNS FROM pace")
            column_info = {row["Field"]: row for row in cursor.fetchall()}
            columns = set(column_info)
            if not set(RUN_COLUMNS + ("realUpdated", "vodId", "vodOffset")).issubset(columns):
                raise SchemaError("pace is missing required columns; see migration.sql")
            if not column_info["sourceLastUpdatedMs"]["Type"].lower().startswith("bigint"):
                raise SchemaError("sourceLastUpdatedMs must be BIGINT epoch milliseconds")
            cursor.execute("SHOW INDEX FROM pace")
            indexes = {}
            for row in cursor.fetchall():
                if not row["Non_unique"]:
                    indexes.setdefault(row["Key_name"], []).append(row)
            valid = False
            for name, rows in indexes.items():
                names = {row["Column_name"] for row in rows}
                if names == {"worldId", "uuid"} and len(rows) == 2 and all(row["Sub_part"] is None for row in rows):
                    valid = True
                elif name != "PRIMARY" or names != {"id"}:
                    raise SchemaError(f"Unsupported unique index {name}; could redirect the upsert to another run")
            if not valid:
                raise SchemaError("pace requires a full UNIQUE(worldId, uuid); the old 'uniquerun' KEY is not unique. See migration.sql")
            cursor.execute("SHOW TABLE STATUS WHERE Name='pace'")
            if cursor.fetchone()["Engine"].lower() != "innodb":
                raise SchemaError("pace must use InnoDB for transactional replay")
            cursor.execute("SET SESSION innodb_lock_wait_timeout = 10")
        self.connection.commit()

    def write(self, jobs: list[tuple[int, str, dict]]):
        if self.stop_event.is_set():
            raise InterruptedError("Database writer is stopping")
        if self.connection is None:
            self.open()
        resolved = []
        try:
            with self.connection.cursor() as cursor:
                for _, kind, payload in jobs:
                    if self.stop_event.is_set():
                        raise InterruptedError("Database writer is stopping")
                    if kind == "run":
                        cursor.execute(UPSERT_SQL, upsert_values(payload["row"]))
                        if payload.get("terminal_token"):
                            row = payload["row"]
                            cursor.execute("UPDATE pace SET realUpdated=CURRENT_TIMESTAMP WHERE worldId=%s AND uuid=%s", (row["worldId"], row["uuid"]))
                            resolved.append((row["worldId"], row["uuid"], payload["terminal_token"]))
                    elif kind == "touch":
                        cursor.execute("UPDATE pace SET realUpdated=CURRENT_TIMESTAMP WHERE worldId=%s AND uuid=%s",
                                       (payload["worldId"], payload["uuid"]))
                        exists = cursor.rowcount > 0
                        if not exists:
                            # A no-op within the same timestamp second can also
                            # have rowcount 0. Distinguish that from a missing row.
                            cursor.execute("SELECT 1 FROM pace WHERE worldId=%s AND uuid=%s LIMIT 1", (payload["worldId"], payload["uuid"]))
                            exists = cursor.fetchone() is not None
                        if exists:
                            resolved.append((payload["worldId"], payload["uuid"], payload["terminal_token"]))
                    elif kind == "vod":
                        cursor.execute("UPDATE pace SET vodOffset=%s, vodId=%s WHERE worldId=%s AND uuid=%s AND vodId IS NULL",
                                       (payload["offset"], payload["id"], payload["worldId"], payload["uuid"]))
                    else:
                        raise ValueError(f"Unknown durable job kind: {kind}")
            if self.stop_event.is_set():
                raise InterruptedError("Database writer is stopping")
            self.connection.commit()
            return resolved
        except BaseException:
            # On an ambiguous COMMIT, replay is safe because the unique key is verified.
            with suppress(Exception):
                self.connection.rollback()
            self.close()
            raise

    def close(self):
        if self.connection is not None:
            with suppress(Exception):
                self.connection.close()
            self.connection = None


def retryable(error: mysql.connector.Error) -> bool:
    return error.errno in TRANSIENT_ERRNOS or isinstance(error, (mysql.connector.errors.InterfaceError,
           mysql.connector.errors.ReadTimeoutError, mysql.connector.errors.WriteTimeoutError))


def retry_delay(attempt: int) -> float:
    return random.uniform(0.8, 1.2) * min(30.0, 0.5 * 2 ** min(attempt, 6))


async def enqueue(outbox: Outbox, kind: str, payload: dict):
    warned = False
    while not await outbox.call(outbox.append, kind, payload):
        if not warned:
            LOG.warning("Durable outbox is full; pausing input until MySQL catches up")
            warned = True
        await asyncio.sleep(0.5)


async def receive_message(websocket) -> bytes:
    """Bound both bytes and fragment overhead before assembling one message."""
    fragments = []
    size = 0
    # Streaming avoids the unbounded fragment list in older websockets.recv().
    async for fragment in websocket.recv_streaming(decode=False):
        size += len(fragment)
        if size > MAX_WS_MESSAGE_SIZE or len(fragments) >= MAX_WS_FRAGMENTS:
            await websocket.close(code=1009, reason="Message exceeds logger limits")
            raise PayloadError("WebSocket message exceeds byte or fragment limit")
        fragments.append(fragment)
    return b"".join(fragments)


async def websocket_loop(config: Config, outbox: Outbox):
    attempt = 0
    while True:
        started = time.monotonic()
        try:
            async with connect(config.ws_url, additional_headers={"auth": config.ws_token},
                               open_timeout=10, close_timeout=5, ping_interval=20, ping_timeout=20,
                               max_size=MAX_WS_MESSAGE_SIZE, max_queue=16) as websocket:
                LOG.info("PaceMan WebSocket connected")
                while True:
                    message = await receive_message(websocket)
                    try:
                        payload = normalize_run(json.loads(message))
                    except PayloadError as error:
                        LOG.warning("Rejected WebSocket payload: %s", error)
                        continue
                    except (ValueError, TypeError, RecursionError) as error:
                        LOG.warning("Rejected WebSocket payload: %s", error.__class__.__name__)
                        continue
                    if payload is not None:
                        await enqueue(outbox, "run", payload)
        except (OSError, asyncio.TimeoutError, ConnectionClosed, InvalidHandshake, PayloadError) as error:
            LOG.warning("WebSocket disconnected (%s)", type(error).__name__)
        if time.monotonic() - started > 60:
            attempt = 0
        delay = retry_delay(attempt)
        attempt += 1
        await asyncio.sleep(delay)


async def ars_loop(config: Config, outbox: Outbox, session: aiohttp.ClientSession):
    attempt = 0
    while True:
        try:
            async with session.get(config.ars_url) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.content.iter_chunked(65_536):
                    body.extend(chunk)
                    if len(body) > 8_388_608:
                        raise PayloadError("ARS response exceeds 8 MiB")
                data = json.loads(body)
            if not isinstance(data, list):
                raise PayloadError("ARS response must be a list")
            current, seen = set(), set()
            for run in data:
                key = run_key(run)
                if key in seen:
                    raise PayloadError("ARS contains duplicate identities")
                seen.add(key)
                if allowed_run(run):
                    current.add(key)
            # Invalid/failed snapshots must never make every tracked run disappear.
            while not await outbox.call(outbox.snapshot, current):
                LOG.warning("Outbox full; waiting to persist ARS transitions")
                await asyncio.sleep(0.5)
            attempt = 0
            await asyncio.sleep(config.poll_interval)
        except (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError, ValueError, TypeError, RecursionError) as error:
            LOG.warning("ARS poll failed (%s); keeping the previous snapshot", type(error).__name__)
            await asyncio.sleep(retry_delay(attempt))
            attempt += 1


async def writer_loop(config: Config, outbox: Outbox, database: Database, vod_queue: asyncio.Queue):
    attempt = 0
    while True:
        jobs = await outbox.call(outbox.peek, config.batch_size)
        if not jobs:
            await asyncio.sleep(0.05)
            continue
        try:
            resolved = await database.call(database.write, jobs)
        except mysql.connector.Error as error:
            if not retryable(error):
                LOG.error("Permanent MySQL error (%s); outbox retained", error.errno)
                raise
            delay = retry_delay(attempt)
            LOG.warning("MySQL unavailable (%s); keeping %d jobs, retrying in %.1fs", error.errno, len(jobs), delay)
            await asyncio.sleep(delay)
            attempt += 1
            continue
        # If local acknowledgement fails, stop. The next process replays the committed batch.
        await outbox.call(outbox.acknowledge, jobs[-1][0], resolved)
        attempt = 0
        runs = [payload for _, kind, payload in jobs if kind == "run"]
        if runs:
            try:
                await asyncio.to_thread(config.heartbeat.touch)
            except OSError as error:
                LOG.warning("MySQL committed; heartbeat write failed (%s)", type(error).__name__)
        if config.client_id:
            for payload in runs:
                try:
                    vod_queue.put_nowait(payload)
                except asyncio.QueueFull:
                    LOG.warning("Twitch enrichment queue full; optional lookup skipped")
                    break
        LOG.debug("Committed %d durable jobs", len(jobs))


def vod_offset(source_ms: int, anchor_rta: int, created_at: datetime) -> int | None:
    offset = (datetime.fromtimestamp(source_ms / 1000, timezone.utc) - created_at).total_seconds() - anchor_rta / 1000
    return math.floor(offset) if 0 <= offset <= 2_147_483_647 else None


async def vod_loop(config: Config, outbox: Outbox, queue: asyncio.Queue):
    # Import lazily: core ingestion works without Twitch credentials or its SDK.
    try:
        from twitchAPI.helper import first
        from twitchAPI.twitch import Twitch
        from twitchAPI.type import SortMethod, VideoType
    except ImportError:
        LOG.error("Twitch SDK unavailable; optional enrichment disabled")
        while True:
            await queue.get()
            queue.task_done()

    twitch = None
    cache: OrderedDict[tuple[str, str], tuple[float, Any]] = OrderedDict()
    enriched: OrderedDict[tuple[str, str], None] = OrderedDict()
    try:
        while True:
            payload = await queue.get()
            try:
                row = payload["row"]
                key = (row["worldId"], row["uuid"])
                if key in enriched:
                    continue
                age = time.time() - row["sourceLastUpdatedMs"] / 1000
                # lastUpdated anchors the latest main split, not context events.
                if not row["twitch"] or payload["anchor_rta"] is None or not 0 <= age <= 5:
                    continue
                login = row["twitch"].lower()
                async with timeout_after(8):
                    if twitch is None:
                        twitch = await Twitch(config.client_id, config.client_secret, session_timeout=aiohttp.ClientTimeout(total=8, connect=3))
                    # Recheck the current stream for each new run. Cache archives
                    # by stream ID, so a broadcast restart cannot reuse an old VOD.
                    stream = await first(twitch.get_streams(user_login=[login], first=1))
                    if stream is None:
                        continue
                    cache_key = (login, stream.id)
                    cached = cache.get(cache_key)
                    if cached is not None and cached[0] > time.monotonic():
                        vod = cached[1]
                        cache.move_to_end(cache_key)
                    else:
                        video = await first(twitch.get_videos(user_id=stream.user_id, sort=SortMethod.TIME, video_type=VideoType.ARCHIVE, first=1))
                        vod = video if video is not None and video.stream_id == stream.id else None
                        cache[cache_key] = (time.monotonic() + (30 if vod is not None else 5), vod)
                        if len(cache) > 4096:
                            cache.popitem(last=False)
                if vod is not None:
                    offset = vod_offset(row["sourceLastUpdatedMs"], payload["anchor_rta"], vod.created_at)
                    if offset is not None:
                        await enqueue(outbox, "vod", {"worldId": row["worldId"], "uuid": row["uuid"], "id": int(vod.id), "offset": offset})
                        enriched[key] = None
                        if len(enriched) > 20_000:
                            enriched.popitem(last=False)
            except Exception as error:
                LOG.warning("Optional Twitch enrichment failed (%s)", type(error).__name__)
            finally:
                queue.task_done()
    finally:
        if twitch is not None:
            with suppress(Exception):
                async with timeout_after(5):
                    await twitch.close()


async def run(config: Config, check_only: bool = False):
    outbox, database = Outbox(config.spool_path, config.spool_limit), Database(config)
    tasks = []
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    # signal.signal works on Windows as well as Linux; callbacks only set an event.
    previous_handlers = {}
    for sig in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[sig] = signal.getsignal(sig)
        signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
    try:
        await outbox.call(outbox.open)
        await database.call(database.open)
        LOG.info("Database schema and durable outbox verified")
        if not check_only:
            notify_systemd_ready()
        if check_only:
            return
        queue = asyncio.Queue(maxsize=256)
        timeout = aiohttp.ClientTimeout(total=10, connect=3)
        async with aiohttp.ClientSession(timeout=timeout, trust_env=False) as session:
            tasks = [asyncio.create_task(writer_loop(config, outbox, database, queue), name="writer"),
                     asyncio.create_task(websocket_loop(config, outbox), name="websocket"),
                     asyncio.create_task(ars_loop(config, outbox, session), name="ars")]
            if config.client_id:
                tasks.append(asyncio.create_task(vod_loop(config, outbox, queue), name="twitch"))
            stopper = asyncio.create_task(stop.wait(), name="shutdown")
            tasks.append(stopper)
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task is not stopper:
                    task.result()  # Surface worker failures; the supervisor can restart us.
                    raise RuntimeError(f"Worker {task.get_name()} stopped unexpectedly")
            LOG.info("Shutdown requested; unacknowledged jobs remain in the durable outbox")
            database.stop_event.set()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        database.stop_event.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # Executor ordering waits for any in-flight DB write before closing its connection.
        try:
            await database.shutdown()
        finally:
            try:
                await outbox.shutdown()
            finally:
                for sig, handler in previous_handlers.items():
                    signal.signal(sig, handler)


from datetime import datetime, timezone
from contextlib import suppress
import getpass
import json
import logging
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

from dotenv import load_dotenv
import mysql.connector

INSTALL_LOG = logging.getLogger("pace_logger.install")
SERVICE = "jojoelog.service"
SETTING_NAMES = frozenset({
    "DB_HOST", "DB_PORT", "DB_NAME", "DB_USERNAME", "DB_PASSWORD", "DB_SSL_CA", "DB_UNIX_SOCKET",
    "PACEMAN_WS_SERVER", "PACEMAN_WS_TOKEN", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "ARS_URL",
    "PACE_SPOOL_PATH", "HEARTBEAT_FILE", "PACE_SPOOL_LIMIT", "PACE_DB_BATCH_SIZE", "PACE_UPDATE_INTERVAL", "LOG_LEVEL",
})


class InstallError(ValueError):
    pass


def systemctl(*arguments: str, check: bool = True):
    # A restart can include both the old unit's stop timeout and our readiness timeout.
    timeout = 240 if arguments[0] in {"start", "restart", "stop"} else 60
    result = subprocess.run(["systemctl", *arguments], capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise InstallError(f"systemctl {arguments[0]} failed: {result.stderr.strip()[:1000]}. "
                           "Inspect: journalctl -u jojoelog -n 80 --no-pager")
    return result


def service_settings() -> dict[str, str]:
    """Read effective service settings privately, without evaluating shell code."""
    settings = {}
    environment = systemctl("show", SERVICE, "--property=Environment", "--value").stdout
    for assignment in shlex.split(environment):
        key, separator, value = assignment.partition("=")
        if separator and key in SETTING_NAMES:
            settings[key] = value
    files = systemctl("show", SERVICE, "--property=EnvironmentFiles", "--value").stdout
    for match in re.finditer(r"(.+?) \(ignore_errors=(?:yes|no)\)", files):
        path = Path(match.group(1).strip())
        if path.is_file():
            # EnvironmentFile does not perform shell variable interpolation.
            from dotenv import dotenv_values
            for key, value in dotenv_values(path, interpolate=False).items():
                if key in SETTING_NAMES and value is not None:
                    settings[key] = value
    pid = systemctl("show", SERVICE, "--property=MainPID", "--value").stdout.strip()
    if pid.isdigit() and int(pid) > 0:
        try:
            for assignment in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
                key, separator, value = assignment.partition(b"=")
                name = key.decode("utf-8")
                if separator and name in SETTING_NAMES:
                    settings[name] = value.decode("utf-8")
        except (OSError, UnicodeError):
            pass  # The process may exit between MainPID and reading /proc.
    return settings


def prepare_settings(script_path: Path, install: bool, env_file: Path | None = None):
    directory = script_path.parent
    if install:
        if sys.platform != "linux" or os.geteuid() != 0:
            raise InstallError("Run this setup as root on the Linux server: python3 /root/jojoelog/new.py --install")
        if not shutil.which("systemctl"):
            raise InstallError("systemctl is not installed on this server")
        load_state = systemctl("show", SERVICE, "--property=LoadState", "--value").stdout.strip()
        if load_state != "loaded":
            raise InstallError("The existing jojoelog service could not be loaded; no service changes were made")
        for name, value in service_settings().items():
            os.environ.setdefault(name, value)
    selected_env = env_file or directory / ".env"
    if env_file is not None and not env_file.is_file():
        raise InstallError("--env-file does not point to a readable file")
    load_dotenv(selected_env, override=False)
    explicit_host = bool(os.getenv("DB_HOST"))
    private_settings = directory / ".new-settings.json"
    if private_settings.exists():
        try:
            saved = json.loads(private_settings.read_text(encoding="utf-8"))
            if not isinstance(saved, dict) or any(not isinstance(value, str) for value in saved.values()):
                raise ValueError("invalid saved settings")
        except (OSError, ValueError) as error:
            raise InstallError("Cannot read .new-settings.json; check that private configuration file") from error
        for name, value in saved.items():
            if name == "DB_UNIX_SOCKET" and explicit_host:
                continue  # A newly configured host must not reuse an old cached local socket.
            if name in SETTING_NAMES and (name not in os.environ or (name == "DB_PASSWORD" and not os.environ[name])):
                os.environ[name] = value
    os.environ.setdefault("DB_NAME", "pace")
    os.environ.setdefault("DB_USERNAME", "pace")
    if not os.getenv("DB_HOST") and not os.getenv("DB_UNIX_SOCKET"):
        for socket in ("/run/mysqld/mysqld.sock", "/var/run/mysqld/mysqld.sock", "/tmp/mysql.sock"):
            if Path(socket).is_socket():
                os.environ["DB_UNIX_SOCKET"] = socket
                break
    os.environ.setdefault("DB_HOST", "localhost")
    os.environ.setdefault("PACE_SPOOL_PATH", str(directory / "pace-outbox.sqlite3"))
    os.environ.setdefault("HEARTBEAT_FILE", str(directory / "lastPace"))
    if install:
        missing = [name for name in ("DB_PASSWORD", "PACEMAN_WS_SERVER", "PACEMAN_WS_TOKEN") if not os.getenv(name)]
        if missing and not sys.stdin.isatty():
            raise InstallError("Missing settings. Run --install in a terminal to enter the MySQL password or feed settings")
        for name in missing:
            prompt = {"DB_PASSWORD": "MySQL password for pace: ", "PACEMAN_WS_SERVER": "PaceMan WebSocket URL: ",
                      "PACEMAN_WS_TOKEN": "PaceMan WebSocket token: "}[name]
            value = input(prompt).strip() if name == "PACEMAN_WS_SERVER" else getpass.getpass(prompt)
            if not value:
                raise InstallError(f"{name} is required; setup stopped before changing the service")
            os.environ[name] = value
    # Stable relative paths even when systemd has no WorkingDirectory configured.
    os.chdir(directory)


def atomic_private_write(path: Path, content: bytes, owner: tuple[int, int] | None = None):
    if path.is_symlink():
        raise InstallError(f"Refusing to replace a symlink at {path.name}")
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile("wb", prefix=".new-settings-", dir=path.parent, delete=False) as target:
            temporary_path = Path(target.name)
            os.chmod(temporary_path, 0o600)
            if owner is not None:
                os.chown(temporary_path, *owner)
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        temporary_path.replace(path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def save_settings(directory: Path, owner: tuple[int, int] | None = None):
    content = json.dumps({name: os.environ[name] for name in sorted(SETTING_NAMES) if name in os.environ}) + "\n"
    atomic_private_write(directory / ".new-settings.json", content.encode("utf-8"), owner)


def notify_systemd_ready() -> bool:
    """Report completed startup directly from the main process (no readiness files)."""
    address = os.getenv("NOTIFY_SOCKET")
    if not address:
        return False  # Foreground runs do not have a systemd notification socket.
    if address.startswith("@"):
        address = "\0" + address[1:]  # Linux abstract Unix-domain socket.
    elif not address.startswith("/"):
        raise InstallError("NOTIFY_SOCKET must be an absolute or abstract socket address")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as channel:
            channel.settimeout(5)
            channel.connect(address)
            channel.sendall(b"READY=1\nSTATUS=Database schema and durable outbox verified\n")
    except OSError as error:
        raise InstallError("Could not notify systemd that startup completed; inspect the service journal") from error
    return True


def schema_plan(connection, required_columns: tuple[str, ...]) -> list[str]:
    """Validate existing data first; return only missing, additive DDL clauses."""
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute("SHOW COLUMNS FROM pace")
        columns = {row["Field"]: row for row in cursor.fetchall()}
        base = (set(required_columns) - {"sourceLastUpdatedMs"}) | {"id", "realUpdated", "vodId", "vodOffset"}
        if not base.issubset(columns):
            raise InstallError("pace is missing original logger columns; setup will not recreate or replace the table")
        if "sourceLastUpdatedMs" in columns and not columns["sourceLastUpdatedMs"]["Type"].lower().startswith("bigint"):
            raise InstallError("sourceLastUpdatedMs already exists with the wrong type; BIGINT is required")
        cursor.execute("SHOW TABLE STATUS WHERE Name='pace'")
        table = cursor.fetchone()
        if not table or table["Engine"].lower() != "innodb":
            raise InstallError("pace must already use InnoDB; setup will not convert its storage engine")
        cursor.execute("SHOW INDEX FROM pace")
        indexes = {}
        for row in cursor.fetchall():
            indexes.setdefault(row["Key_name"], []).append(row)
        unique = False
        for name, rows in indexes.items():
            if rows[0]["Non_unique"]:
                continue
            names = {row["Column_name"] for row in rows}
            if len(rows) == 2 and names == {"worldId", "uuid"} and all(row["Sub_part"] is None for row in rows):
                unique = True
            elif name != "PRIMARY" or names != {"id"}:
                raise InstallError(f"Unsupported unique index {name}; setup will not remove existing indexes")
        if not unique and "uq_pace_world_uuid" in indexes:
            raise InstallError("Index name uq_pace_world_uuid is already used by a nonunique index")
        if not unique:
            cursor.execute("SELECT worldId, uuid, COUNT(*) AS duplicate_count FROM pace "
                           "WHERE worldId IS NOT NULL AND uuid IS NOT NULL GROUP BY worldId, uuid HAVING COUNT(*) > 1 LIMIT 1")
            if cursor.fetchone() is not None:
                raise InstallError("Duplicate (worldId, uuid) rows exist in pace. No data was deleted; they need reconciliation before setup can continue")
    clauses = []
    if "sourceLastUpdatedMs" not in columns:
        clauses.append("ADD COLUMN `sourceLastUpdatedMs` BIGINT NULL DEFAULT NULL")
    if not unique:
        clauses.append("ADD UNIQUE INDEX `uq_pace_world_uuid` (`worldId`, `uuid`)")
    return clauses


def backup_database(directory: Path, options: dict) -> Path:
    program = shutil.which("mysqldump") or shutil.which("mariadb-dump")
    if program is None:
        raise InstallError("mysqldump is missing; install the MySQL client tools and rerun --install")
    backups = directory / "backups"
    backups.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    output = backups / f"pace-before-new-{stamp}-{uuid4().hex[:8]}.sql"
    partial = output.with_suffix(".sql.partial")
    descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)

    def quote(value):
        return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r") + '"'

    client = {"user": options["user"], "password": options.get("password", "")}
    if options.get("unix_socket"):
        client["socket"] = options["unix_socket"]
    else:
        client.update(host=options["host"], port=options.get("port", 3306))
    if options.get("ssl_ca"):
        client.update({"ssl-ca": options["ssl_ca"], "ssl-mode": "VERIFY_IDENTITY"})
    config_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", prefix=".mysql-backup-", dir=directory, delete=False) as temporary:
            config_path = Path(temporary.name)
            os.chmod(config_path, 0o600)
            temporary.write("[client]\n")
            for name, value in client.items():
                temporary.write(f"{name}={quote(value)}\n")
        result = subprocess.run([program, f"--defaults-file={config_path}", "--single-transaction", "--no-tablespaces",
                                 "--hex-blob", f"--result-file={partial}", "--databases", options["database"]],
                                capture_output=True, text=True, timeout=3600,
                                env=dict(os.environ, MYSQL_TEST_LOGIN_FILE=str(directory / (".no-login-path-" + uuid4().hex))))
        if result.returncode or partial.stat().st_size == 0:
            detail = result.stderr.replace(options.get("password", "") or "\0", "<redacted>")[:1500]
            raise InstallError(f"Database backup failed; migration was not started. {detail}")
        partial.replace(output)
        return output
    finally:
        if config_path is not None:
            config_path.unlink(missing_ok=True)


def systemd_path(path: Path | str) -> str:
    if any(ord(character) < 32 or ord(character) == 127 for character in str(path)):
        raise InstallError("Service paths must not contain control characters")
    return '"' + str(path).replace("%", "%%").replace("\\", "\\\\").replace('"', '\\"') + '"'


def service_override(script_path: Path, executable: Path) -> str:
    # WorkingDirectory is a single path directive: quotes are literal on systemd 249.
    directory = str(script_path.parent)
    systemd_path(directory)  # Apply the same control-character validation as ExecStart.
    directory = directory.replace("\\", "\\\\").replace("%", "%%")
    return ("# Managed by jojoelog new.py --install\n[Service]\n"
            "Type=notify\nNotifyAccess=main\nTimeoutStartSec=90\n"
            "ExecStart=\n"
            f"ExecStart={systemd_path(executable)} -u {systemd_path(script_path)}\n"
            f"WorkingDirectory={directory}\n")


def wait_for_stable_service():
    """After systemd accepted READY=1, also reject an immediate exit or crash loop."""
    pid = systemctl("show", SERVICE, "--property=MainPID", "--value").stdout.strip()
    if not pid.isdigit() or int(pid) <= 0:
        raise InstallError("The new service has no main process. Inspect: journalctl -u jojoelog -n 80 --no-pager")
    for _ in range(3):
        time.sleep(1)
        active = systemctl("is-active", SERVICE, check=False).returncode == 0
        current_pid = systemctl("show", SERVICE, "--property=MainPID", "--value").stdout.strip()
        if not active or current_pid != pid:
            raise InstallError("The new service exited or restarted after startup. Inspect: journalctl -u jojoelog -n 80 --no-pager")


def install_service(script_path: Path, db_options: dict, required_columns: tuple[str, ...], validate):
    """Install only after validation and backup; restore the old unit on failure."""
    if shutil.which("mysqldump") is None and shutil.which("mariadb-dump") is None:
        raise InstallError("mysqldump is missing; install MySQL client tools and rerun --install")
    options = dict(db_options, read_timeout=3600)
    if db_options["database"] != "pace":
        raise InstallError("This installer is for database pace; check DB_NAME before continuing")
    connection = None
    stopped = switched = changed_schema = False
    was_active = False
    dropin = Path("/etc/systemd/system/jojoelog.service.d/zzzz-new-logger.conf")
    original_override = None
    settings_path = script_path.parent / ".new-settings.json"
    original_settings = None
    original_owner = None
    settings_changed = False
    try:
        original_override = dropin.read_bytes() if dropin.exists() else None
        if settings_path.exists():
            original_settings = settings_path.read_bytes()
            metadata = settings_path.stat()
            original_owner = (metadata.st_uid, metadata.st_gid)
        was_active = systemctl("is-active", SERVICE, check=False).returncode == 0
        connection = mysql.connector.connect(**options)
        INSTALL_LOG.info("Checking pace schema and duplicate run identities")
        schema_plan(connection, required_columns)
        connection.rollback()  # End the preflight read view before stopping the writer.
        INSTALL_LOG.info("Stopping jojoelog for backup and setup")
        stopped = True
        systemctl("stop", SERVICE)
        INSTALL_LOG.info("Backing up the pace database; this can take a few minutes")
        backup = backup_database(script_path.parent, db_options)
        INSTALL_LOG.info("Backup saved: %s", backup)
        connection.rollback()
        clauses = schema_plan(connection, required_columns)
        if clauses:
            INSTALL_LOG.info("Applying %d missing schema changes; no run rows will be deleted", len(clauses))
            changed_schema = True  # COMMIT outcome may be uncertain after a disconnect.
            with connection.cursor() as cursor:
                cursor.execute("SET SESSION lock_wait_timeout = 30")
                cursor.execute("ALTER TABLE pace " + ", ".join(clauses))
        connection.commit()
        validate()
        import pwd
        service_user = systemctl("show", SERVICE, "--property=User", "--value").stdout.strip() or "root"
        account = pwd.getpwuid(int(service_user)) if service_user.isdigit() else pwd.getpwnam(service_user)
        settings_changed = True
        save_settings(script_path.parent, (account.pw_uid, account.pw_gid))
        dropin.parent.mkdir(parents=True, exist_ok=True)
        content = service_override(script_path, Path(sys.executable))
        switched = True
        atomic_private_write(dropin, content.encode("utf-8"))
        systemctl("daemon-reload")
        INSTALL_LOG.info("Starting jojoelog; waiting for systemd to confirm database/outbox readiness")
        # Type=notify makes this command wait for the main process's READY=1 message.
        systemctl("restart", SERVICE)
        wait_for_stable_service()
        INSTALL_LOG.info("Setup complete. jojoelog is running %s. Keep using: systemctl restart jojoelog", script_path)
    except BaseException:
        def recover(label, operation):
            try:
                result = operation()
                if hasattr(result, "returncode") and result.returncode:
                    raise RuntimeError("recovery command failed")
                return True
            except Exception as error:
                INSTALL_LOG.error("Could not %s (%s); inspect jojoelog before restarting", label, type(error).__name__)
                return False

        restored_unit = restored_settings = True
        if switched:
            recover("stop the new service", lambda: systemctl("stop", SERVICE, check=False))
            if original_override is None:
                restored_unit = recover("remove the new override", lambda: dropin.unlink(missing_ok=True))
            else:
                restored_unit = recover("restore the original override", lambda: atomic_private_write(dropin, original_override))
            restored_unit = recover("reload the original unit", lambda: systemctl("daemon-reload", check=False)) and restored_unit
        if settings_changed:
            if original_settings is None:
                restored_settings = recover("remove new private settings", lambda: settings_path.unlink(missing_ok=True))
            else:
                restored_settings = recover("restore previous private settings", lambda: atomic_private_write(settings_path, original_settings, original_owner))
        if stopped and was_active and restored_unit and restored_settings:
            if recover("restart the previous service", lambda: systemctl("restart", SERVICE, check=False)):
                INSTALL_LOG.warning("Setup failed; restored the previous service configuration and requested its restart")
        if changed_schema:
            INSTALL_LOG.warning("Schema changes were attempted and may remain in place; the database backup has been retained")
        raise
    finally:
        if connection is not None:
            with suppress(Exception):
                connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="jojoelog: Python 3.10+ PaceMan logger with one-time server setup")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--install", action="store_true", help="prepare dependencies, back up/migrate pace, and switch jojoelog to this file")
    mode.add_argument("--check", action="store_true", help="check the existing configuration and database without starting ingestion")
    parser.add_argument("--env-file", type=Path, help="optional dotenv file; defaults to .env beside this script")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ("websockets", "aiohttp", "twitchAPI", "mysql.connector"):
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        script_path = Path(__file__).resolve()
        prepare_settings(script_path, args.install, args.env_file)
        level = os.getenv("LOG_LEVEL", "INFO").upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise InstallError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
        logging.getLogger().setLevel(level)
        config = Config.from_env()
        if args.install:
            async def check_database():
                database = Database(config)
                try:
                    await database.call(database.open)
                finally:
                    await database.shutdown()
            install_service(script_path, config.db, RUN_COLUMNS, lambda: asyncio.run(check_database()))
        else:
            asyncio.run(run(config, args.check))
    except KeyboardInterrupt:
        return 130 if args.install else 0
    except (ValueError, SchemaError) as error:
        LOG.error("%s", error)
        return 1
    except mysql.connector.Error as error:
        if error.errno in {1045, 1698}:
            LOG.error("MySQL login failed. Check DB_USERNAME/DB_PASSWORD in the existing .env and rerun --install")
        elif error.errno in {1044, 1142, 1227}:
            LOG.error("MySQL denied permission (error %s). The setup account needs permission to back up pace and ALTER its pace table", error.errno)
        else:
            LOG.error("MySQL operation failed (error %s); pending writes are retained", error.errno)
        return 1
    except Exception as error:
        LOG.error("Logger/setup stopped (%s); inspect the preceding messages. Pending writes are retained", type(error).__name__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
