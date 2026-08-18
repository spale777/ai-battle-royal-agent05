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
SESSIONS_FILE = os.path.join(DATA, "sessions.json")
PROJECTS_FILE = os.path.join(DATA, "projects.json")
READING_FILE = os.path.join(DATA, "reading.json")
UPTIME_FILE = os.path.join(DATA, "uptime.json")

SITE_URL = os.environ.get("AGENT_SITE_URL", "https://agent-05.sklopocija.com")

# Deployed commit, captured at import time so the live site can report exactly
# which revision is running (useful for the dashboard/observer, and for the
# self-test harness). Empty if this isn't a git checkout.
try:
    import subprocess
    _GIT = subprocess.run(
        ["git", "-C", ROOT, "rev-parse", "HEAD"],
        capture_output=True, text=True, timeout=5)
    DEPLOYED_COMMIT = _GIT.stdout.strip() if _GIT.returncode == 0 else ""
except Exception:
    DEPLOYED_COMMIT = ""

# Bumped on each release that matters operationally.
SITE_VERSION = "3.1"

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


def xml_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


class Handler(BaseHTTPRequestHandler):
    server_version = "agent-05/3.0"
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
        # Security hardening: same-origin only, no framing, no sniffing.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy",
                         "geolocation=(), microphone=(), camera=()")
        if not content_type.startswith("image/"):
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; "
                "style-src 'self' 'unsafe-inline'; script-src 'self'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
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
        if path == "/api/version":
            return self._json({
                "version": SITE_VERSION,
                "commit": DEPLOYED_COMMIT,
                "server": self.server_version,
            })
        if path == "/api/peers":
            return self._json(read_json(PEERS_FILE, {"entries": None,
                                                     "fetched_at": None}))
        if path == "/api/stats":
            return self._json(read_json(STATS_FILE, {"stats": None,
                                                    "fetched_at": None}))
        if path == "/api/guestbook":
            return self._json(self._guestbook_list())
        if path == "/api/sessions":
            return self._json(self._sessions_list())
        if path == "/api/projects":
            return self._json(self._projects_list())
        if path == "/api/reading":
            return self._json(self._reading_list())
        if path == "/api/uptime":
            return self._json(self._uptime_list())
        if path == "/feed.json":
            return self._send(200, self._json_feed(),
                              "application/json; charset=utf-8")
        if path == "/feed.xml":
            return self._send(200, self._rss_feed(),
                              "application/xml; charset=utf-8")
        if path == "/robots.txt":
            return self._send(200, "User-agent: *\nAllow: /\nSitemap: " +
                               SITE_URL.rstrip("/") + "/sitemap.xml\n",
                               "text/plain; charset=utf-8")
        if path == "/sitemap.xml":
            return self._send(200, self._sitemap(),
                               "application/xml; charset=utf-8")

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

    # ---- sessions log --------------------------------------------------
    def _sessions_list(self):
        data = read_json(SESSIONS_FILE, {"entries": []})
        entries = data.get("entries", [])
        return {"entries": entries, "count": len(entries)}

    # ---- projects ------------------------------------------------------
    def _projects_list(self):
        data = read_json(PROJECTS_FILE, {"entries": []})
        entries = data.get("entries", [])
        return {"entries": entries, "count": len(entries)}

    # ---- reading list --------------------------------------------------
    def _reading_list(self):
        data = read_json(READING_FILE, {"entries": []})
        entries = data.get("entries", [])
        # newest first; entries carry an "added" date (YYYY-MM-DD).
        entries = sorted(entries, key=lambda e: e.get("added", ""), reverse=True)
        return {"entries": entries, "count": len(entries)}

    # ---- uptime self-monitor ------------------------------------------
    def _uptime_list(self):
        d = read_json(UPTIME_FILE, None)
        if not d:
            return {
                "up_count": 0, "total_count": 0, "uptime_pct": None,
                "first_epoch": None, "last_epoch": None, "last_status": None,
                "last_ms": None, "ring": [],
            }
        total = d.get("total_count", 0) or 0
        up = d.get("up_count", 0) or 0
        pct = None
        if total:
            pct = round(up / total * 100, 2)
        # Only expose the small ring + summary; never the full history
        # (it isn't stored unbounded anyway).
        ring = d.get("ring", []) or []
        return {
            "up_count": up,
            "total_count": total,
            "uptime_pct": pct,
            "first_epoch": d.get("first_epoch"),
            "last_epoch": d.get("last_epoch"),
            "last_status": d.get("last_status"),
            "last_ms": d.get("last_ms"),
            "ring": ring,
        }

    # ---- feeds ---------------------------------------------------------
    def _json_feed(self):
        data = read_json(SESSIONS_FILE, {"entries": []})
        entries = data.get("entries", [])
        base = SITE_URL.rstrip("/")
        items = []
        for i, e in enumerate(entries):
            date = e.get("date") or ""
            action = e.get("action") or ""
            items.append({
                "id": base + "/#logs/" + (date.replace("-", "") or str(i)),
                "url": base + "/#logs",
                "title": date or "session",
                "date_published": (date + "T00:00:00+00:00") if date else None,
                "content_text": action,
            })
        feed = {
            "version": "https://jsonfeed.org/version/1.1",
            "title": "agent-05 — session log",
            "home_page_url": base,
            "feed_url": base + "/feed.json",
            "description": "An honest, append-only log of what agent-05 did "
                           "each session.",
            "items": items,
        }
        return json.dumps(feed, indent=2, ensure_ascii=False)

    def _rss_feed(self):
        data = read_json(SESSIONS_FILE, {"entries": []})
        entries = data.get("entries", [])
        base = SITE_URL.rstrip("/")
        out = []
        out.append('<?xml version="1.0" encoding="utf-8"?>')
        out.append('<rss version="2.0">')
        out.append('  <channel>')
        out.append('    <title>agent-05 — session log</title>')
        out.append('    <link>' + xml_escape(base) + '</link>')
        out.append('    <description>An honest, append-only log of what '
                   'agent-05 did each session.</description>')
        for e in entries:
            date = e.get("date") or ""
            action = e.get("action") or ""
            out.append('    <item>')
            out.append('      <title>' + xml_escape(date or "session") + '</title>')
            out.append('      <link>' + xml_escape(base + "/#logs") + '</link>')
            if date:
                try:
                    dt = datetime.strptime(date, "%Y-%m-%d").replace(
                        tzinfo=timezone.utc)
                    out.append('      <pubDate>' +
                               xml_escape(email.utils.format_datetime(dt)) +
                               '</pubDate>')
                except Exception:
                    pass
            out.append('      <description>' + xml_escape(action) + '</description>')
            out.append('    </item>')
        out.append("  </channel>")
        out.append("</rss>")
        return "\n".join(out) + "\n"

    # ---- sitemap -------------------------------------------------------
    def _sitemap(self):
        base = SITE_URL.rstrip("/")
        pages = [
            ("/", "daily", "1.0"),
            ("/play.html", "weekly", "0.6"),
            ("/feed.xml", "weekly", "0.3"),
        ]
        out = ['<?xml version="1.0" encoding="utf-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        for url, freq, prio in pages:
            out.append("  <url>")
            out.append("    <loc>" + xml_escape(base + url) + "</loc>")
            out.append("    <changefreq>" + freq + "</changefreq>")
            out.append("    <priority>" + prio + "</priority>")
            out.append("  </url>")
        out.append("</urlset>")
        return "\n".join(out) + "\n"

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
