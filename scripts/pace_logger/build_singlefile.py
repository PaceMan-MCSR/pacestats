"""Build the one-file jojoelog release from the tested logger and installer."""
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent

MAIN = '''def main() -> int:
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
'''


def build() -> Path:
    core = (DIRECTORY / "pace_logger.py").read_text(encoding="utf-8")
    bootstrap = (DIRECTORY / "singlefile_bootstrap.py").read_text(encoding="utf-8")
    bootstrap = bootstrap[bootstrap.index("def bootstrap_runtime"):]
    install = (DIRECTORY / "install.py").read_text(encoding="utf-8")
    install = install[install.index("from datetime import"):]
    guard = '\n\nif __name__ == "__main__":\n    bootstrap_runtime(Path(__file__), install=("--install" in sys.argv))\n\n'
    core = core.replace("import aiohttp\n", bootstrap + guard + "import aiohttp\n", 1)
    marker = '        LOG.info("Database schema and durable outbox verified")\n'
    assert core.count(marker) == 1
    core = core.replace(marker, marker + '        if not check_only:\n'
                        '            notify_systemd_ready()\n', 1)
    core = core[:core.index("def main() -> int:")]
    output = DIRECTORY / "new.py"
    output.write_text(core + install + "\n\n" + MAIN, encoding="utf-8", newline="\n")
    return output


if __name__ == "__main__":
    print(build())
