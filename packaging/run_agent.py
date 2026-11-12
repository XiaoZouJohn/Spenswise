"""Run the built Agent edition with its own data; never migrate the installed app."""

import hashlib
import json
import os
import sys
import threading
import urllib.request
from pathlib import Path

from launcher import build_app, choose_port, configure_runtime, open_browser

ROOT = Path(__file__).resolve().parents[1]
PORT = 8766
URL = f"http://127.0.0.1:{PORT}"


def main() -> int:
    sys.path.insert(0, str(ROOT / "backend"))
    instance = hashlib.sha256(str(ROOT).encode()).hexdigest()[:16]
    # Bypass any system proxy for this loopback-only probe.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"{URL}/api/health", timeout=1) as response:
            existing = json.load(response)
        if existing.get("instance") == instance:
            if "--no-browser" not in sys.argv:
                open_browser(URL)
            print(f"Already running: {URL}")
            return 0
    except (OSError, ValueError):
        pass
    if choose_port(PORT) != PORT:
        raise RuntimeError(f"Port {PORT} is in use by another program. Close it and retry.")
    os.environ["SPENDWISE_COOKIE_NAME"] = "spendwise_agent_session"
    os.environ["SPENDWISE_INSTANCE"] = instance
    data, _ = configure_runtime(PORT, data_directory=ROOT / "data")
    app = build_app(ROOT / "frontend" / "dist", ROOT / "backend" / "migrations")
    print(f"SpendWise Agent: {URL}\nData: {data}\nClose this console to stop the app.", flush=True)
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, open_browser, args=(URL,)).start()
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning", access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
