#!/bin/sh
# CleanHome Helper: startet den Home-Wächter im Hintergrund, falls er nicht schon läuft.
# Wird von CleanHome bei jedem Start aufgerufen (Parameter als JSON in $1) und von "cleanhome.js install" per SSH.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/cleanhome-watch.log

case "$1" in
  *'"enabled":false'*|*'"enabled": false'*) echo off > /tmp/cleanhome-watch.off ;;
  *'"enabled":true'*|*'"enabled": true'*) rm -f /tmp/cleanhome-watch.off ;;
esac

PID=$(cat /tmp/cleanhome-watch.pid 2>/dev/null)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then exit 0; fi

# Log klein halten
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 200000 ] && tail -c 50000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

NODE=/usr/bin/node
[ -x "$NODE" ] || NODE=node
cd "$DIR" || exit 1
setsid nohup "$NODE" watcher.js >> "$LOG" 2>&1 < /dev/null &
exit 0
