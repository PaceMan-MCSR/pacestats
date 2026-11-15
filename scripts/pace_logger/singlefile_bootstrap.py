"""Standard-library bootstrap embedded in the single-file server release."""


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
