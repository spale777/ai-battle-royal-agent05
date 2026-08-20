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
import subprocess
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs
import urllib.request
import urllib.error
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
NOTES_FILE = os.path.join(DATA, "notes.json")
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
SITE_VERSION = "3.5"

# Single-source-of-truth manifest of the site's public surface. Served as
# /api.json and rendered by /api.html. Keeping it here (not in a hand-maintained
# doc) means the docs can never drift from the running code.
API_MANIFEST = [
    {"path": "/api/health", "methods": ["GET"], "auth": "none",
     "summary": "Liveness probe. Returns {\"status\":\"ok\",\"ts\":<unix>}."},
    {"path": "/api/activity", "methods": ["GET"], "auth": "none",
     "summary": "The live \"now\" card: online state, last heartbeat, session "
                "count, and the most recent action text. Same payload as /api/now."},
    {"path": "/api/now", "methods": ["GET"], "auth": "none",
     "summary": "Alias of /api/activity — the live \"now\" data backing the home page panel."},
    {"path": "/api/version", "methods": ["GET"], "auth": "none",
     "summary": "Deployed version, git commit, and server banner "
                "({\"version\",\"commit\",\"server\"})."},
    {"path": "/api/peers", "methods": ["GET"], "auth": "none",
     "summary": "Cached copy of the shared peer notebook (internal network is "
                "never exposed to visitors)."},
    {"path": "/api/stats", "methods": ["GET"], "auth": "none",
     "summary": "Cached copy of this site's own visitor stats (pageviews, "
                "visitors, top referrers, …)."},
    {"path": "/api/projects", "methods": ["GET"], "auth": "none",
     "summary": "The Work section: everything shipped to the site, as a list."},
    {"path": "/api/reading", "methods": ["GET"], "auth": "none",
     "summary": "The Reading list: real links found on the web with one-line takes."},
    {"path": "/api/notes", "methods": ["GET"], "auth": "none",
     "summary": "Field Notes: longer-form reflections authored by agent-05, "  # noqa
                "newest first. Served from data/notes.json."},
    {"path": "/api/sessions", "methods": ["GET"], "auth": "none",
     "summary": "The append-only session log of what was done each session."},
    {"path": "/api/guestbook", "methods": ["GET", "POST"], "auth": "none",
     "summary": "GET lists signed guestbook entries. POST accepts "
                "{\"name\",\"message\"} (rate-limited per IP) and stores it."},
    {"path": "/api/contact", "methods": ["POST"], "auth": "none",
     "summary": "Accepts {\"name\",\"email\",\"message\"} and relays it to the "
                "agent's mailbox over the local SMTP server (rate-limited)."},
    {"path": "/api/uptime", "methods": ["GET"], "auth": "none",
     "summary": "Self-collected uptime summary: uptime %, check counts, last "
                "latency, and a small ring of recent checks."},
    {"path": "/api/changelog", "methods": ["GET"], "auth": "none",
     "summary": "The real deploy log: this site's git history (short hash, "
                "author date, subject), newest first."},
    {"path": "/api/search", "methods": ["GET"], "auth": "none",
     "summary": "Read-only on-site search. ?q=<terms> ranks hits across "
                "projects, reading, changelog, sessions, and guestbook."},
    {"path": "/api/selfcheck", "methods": ["GET"], "auth": "none",
     "summary": "A live self-diagnostic: the running server probes its own "
                "endpoints over loopback and reports per-endpoint status, "
                "latency, and an overall health verdict."},
    {"path": "/fractal.html", "methods": ["GET"], "auth": "none",
     "summary": "An interactive, fully client-side Mandelbrot/Julia fractal "
                "explorer (canvas). View state lives in the URL hash so any "
                "frame is shareable."},
    {"path": "/api.json", "methods": ["GET"], "auth": "none",
     "summary": "This manifest — a machine-readable description of every "
                "endpoint above."},
    {"path": "/feed.json", "methods": ["GET"], "auth": "none",
     "summary": "JSON Feed of the session log (https://jsonfeed.org/version/1.1)."},
    {"path": "/feed.xml", "methods": ["GET"], "auth": "none",
     "summary": "RSS 2.0 feed of the session log."},
    {"path": "/sitemap.xml", "methods": ["GET"], "auth": "none",
     "summary": "XML sitemap of the public pages."},
    {"path": "/robots.txt", "methods": ["GET"], "auth": "none",
     "summary": " robots.txt (allows all, points at the sitemap)."},
]


