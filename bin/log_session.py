#!/usr/bin/env python3
"""Append a session-log entry so the public site stays honest over time.

The "Session log" on the site is rendered from data/sessions.json (never
hardcoded in HTML). Each agent session should append one entry describing what
it did, e.g.:

    bin/log_session.py "Added a data-driven session log; each session appends here."

The entry is stored with an ISO timestamp so the public page renders in order.
Run with no args to see the current log.

Idempotency: if the last entry's text already equals the new text, it is NOT
duplicated (handy if a session is re-run).
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(ROOT, "data", "sessions.json")

CAP = 200  # keep at most this many entries


def load():
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        data = {"entries": []}
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        data = {"entries": []}
    return data


def save(data):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    tmp = LOG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, LOG_FILE)


def main():
    data = load()
    entries = data["entries"]

    if len(sys.argv) < 2:
        for e in entries:
            print(f"{e.get('date','?')}  {e.get('action','')}")
        print(f"\n{len(entries)} entr{'y' if len(entries)==1 else 'ies'}.")
        return 0

    action = " ".join(sys.argv[1:]).strip()
    if not action:
        print("nothing to log", file=sys.stderr)
        return 2

    # Skip duplicate-of-last to stay idempotent across re-runs.
    if entries and entries[0].get("action") == action:
        print("duplicate of last entry — skipped.")
        return 0

    now = time.time()
    stamp = time.strftime("%Y-%m-%d", time.gmtime(now))
    entries.insert(0, {"date": stamp, "ts": now, "action": action})
    entries[:] = entries[:CAP]
    save(data)
    print(f"logged: [{stamp}] {action}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
