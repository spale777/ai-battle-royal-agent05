#!/usr/bin/env python3
"""Probe the local site and append a self-monitoring record.

Checks http://127.0.0.1:80/api/health, records up/down + latency, and
maintains data/uptime.json with a long-horizon uptime summary plus a short
ring buffer for a sparkline. Runs on a systemd timer (every 2 minutes) so
the site can show a real, self-collected reliability number.

Storage is bounded: a cumulative up/total counter gives true long-horizon
uptime % without unbounded growth, and only the most recent RING_CAP checks
are kept for the sparkline.

Idempotency: if the last probe was within MIN_GAP seconds, the run is a no-op
(so a manual re-run or timer overlap won't double-count).
"""
import json
import os
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UPTIME_FILE = os.path.join(DATA, "uptime.json")
PROBE_URL = "http://127.0.0.1:80/api/health"

RING_CAP = 180      # recent checks kept for the sparkline (~6h at 2 min)
MIN_GAP = 15        # ignore re-runs within this many seconds


def load():
    try:
        with open(UPTIME_FILE, "r", encoding="utf-8") as fh:
            d = json.load(fh)
    except Exception:
        d = {}
    d.setdefault("up_count", 0)
    d.setdefault("total_count", 0)
    d.setdefault("first_epoch", None)
    d.setdefault("last_epoch", None)
    d.setdefault("last_status", None)
    d.setdefault("last_ms", None)
    d.setdefault("ring", [])
    if not isinstance(d["ring"], list):
        d["ring"] = []
    return d


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def probe_once():
    """Return (up: bool, ms: float) for a single attempt."""
    t0 = time.time()
    try:
        req = urllib.request.Request(
            PROBE_URL, method="GET",
            headers={"User-Agent": "agent-05-uptime-probe/1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            ok = r.status == 200
            raw = r.read(256)
        try:
            j = json.loads(raw)
            ok = ok and isinstance(j, dict) and j.get("status") == "ok"
        except Exception:
            pass
        ms = round((time.time() - t0) * 1000, 1)
        return bool(ok), ms
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        ms = round((time.time() - t0) * 1000, 1)
        return False, ms


def probe():
    """Return (up: bool, ms: float).

    A single retry with a short backoff avoids recording a spurious 'down'
    during the ~1s gap of a deploy/restart of the main service.
    """
    up, ms = probe_once()
    if up:
        return up, ms
    time.sleep(1.5)
    return probe_once()


def main():
    data = load()
    now = time.time()

    # Idempotency: skip if the last probe was too recent.
    if data["last_epoch"] and (now - float(data["last_epoch"])) < MIN_GAP:
        ago = int(now - float(data["last_epoch"]))
        print(f"skipped: last probe {ago}s ago (< {MIN_GAP}s)")
        return 0

    up, ms = probe()
    data["total_count"] += 1
    if up:
        data["up_count"] += 1
    if data["first_epoch"] is None:
        data["first_epoch"] = now
    data["last_epoch"] = now
    data["last_status"] = "up" if up else "down"
    data["last_ms"] = ms
    data["ring"].insert(0, {"t": now, "up": up, "ms": ms})
    data["ring"] = data["ring"][:RING_CAP]
    write_json(UPTIME_FILE, data)

    pct = (data["up_count"] / data["total_count"] * 100) if data["total_count"] else 0.0
    print(f"probe: {'UP' if up else 'DOWN'} in {ms}ms — "
          f"uptime {pct:.2f}% over {data['total_count']} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
