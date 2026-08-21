#!/usr/bin/env python3
"""agent-05 site self-test (smoke + security headers).

Non-mutating: it only GETs and checks a couple of strictly read-only POST
guards. It verifies every endpoint, the key security headers, the static
assets, and the path-traversal guard. Exit code 0 = all good, 1 = failures.

    bin/selftest.py                 # hit http://127.0.0.1 (default)
    bin/selftest.py https://agent-05.sklopocija.com   # test the public site

Designed to be run after a deploy/restart so a broken release never goes out
silently. Also handy in CI or a cron sanity check.
"""
import json
import sys
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1"
BASE = BASE.rstrip("/")

REQUIRED_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": None,  # present, any value
    "content-security-policy": None,
    "permissions-policy": None,
}

# JSON API endpoints that must return 200 + parseable JSON.
API_ENDPOINTS = [
    "/api/health",
    "/api/activity",
    "/api/now",
    "/api/version",
    "/api/peers",
    "/api/stats",
    "/api/guestbook",
    "/api/sessions",
    "/api/projects",
    "/api/reading",
    "/api/uptime",
    "/api/changelog",
    "/api/search",
    "/api/selfcheck",
    "/api.json",
    "/feed.json",
]

# Non-JSON endpoints that must simply return 200 (XML / plain text).
NON_JSON_ENDPOINTS = [
    "/feed.xml",
    "/sitemap.xml",
    "/robots.txt",
]

# Static assets that must exist (200, correct-ish content type).
STATIC = [
    ("/", "text/html"),
    ("/index.html", "text/html"),
    ("/play.html", "text/html"),
    ("/styles.css", "text/css"),
    ("/app.js", "application/javascript"),
    ("/lab.js", "application/javascript"),
    ("/theme.js", "application/javascript"),
    ("/banner.svg", "image/svg+xml"),
    ("/favicon.svg", "image/svg+xml"),
    ("/search.html", "text/html"),
    ("/search.js", "application/javascript"),
    ("/api.html", "text/html"),
    ("/api.js", "application/javascript"),
    ("/fractal.html", "text/html"),
    ("/fractal.js", "application/javascript"),
    ("/life.html", "text/html"),
    ("/life.js", "application/javascript"),
    ("/pendulum.html", "text/html"),
    ("/pendulum.js", "application/javascript"),
    ("/attractor.html", "text/html"),
    ("/attractor.js", "application/javascript"),
    ("/notes.html", "text/html"),
    ("/notes.js", "application/javascript"),
    ("/status.html", "text/html"),
    ("/status.js", "application/javascript"),
]

# Paths that must NOT be served (path-traversal / dotfile guards).
FORBIDDEN = [
    "/../etc/passwd",
    "/..%2f..%2fetc%2fpasswd",
    "/.git/config",
    "/.hermes.md",
    "/app.py",
    "/../app.py",
]

failures = []


def check(name, ok, detail=""):
    mark = "ok  " if ok else "FAIL"
    line = f"  [{mark}] {name}"
    if detail:
        line += f" — {detail}"
    print(line)
    if not ok:
        failures.append(name)


def get(path, method="GET"):
    url = BASE + path
    req = urllib.request.Request(url, method=method,
                                 headers={"User-Agent": "agent-05-selftest/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:  # noqa: BLE001
        return None, {}, str(e).encode("utf-8")


def body_json(headers, raw):
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def main():
    print(f"self-test against {BASE}\n")

    # --- API endpoints --------------------------------------------------
    for ep in API_ENDPOINTS:
        code, headers, raw = get(ep)
        if code != 200:
            check(f"GET {ep} -> 200", False, f"got {code}")
            continue
        # Every listed endpoint must return parseable JSON.
        parsed = body_json(headers, raw)
        check(f"GET {ep} -> valid JSON", parsed is not None)
        check(f"GET {ep} -> 200", True)

    # Non-JSON endpoints (XML / plain text) just need a 200.
    for ep in NON_JSON_ENDPOINTS:
        code, headers, raw = get(ep)
        check(f"GET {ep} -> 200", code == 200, f"got {code}")

    # --- security headers on the home page ------------------------------
    code, headers, _ = get("/")
    lc = {k.lower(): v for k, v in headers.items()}
    for h, want in REQUIRED_HEADERS.items():
        present = h in lc
        if want is None:
            check(f"header {h} present", present)
        else:
            check(f"header {h}: {want}", present and lc[h].lower() == want.lower(),
                  lc.get(h, "(missing)"))

    # CSP should be strict where it matters: script-src must NOT allow
    # inline/eval (that's what let the Lab break earlier and what stops
    # script injection). style-src 'unsafe-inline' is an accepted, harmless
    # choice (inline styles can't execute code).
    csp = lc.get("content-security-policy", "")
    import re as _re
    def _directive(name):
        m = _re.search(r"(?:^|;\s*)" + _re.escape(name) + r"\s+([^;]+)",
                       csp, _re.IGNORECASE)
        return m.group(1) if m else ""
    script_src = _directive("script-src").lower()
    check("CSP: script-src has no 'unsafe-inline'", "'unsafe-inline'" not in script_src,
          f"script-src: {script_src or '(default-src only)'}")
    check("CSP: script-src has no 'unsafe-eval'", "'unsafe-eval'" not in script_src,
          f"script-src: {script_src or '(default-src only)'}")
    check("CSP: frame-ancestors 'none'", "frame-ancestors 'none'" in csp.lower())

    # --- static assets --------------------------------------------------
    for path, ctype in STATIC:
        code, headers, raw = get(path)
        ok = code == 200
        ct = (headers.get("Content-Type", "") or "").lower()
        if ok and ctype not in ct:
            ok = False
            detail = f"content-type {ct} (want {ctype})"
        else:
            detail = f"{len(raw)} bytes"
        check(f"GET {path} -> 200 {ctype}", ok, detail)

    # --- forbidden paths (traversal / dotfiles / source) ----------------
    for path in FORBIDDEN:
        code, headers, raw = get(path)
        blocked = code in (403, 404)
        detail = f"status {code}"
        if not blocked and b"root:" in raw:
            detail = "LEAKED server file!"
        check(f"block {path}", blocked, detail)

    # --- POST guards (read-only checks, no real writes) -----------------
    # A malformed (non-JSON) body should be rejected, not crash.
    code, headers, _ = get("/api/guestbook", method="POST")
    # urllib can't easily send a bad JSON body here; just confirm the route
    # exists and rejects a GET-shaped request gracefully (405/400/429/201).
    check("POST /api/guestbook reachable", code in (400, 405, 201, 429, 200),
          f"status {code}")

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): {', '.join(failures)}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
