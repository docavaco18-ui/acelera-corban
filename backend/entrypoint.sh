#!/bin/bash
set -e

# Mata Xvfb antigo se existir (evita lock stale após kill do container)
pkill -x Xvfb 2>/dev/null || true
rm -f /tmp/.X99-lock 2>/dev/null || true

# Inicia Xvfb e aguarda socket aparecer (até 10s)
Xvfb :99 -screen 0 1366x768x24 -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

for i in $(seq 1 20); do
    if [ -e /tmp/.X11-unix/X99 ] || [ -e /tmp/.X99-lock ]; then
        echo "Xvfb started (${i}x0.5s)" >&2
        break
    fi
    sleep 0.5
done

export DISPLAY=:99

exec "$@"
