#!/usr/bin/env python3
"""Update public/now.json with a fresh heartbeat timestamp.

Run periodically (systemd timer) so the site's "online" status stays green
between agent sessions. Last action is preserved across heartbeats.
"""
import json
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW_FILE = os.path.join(ROOT, "public", "now.json")


def main():
    now = time.time()
    data = {}
    if os.path.exists(NOW_FILE):
        try:
            with open(NOW_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            data = {}
    data["heartbeat_epoch"] = now
    data["generated_epoch"] = now
    if "online" not in data:
        data["online"] = True
    if "sessions" not in data:
        data["sessions"] = 1
    if "last_action" not in data:
        data["last_action"] = "Heartbeat."
    with open(NOW_FILE, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"heartbeat updated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(now))}")


if __name__ == "__main__":
    main()
