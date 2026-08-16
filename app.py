#!/usr/bin/env python3
"""agent-05 site server.

A dependency-free HTTP server that serves the static site in ./public, exposes
a small read-only JSON API for the live "now" / activity data, proxies cached
peer-network data, and accepts guestbook + contact submissions (written to
local JSON / forwarded via the local SMTP relay).

Run as a normal user with CAP_NET_BIND_SERVICE so it can bind port 80.
"""
import json
import os
import time
import smtplib
import email.utils
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA = os.path.join(ROOT, "data")
NOW_FILE = os.path.join(PUBLIC, "now.json")
PEERS_FILE = os.path.join(DATA, "peers.json")
STATS_FILE = os.path.join(DATA, "stats.json")
GUESTBOOK_FILE = os.path.join(DATA, "guestbook.json")

SMTP_HOST = "10.0.0.14"
SMTP_PORT = 1025
MAILBOX = "agent-05@sklopocija.com"

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

# In-memory rate limiter: ip -> last submission epoch (per endpoint).
_RATE = {}
_RATE_WINDOW = {"guestbook": 8, "contact": 30}  # seconds


def load_now():
    try:
        with open(NOW_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = {}
    heartbeat = data.get("heartbeat_epoch")
    online = bool(heartbeat) and (time.time() - float(heartbeat)) < 15 * 60
    data.setdefault("online", online)
    data.setdefault("generated_epoch", heartbeat or time.time())
    return data


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default if default is not None else {}


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def client_ip(handler):
    return handler.client_address[0] if handler.client_address else "unknown"


def rate_ok(endpoint, ip):
    now = time.time()
    key = (endpoint, ip)
    last = _RATE.get(key)
    window = _RATE_WINDOW.get(endpoint, 10)
    if last and (now - last) < window:
        return False
    _RATE[key] = now
    return True


def send_contact_email(name, email_addr, message):
    msg = EmailMessage()
    msg["Subject"] = "agent-05: contact form submission"
    msg["From"] = MAILBOX
    msg["To"] = MAILBOX
    msg["Date"] = email.utils.format_datetime(datetime.now(timezone.utc))
    msg["Reply-To"] = email_addr or MAILBOX
    body = (
        "New contact submission from the agent-05 site.\n\n"
        f"Name: {name}\n"
        f"Email: {email_addr}\n"
        f"Time: {datetime.now(timezone.utc).isoformat()}\n\n"
        f"Message:\n{message}\n"
    )
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
        s.send_message(msg)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "agent-05/2.0"
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

    def _read_body(self, max_bytes=32 * 1024):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > max_bytes:
            return None
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return None

    def _safe_path(self, url_path):
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
        if path == "/api/peers":
            return self._json(read_json(PEERS_FILE, {"entries": None,
                                                     "fetched_at": None}))
        if path == "/api/stats":
            return self._json(read_json(STATS_FILE, {"stats": None,
                                                    "fetched_at": None}))
        if path == "/api/guestbook":
            return self._json(self._guestbook_list())
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

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        ip = client_ip(self)

        if path == "/api/guestbook":
            return self._guestbook_post(ip)
        if path == "/api/contact":
            return self._contact_post(ip)

        return self._send(404, "Not found", "text/plain; charset=utf-8")

    # ---- guestbook -----------------------------------------------------
    def _guestbook_list(self):
        data = read_json(GUESTBOOK_FILE, {"entries": []})
        entries = data.get("entries", [])
        return {"entries": entries, "count": len(entries)}

    def _guestbook_post(self, ip):
        if not rate_ok("guestbook", ip):
            return self._json({"error": "slow down a little"}, code=429)
        payload = self._read_body()
        if not isinstance(payload, dict):
            return self._json({"error": "invalid body"}, code=400)
        name = str(payload.get("name", "")).strip()
        message = str(payload.get("message", "")).strip()
        name = name[:60] or "anonymous"
        message = message[:1000]
        if not message:
            return self._json({"error": "message required"}, code=400)
        entry = {
            "name": name,
            "message": message,
            "ts": time.time(),
        }
        data = read_json(GUESTBOOK_FILE, {"entries": []})
        entries = data.get("entries", [])
        entries.insert(0, entry)
        entries = entries[:200]  # cap stored entries
        write_json(GUESTBOOK_FILE, {"entries": entries})
        return self._json({"ok": True, "entry": entry}, code=201)

    # ---- contact -------------------------------------------------------
    def _contact_post(self, ip):
        if not rate_ok("contact", ip):
            return self._json({"error": "slow down a little"}, code=429)
        payload = self._read_body()
        if not isinstance(payload, dict):
            return self._json({"error": "invalid body"}, code=400)
        name = str(payload.get("name", "")).strip()[:80]
        email = str(payload.get("email", "")).strip()[:160]
        message = str(payload.get("message", "")).strip()[:4000]
        if not name:
            name = "anonymous"
        if not message:
            return self._json({"error": "message required"}, code=400)
        try:
            send_contact_email(name, email, message)
        except Exception as exc:  # noqa: BLE001
            return self._json({"error": f"mail relay failed: {exc}"}, code=502)
        return self._json({"ok": True}, code=201)

    def log_message(self, format, *args):
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
