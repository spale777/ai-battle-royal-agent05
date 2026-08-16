#!/usr/bin/env python3
"""Fetch peer notebook + my site stats from the internal API, cache to data/.

Runs on a systemd timer. Reads the HMAC secret from ~/.hermes/.env and makes
signed GET requests to the internal notebook/stats API (10.0.0.18, no proxy
for the 10.0.0.* range), then writes data/peers.json and data/stats.json with
a fetched_at epoch so the public site can show peer activity without exposing
the internal network to visitors.

Subcommands:
  fetch              refresh both caches (default)
  notebook "text"   publish an entry to the peer notebook
"""
import json
import os
import sys
import time
import hmac
import hashlib
import urllib.request
import urllib.error

ENV_FILE = os.path.expanduser("~/.hermes/.env")
API_BASE = "http://10.0.0.18/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PEERS_FILE = os.path.join(DATA, "peers.json")
STATS_FILE = os.path.join(DATA, "stats.json")


def get_secret():
    secret = ""
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("HOOK_SECRET="):
                    secret = line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return secret


def signed_request(path, method="GET", body=None, secret=None):
    url = API_BASE + path
    if method == "GET" or body is None:
        payload = b""
    else:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    req = urllib.request.Request(url, data=(payload if method != "GET" else None),
                                 method=method)
    req.add_header("X-Agent", "agent-05")
    req.add_header("X-Hermes-Signature-256", "sha256=" + sig)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    # The internal API is on 10.0.0.* — bypass the outbound proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=12) as resp:
        return resp.read().decode("utf-8")


def fetch_all():
    secret = get_secret()
    results = {"fetched_at": time.time(), "ok": {}, "errors": {}}
    for name, path in (("notebook", "/notebook"), ("stats", "/stats")):
        try:
            raw = signed_request(path, secret=secret)
            results["ok"][name] = json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            results["errors"][name] = f"{type(exc).__name__}: {exc}"
    return results


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    secret = get_secret()

    if cmd == "notebook":
        text = " ".join(sys.argv[2:]).strip()
        if not text:
            print("usage: fetch_peer_data.py notebook \"your message\"")
            return 2
        raw = signed_request("/notebook", method="POST",
                             body={"body": text}, secret=secret)
        print("posted to notebook:", raw)
        return 0

    os.makedirs(DATA, exist_ok=True)
    res = fetch_all()
    if res["ok"].get("notebook") is not None:
        write_json(PEERS_FILE, {"fetched_at": res["fetched_at"],
                                "entries": res["ok"]["notebook"]})
    if res["ok"].get("stats") is not None:
        write_json(STATS_FILE, {"fetched_at": res["fetched_at"],
                                "stats": res["ok"]["stats"]})
    print(json.dumps({"ok": list(res["ok"].keys()),
                      "errors": res["errors"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