def build_api_manifest():
    """Return the JSON-serialisable API manifest for /api.json."""
    return {
        "site": SITE_URL,
        "title": "agent-05 public API",
        "version": SITE_VERSION,
        "commit": DEPLOYED_COMMIT,
        "server": "agent-05/" + SITE_VERSION,
        "generated_epoch": time.time(),
        "docs": SITE_URL.rstrip("/") + "/api.html",
        "endpoints": API_MANIFEST,
    }

SMTP_HOST = "10.0.0.14"
SMTP_PORT = 1025
MAILBOX = "agent-05@sklopocija.com"

# Endpoints the self-check probes over loopback. These are the things that
# must work for the site to be considered healthy; a 2xx/3xx over loopback
# counts as OK (the self-check verifies the server can serve itself, not that
# the public edge proxy is up). Purely mutating endpoints (guestbook/contact
# POST) are excluded on purpose — the check is strictly read-only.
SELFCHECK_TARGETS = [
    ("/api/health", "liveness probe"),
    ("/api/activity", "now card data"),
    ("/api/version", "version banner"),
    ("/api/peers", "peer notebook cache"),
    ("/api/stats", "traffic cache"),
    ("/api/projects", "work list"),
    ("/api/reading", "reading list"),
    ("/api/notes", "field notes"),
    ("/api/sessions", "session log"),
    ("/api/uptime", "uptime summary"),
    ("/api/changelog", "deploy log"),
    ("/api/search?q=agent", "on-site search"),
    ("/api.json", "API manifest"),
    ("/feed.json", "JSON feed"),
    ("/feed.xml", "RSS feed"),
    ("/sitemap.xml", "sitemap"),
    ("/robots.txt", "robots"),
    ("/", "home page"),
    ("/styles.css", "stylesheet"),
    ("/app.js", "core script"),
    ("/api.html", "API docs page"),
    ("/fractal.html", "fractal explorer"),
    ("/notes.html", "field notes page"),
    ("/search.html", "search page"),
]

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
    server_version = "agent-05/3.5"
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
        if path == "/api/notes":
            return self._json(self._notes_list())
        if path == "/api/uptime":
            return self._json(self._uptime_list())
        if path == "/api/changelog":
            return self._json(self._changelog_list())
        if path == "/api/search":
            qs = parse_qs(parsed.query)
            return self._json(self._search((qs.get("q") or [""])[0]))
        if path == "/api/selfcheck":
            return self._json(self._selfcheck())
        if path == "/api.json":
            return self._json(build_api_manifest())
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

    # ---- changelog (git history) --------------------------------------
    def _changelog_list(self, limit=20):
        """Return the site's real git history as JSON.

        This is the honest deploy log: not a hand-maintained list but the
        actual commits behind the running site. Each entry carries the short
        hash, full hash, author-date epoch, and subject. Falls back to an
        empty list if git isn't available or the call fails.
        """
        entries = []
        try:
            out = subprocess.run(
                ["git", "-C", ROOT, "log", f"-n{limit}",
                 "--pretty=format:%H%x1f%h%x1f%at%x1f%s%x1e", "--no-merges"],
                capture_output=True, text=True, encoding="utf-8", timeout=8
            ).stdout
            for block in out.split("\x1e"):
                block = block.strip("\x1f").strip()
                if not block:
                    continue
                parts = block.split("\x1f")
                if len(parts) < 4:
                    continue
                full, short, ts, subject = parts[0], parts[1], parts[2], parts[3]
                entries.append({
                    "hash": short,
                    "full_hash": full,
                    "ts": float(ts) if ts.isdigit() else None,
                    "subject": subject,
                })
        except Exception:
            entries = []
        return {"entries": entries, "count": len(entries),
                "commit": DEPLOYED_COMMIT}

    # ---- site search ---------------------------------------------------
    def _search(self, query, limit=30):
        """Search across the data the site already serves.

        Pure in-memory scan over projects, reading list, changelog, session
        log, and guestbook. No new data source, no external services — just a
        read-only index over what /api/* already exposes. Returns ranked hits
        with a snippet and the on-site anchor where each result lives.
        """
        q = (query or "").strip()
        if len(q) > 200:
            q = q[:200]
        if not q:
            return {"query": "", "count": 0, "results": []}
        terms = [t for t in q.lower().split() if t]

        # Each source yields (type, title, body, url) tuples.
        sources = []

        def add(type_, title, body, url):
            sources.append((type_, title or "", body or "", url or "#"))

        for p in read_json(PROJECTS_FILE, {"entries": []}).get("entries", []):
            add("project", p.get("title"), p.get("summary"), p.get("url") or "/#work")
        for r in read_json(READING_FILE, {"entries": []}).get("entries", []):
            add("reading", r.get("title"), r.get("take"), r.get("url") or "/#reading")
        for n in read_json(NOTES_FILE, {"entries": []}).get("entries", []):
            add("note", n.get("title"), n.get("body"), n.get("url") or "/notes.html")
        for c in self._changelog_list().get("entries", []):
            add("changelog", c.get("subject"), "", "/#changelog")
        for s in read_json(SESSIONS_FILE, {"entries": []}).get("entries", []):
            add("session", s.get("date"), s.get("action"), "/#logs")
        for g in read_json(GUESTBOOK_FILE, {"entries": []}).get("entries", []):
            add("guestbook", g.get("name"), g.get("message"), "/#guestbook")

        scored = []
        for type_, title, body, url in sources:
            hay = (title + " " + body).lower()
            if not any(t in hay for t in terms):
                continue
            score = 0
            for t in terms:
                score += title.lower().count(t) * 3
                score += body.lower().count(t)
            # Build a short snippet centered on the first match in the body.
            snippet = ""
            if body:
                low = body.lower()
                idx = len(body)
                for t in terms:
                    pos = low.find(t)
                    if pos != -1 and pos < idx:
                        idx = pos
                start = max(0, idx - 40)
                snippet = body[start:start + 160].strip()
                if start > 0:
                    snippet = "…" + snippet
                if start + 160 < len(body):
                    snippet = snippet + "…"
            scored.append({
                "type": type_,
                "title": title,
                "snippet": snippet,
                "url": url,
                "score": score,
            })
        scored.sort(key=lambda r: r["score"], reverse=True)
        return {
            "query": q,
            "count": len(scored),
            "results": scored[:limit],
        }

    # ---- self-check (live diagnostics) ---------------------------------
    def _selfcheck(self):
        """Probe this server's own endpoints over loopback and report health.

        The running process hits each target via the standard library urllib
        to 127.0.0.1:80 and records status code + latency. A 2xx/3xx counts
        as healthy; anything else (or a connection error) is a failure. The
        aggregate verdict is "ok" only if every target passed. This is a true
        runtime self-test, not a static manifest, and it's what the public
        /status.html diagnostics page renders.
        """
        base = "http://127.0.0.1:80"
        results = []
        worst = 0.0
        failures = 0
        for path, label in SELFCHECK_TARGETS:
            url = base + path
            t0 = time.time()
            try:
                req = urllib.request.Request(
                    url, method="GET",
                    headers={"User-Agent": "agent-05-selfcheck/1.0"})
                with urllib.request.urlopen(req, timeout=3) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            except Exception:  # noqa: BLE001
                code = 0
            dt_ms = round((time.time() - t0) * 1000, 1)
            worst = max(worst, dt_ms)
            ok = 200 <= code <= 399
            if not ok:
                failures += 1
            results.append({
                "path": path,
                "label": label,
                "status": code,
                "ok": ok,
                "ms": dt_ms,
            })
        verdict = "ok" if failures == 0 else "degraded"
        return {
            "verdict": verdict,
            "checked": len(results),
            "failures": failures,
            "worst_ms": worst,
            "server": self.server_version,
            "version": SITE_VERSION,
            "commit": DEPLOYED_COMMIT,
            "generated_epoch": time.time(),
            "results": results,
        }

    # ---- reading list --------------------------------------------------
    def _reading_list(self):
        data = read_json(READING_FILE, {"entries": []})
        entries = data.get("entries", [])
        # newest first; entries carry an "added" date (YYYY-MM-DD).
        entries = sorted(entries, key=lambda e: e.get("added", ""), reverse=True)
        return {"entries": entries, "count": len(entries)}

    # ---- notes (field notes) ------------------------------------------
    def _notes_list(self):
        data = read_json(NOTES_FILE, {"entries": []})
        entries = data.get("entries", [])
        # newest first; entries carry a "date" (YYYY-MM-DD).
        entries = sorted(entries, key=lambda e: e.get("date", ""), reverse=True)
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
            ("/search.html", "weekly", "0.3"),
            ("/api.html", "weekly", "0.3"),
            ("/fractal.html", "weekly", "0.4"),
            ("/notes.html", "weekly", "0.5"),
            ("/status.html", "weekly", "0.3"),
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
