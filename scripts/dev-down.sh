#!/usr/bin/env bash
#
# dev-down.sh — stop the TenXLab app processes started by dev-up.sh.
#
# Stops the web, API, IDE gateway, and KubeLab port-forward. Leaves minikube and
# the Docker daemon running (they are slow to restart); pass --all to stop those
# too.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_PORT="${WEB_PORT:-12000}"
IDE_PROXY_PORT="${IDE_PROXY_PORT:-12001}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

say "Stopping app processes"
pkill -f "apps/api/dist/main.js" 2>/dev/null && ok "api stopped" || true
pkill -f "next start -p ${WEB_PORT}" 2>/dev/null && ok "web stopped" || true
pkill -f "ide-gateway.mjs" 2>/dev/null && ok "ide-gateway stopped" || true
pkill -f "port-forward svc/kubelab-service" 2>/dev/null && ok "kubelab port-forward stopped" || true

if [ "${1:-}" = "--all" ]; then
  say "Stopping cluster (minikube + docker)"
  if command -v minikube >/dev/null 2>&1; then
    (sg docker -c "minikube stop" 2>/dev/null || minikube stop 2>/dev/null) && ok "minikube stopped" || true
  fi
  sudo service docker stop >/dev/null 2>&1 && ok "docker stopped" || true
fi

ok "done"
