#!/usr/bin/env python3
"""agent-05 site server.

A dependency-free HTTP server that serves the static site in ./public and
exposes a small read-only JSON API for the live "now" / activity data.

Run as a normal user with CAP_NET_BIND_SERVICE so it can bind port 80.
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
NOW_FILE = os.path.join(PUBLIC, "now.json")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
}


def load_now():
    try:
        with open(NOW_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = {}
    # Online if heartbeat within 15 minutes.
    heartbeat = data.get("heartbeat_epoch")
    online = bool(heartbeat) and (time.time() - float(heartbeat)) < 15 * 60
    data.setdefault("online", online)
    data.setdefault("generated_epoch", heartbeat or time.time())
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "agent-05/1.0"
    protocol_version = "HTTP/1.1"

    # ---- helpers -------------------------------------------------------
    def _send(self, code, body, content_type="text/plain; charset=utf-8",
              extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, indent=2, ensure_ascii=False),
                   "application/json; charset=utf-8")

    def _safe_path(self, url_path):
        # Strip query, decode, normalize, prevent traversal.
        url_path = unquote(url_path.split("?", 1)[0])
        if url_path in ("", "/"):
            url_path = "/index.html"
        if not url_path.startswith("/"):
            url_path = "/" + url_path
        rel = url_path.lstrip("/")
        abs_path = os.path.normpath(os.path.join(PUBLIC, rel))
        if not abs_path.startswith(PUBLIC + os.sep) and abs_path != PUBLIC:
            return None
        return abs_path

    # ---- routing -------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/activity":
            return self._json(load_now())
        if path == "/api/now":
            return self._json(load_now())
        if path == "/api/health":
            return self._json({"status": "ok", "ts": time.time()})
        if path == "/robots.txt":
            return self._send(200, "User-agent: *\nAllow: /\n",
                               "text/plain; charset=utf-8")

        abs_path = self._safe_path(path)
        if abs_path is None:
            return self._send(403, "Forbidden", "text/plain; charset=utf-8")

        content_type = CONTENT_TYPES.get(os.path.splitext(abs_path)[1],
                                         "application/octet-stream")
        try:
            with open(abs_path, "rb") as fh:
                body = fh.read()
        except FileNotFoundError:
            # Friendly 404 page if present, else text.
            not_found = os.path.join(PUBLIC, "404.html")
            if os.path.exists(not_found):
                with open(not_found, "rb") as fh:
                    body = fh.read()
                return self._send(404, body, "text/html; charset=utf-8")
            return self._send(404, "Not found", "text/plain; charset=utf-8")
        except IsADirectoryError:
            return self._send(403, "Forbidden", "text/plain; charset=utf-8")
        return self._send(200, body, content_type)

    do_HEAD = do_GET

    def log_message(self, format, *args):
        # Quieter than default; writes to stderr.
        pass


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "80"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"agent-05 site listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
