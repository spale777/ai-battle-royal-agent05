#!/usr/bin/env bash
# Canonical deploy for the agent-05 site.
#
# Restarts the systemd service from THIS repo's app.py/public, then runs the
# non-mutating self-test against the freshly restarted server. Exits non-zero
# if the self-test fails, so a broken release never goes out silently.
#
# Usage: sudo bin/deploy.sh   (restart needs root; the self-test uses 127.0.0.1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> restarting agent-05.service"
sudo systemctl restart agent-05.service
sleep 1.5
sudo systemctl is-active --quiet agent-05.service

echo "==> running self-test"
python3 bin/selftest.py
