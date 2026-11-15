"""One-time installer helpers embedded into the standalone jojoelog new.py."""
from __future__ import annotations

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
