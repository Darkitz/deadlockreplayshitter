#!/usr/bin/env python3
"""Serve the site locally, with a sync button and a replay-folder watcher.

  GET  /api/status   sync state + log tail
  POST /api/sync     start tools/sync.py (no-op while one is running)

The watcher polls the game's replays folder and data/demos; when a new .dem has finished
writing (size stable across two polls) it runs a sync without downloads, so a replay you
download in-game shows up on the site by itself.

Binds to 127.0.0.1 by default: the API starts processes, don't expose it.

usage: python3 tools/serve.py [--port 8765] [--account ...] [--hero drifter] [--no-watch]
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time
from collections import deque
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT / "tools"))
import sync  # noqa: E402  (paths + local_demos)


class Syncer:
    def __init__(self, base_args):
        self.base_args = base_args
        self.lock = threading.Lock()
        self.proc = None
        self.log = deque(maxlen=300)
        self.last_exit = None
        self.last_finished = None
        self.pending = False

    def status(self):
        with self.lock:
            return {
                "running": self.proc is not None,
                "log": list(self.log),
                "last_exit": self.last_exit,
                "last_finished": self.last_finished,
            }

    def start(self, extra=(), reason="manual"):
        with self.lock:
            if self.proc is not None:
                self.pending = True  # run again once the current sync is done
                return False
            self.log.clear()
            self.log.append(f"[{time.strftime('%H:%M:%S')}] sync ({reason})")
            cmd = [sys.executable, "-u", str(ROOT / "tools" / "sync.py"), *self.base_args, *extra]
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()
        return True

    def _pump(self, proc):
        for line in proc.stdout:
            with self.lock:
                self.log.append(line.rstrip())
        code = proc.wait()
        again = False
        with self.lock:
            self.last_exit = code
            self.last_finished = int(time.time())
            self.log.append(f"[{time.strftime('%H:%M:%S')}] exit {code}")
            self.proc = None
            again, self.pending = self.pending, False
        print("\n".join(list(self.log)[-3:]), flush=True)
        if again:
            self.start(("--no-download",), "queued")


def watch(syncer, interval=15):
    """trigger a sync when a new demo appears and has stopped growing."""
    def snapshot():
        return {mid: p.stat().st_size for mid, p in sync.local_demos().items()}

    known = snapshot()
    growing = {}
    while True:
        time.sleep(interval)
        try:
            now = snapshot()
        except OSError:
            continue
        fresh = [mid for mid in now if mid not in known]
        if os.environ.get("SKILLHITTER_DEBUG"):
            print(f"poll: {len(now)} demos, fresh {fresh}", flush=True)
        ready = []
        for mid in fresh:
            if growing.get(mid) == now[mid]:
                ready.append(mid)
            growing[mid] = now[mid]
        if ready:
            for mid in ready:
                known[mid] = now[mid]
                growing.pop(mid, None)
            print(f"new demo(s): {ready}", flush=True)
            syncer.start(("--no-download",), f"new demo {', '.join(map(str, ready))}")


class Handler(SimpleHTTPRequestHandler):
    syncer: Syncer = None

    def log_message(self, fmt, *args):  # quiet static file logging
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        if self.path.startswith("/data/") or self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/status":
            return self._json(200, self.syncer.status())
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/sync":
            started = self.syncer.start()
            return self._json(202, {"started": started})
        self._json(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--account", default=None)
    ap.add_argument("--hero", action="append", default=None)
    ap.add_argument("--no-watch", action="store_true")
    ap.add_argument("--watch-interval", type=float, default=10, help="seconds between folder polls")
    args = ap.parse_args()

    base = []
    if args.account:
        base += ["--account", args.account]
    for h in args.hero or []:
        base += ["--hero", h]
    syncer = Syncer(base)
    Handler.syncer = syncer
    if not args.no_watch:
        threading.Thread(target=watch, args=(syncer, args.watch_interval), daemon=True).start()
        print(f"watching {sync.GAME_REPLAYS} and {sync.DEMOS} for new demos", flush=True)

    srv = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(WEB)))
    print(f"serving http://{args.host}:{args.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
