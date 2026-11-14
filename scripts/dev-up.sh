#!/usr/bin/env bash
#
# dev-up.sh — bring up the whole TenXLab stack for end-to-end testing.
#
# Starts, in order: the Docker daemon, minikube (with the ingress addon), the
# real KubeLab control plane, the IDE gateway, the NestJS API (KubeLab + projects
# enabled), and the Next.js web client. Idempotent: each step is skipped if the
# component is already up.
#
#   scripts/dev-up.sh            # start everything
#   scripts/dev-up.sh --status   # report what is up
#   scripts/dev-down.sh          # stop app processes (keeps minikube)
#
# Ports (see AGENTS.md "Public port layout"):
#   12000  web      (public work-1 host)
#    4000  api      (internal; web proxies /api/* to it)
#   12001  IDE gateway (public work-2 host)
#    8090  KubeLab control plane (port-forward, internal)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- configuration (override via environment) -------------------------------
PORT="${PORT:-4000}"
WEB_PORT="${WEB_PORT:-12000}"
IDE_PROXY_PORT="${IDE_PROXY_PORT:-12001}"
KUBELAB_PF_PORT="${KUBELAB_PF_PORT:-8090}"
KUBELAB_NAMESPACE="${KUBELAB_NAMESPACE:-kubelab}"
KUBELAB_ALLOWED_HOSTS="${KUBELAB_ALLOWED_HOSTS:-192.168.49.2.nip.io}"
KUBELAB_ADMIN_EMAIL="${KUBELAB_ADMIN_EMAIL:-tenxlab@tenxlab.local}"
KUBELAB_ADMIN_PASSWORD="${KUBELAB_ADMIN_PASSWORD:-tenxlab-dev-admin}"
# Public host that fronts per-session IDE ingress hosts (work-2). Override when
# the sandbox host changes.
KUBELAB_IDE_PUBLIC_URL="${KUBELAB_IDE_PUBLIC_URL:-https://work-2-kxblqdimavzxovqz.prod-runtime.all-hands.dev}"
LAB_ASSET_BASE_URL="${LAB_ASSET_BASE_URL:-http://host.minikube.internal:${PORT}}"
PROJECTS_TIER="${PROJECTS_TIER:-tier_3_vcluster}"
# Docker group access: the daemon socket is root:docker. If the current user is
# not in the docker group yet (common right after `usermod`), wrap in `sg docker`.
DOCKER_WRAP="${DOCKER_WRAP:-}"

LOG_DIR="${LOG_DIR:-/tmp/tenxlab}"
mkdir -p "$LOG_DIR"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

# docker_run runs a docker command, honouring DOCKER_WRAP (e.g. "sg docker").
docker_run() { if [ -n "$DOCKER_WRAP" ]; then $DOCKER_WRAP -c "docker $*"; else docker "$@"; fi; }

# kg runs kubectl, honouring DOCKER_WRAP so it inherits docker group membership.
kg() { if [ -n "$DOCKER_WRAP" ]; then $DOCKER_WRAP -c "kubectl $*"; else kubectl "$@"; fi; }

# mk runs minikube; it needs docker access, so it goes through DOCKER_WRAP too.
mk() { if [ -n "$DOCKER_WRAP" ]; then $DOCKER_WRAP -c "minikube $*"; else minikube "$@"; fi; }

# detect_docker_wrap: if the socket exists but the current shell cannot reach it
# directly (user not in the docker group yet), fall back to `sg docker`.
detect_docker_wrap() {
  [ -n "$DOCKER_WRAP" ] && return 0
  if ! docker info >/dev/null 2>&1 && command -v sg >/dev/null 2>&1 && sg docker -c "docker info" >/dev/null 2>&1; then
    DOCKER_WRAP="sg docker"
  fi
}

# docker_ok: true when the daemon is reachable through the configured wrapper.
docker_ok() { docker_run info >/dev/null 2>&1; }

# run_bg runs a command detached, writing to a log file. Honours DOCKER_WRAP so
# a process needing the docker group (minikube, kubectl port-forward) still gets
# it. setsid+nohup survive the wrapper shell exiting.
run_bg() { # logfile, command...
  local log="$1"; shift
  if [ -n "$DOCKER_WRAP" ]; then
    $DOCKER_WRAP -c "setsid nohup $(printf '%q ' "$@") > $(printf '%q' "$log") 2>&1 < /dev/null &"
  else
    setsid nohup "$@" > "$log" 2>&1 < /dev/null &
  fi
}

wait_for_http() { # url, tries, label
  local url="$1" tries="${2:-30}" label="${3:-$1}" i
  for i in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null "$url"; then ok "$label up"; return 0; fi
    sleep 2
  done
  warn "$label did not respond at $url"
  return 1
}

status() {
  detect_docker_wrap
  say "Stack status"
  docker_ok && ok "docker daemon" || warn "docker daemon down"
  [ "$(mk status --format='{{.Host}}' 2>/dev/null)" = "Running" ] && ok "minikube" || warn "minikube down"
  curl -sf -o /dev/null "http://localhost:${KUBELAB_PF_PORT}/api/health" && ok "kubelab (:$KUBELAB_PF_PORT)" || warn "kubelab down"
  curl -s -o /dev/null "http://localhost:${IDE_PROXY_PORT}/lab/x.y/" && ok "ide-gateway (:$IDE_PROXY_PORT)" || warn "ide-gateway down"
  curl -sf -o /dev/null "http://localhost:${PORT}/api/auth/session" && ok "api (:$PORT)" || warn "api down"
  curl -sf -o /dev/null "http://localhost:${WEB_PORT}/login" && ok "web (:$WEB_PORT)" || warn "web down"
}

if [ "${1:-}" = "--status" ]; then status; exit 0; fi

# --- 1. Docker daemon --------------------------------------------------------
say "Docker daemon"
detect_docker_wrap
if docker_ok; then
  ok "already running"
else
  sudo service docker start >/dev/null 2>&1 || true
  sleep 3
  if ! docker_ok; then
    sudo bash -c "nohup dockerd > '$LOG_DIR/dockerd.log' 2>&1 &"
    for _ in $(seq 1 15); do docker_ok && break; sleep 2; done
  fi
  detect_docker_wrap
  docker_ok && ok "daemon up" || die "docker daemon failed to start (see $LOG_DIR/dockerd.log)"
fi

# --- 2. minikube -------------------------------------------------------------
say "minikube cluster"
if [ -z "$(command -v minikube || true)" ]; then
  warn "minikube not found — installing to /usr/local/bin"
  curl -sLo /tmp/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64 \
    && chmod +x /tmp/minikube && sudo mv /tmp/minikube /usr/local/bin/minikube
fi
if [ -z "$(command -v kubectl || true)" ]; then
  warn "kubectl not found — installing to /usr/local/bin"
  KVER="$(curl -sL https://dl.k8s.io/release/stable.txt)"
  curl -sLo /tmp/kubectl "https://dl.k8s.io/release/${KVER}/bin/linux/amd64/kubectl" \
    && chmod +x /tmp/kubectl && sudo mv /tmp/kubectl /usr/local/bin/kubectl
fi
if [ "$(mk status --format='{{.Host}}' 2>/dev/null)" = "Running" ]; then
  ok "already running"
else
  warn "starting minikube (first run pulls a ~500MB base image)"
  run_bg "$LOG_DIR/minikube.log" minikube start --driver=docker --cpus=2 --memory=6g --kubernetes-version=v1.31.0 --addons=ingress
  for _ in $(seq 1 60); do
    [ "$(mk status --format='{{.Host}}' 2>/dev/null)" = "Running" ] && break
    sleep 10
  done
  [ "$(mk status --format='{{.Host}}' 2>/dev/null)" = "Running" ] || die "minikube failed to start (see $LOG_DIR/minikube.log)"
  ok "minikube up"
fi
mk update-context >/dev/null 2>&1 || true
NODE_IP="$(mk ip 2>/dev/null || echo 192.168.49.2)"
ok "node IP $NODE_IP"

for _ in $(seq 1 30); do
  [ "$(kg get node minikube -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ] && break
  sleep 5
done

# --- 3. KubeLab control plane ------------------------------------------------
say "KubeLab control plane"
kg apply -f deploy/kubelab/kubelab.yaml >/dev/null 2>&1 || true
# The ingress admission webhook needs a moment before it accepts Ingresses.
for _ in $(seq 1 30); do
  [ "$(kg -n ingress-nginx get pods -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null)" = "true" ] && break
  sleep 5
done
kg apply -f deploy/kubelab/kubelab.yaml >/dev/null 2>&1
for _ in $(seq 1 30); do
  [ "$(kg -n "$KUBELAB_NAMESPACE" get statefulset kubelab -o jsonpath='{.status.readyReplicas}' 2>/dev/null)" = "1" ] && break
  sleep 5
done
ok "kubelab pod ready"

if curl -sf -o /dev/null "http://localhost:${KUBELAB_PF_PORT}/api/health"; then
  ok "port-forward already on :${KUBELAB_PF_PORT}"
else
  kg -n "$KUBELAB_NAMESPACE" port-forward svc/kubelab-service "${KUBELAB_PF_PORT}:8090" > "$LOG_DIR/kubelab-pf.log" 2>&1 &
  wait_for_http "http://localhost:${KUBELAB_PF_PORT}/api/health" 20 "kubelab control plane (:$KUBELAB_PF_PORT)" || true
fi

# Create the admin the API authenticates as. KubeLab's create endpoint returns
# 400/401 once any admin exists, so confirm by signing in instead of by status.
curl -s -o /dev/null -X POST "http://localhost:${KUBELAB_PF_PORT}/api/admins" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${KUBELAB_ADMIN_EMAIL}\",\"password\":\"${KUBELAB_ADMIN_PASSWORD}\",\"passwordConfirm\":\"${KUBELAB_ADMIN_PASSWORD}\"}" || true
if curl -sf -o /dev/null -X POST "http://localhost:${KUBELAB_PF_PORT}/api/admins/auth-with-password" \
     -H 'content-type: application/json' \
     -d "{\"identity\":\"${KUBELAB_ADMIN_EMAIL}\",\"password\":\"${KUBELAB_ADMIN_PASSWORD}\"}"; then
  ok "KubeLab admin ${KUBELAB_ADMIN_EMAIL} authenticates"
else
  warn "KubeLab admin ${KUBELAB_ADMIN_EMAIL} cannot authenticate"
fi

# --- 3b. Tier-2 pod provider credentials ------------------------------------
# The demo project forks a `tier_2_container` workspace, served by our own
# PodProvider (code-server + terminal, no vcluster). When the API runs on the
# dev host it authenticates to the cluster with a ServiceAccount token, so mint
# one and write a self-contained kubeconfig the API can load.
say "Tier-2 pod provider"
if [ "${POD_PROVIDER_ENABLED:-true}" = "true" ]; then
  kg apply -f deploy/lab-operator/rbac.yaml >/dev/null 2>&1
  KUBECONFIG_TOKEN="${KUBECONFIG_TOKEN:-$LOG_DIR/kubeconfig-token.yaml}"
  SA_TOKEN="$(kg -n tenxlab-system create token tenxlab-lab-operator --duration=24h 2>/dev/null)"
  if [ -n "$SA_TOKEN" ]; then
    CA_DATA="$(base64 -w0 "${HOME}/.minikube/ca.crt" 2>/dev/null)"
    API_SERVER="https://${NODE_IP}:8443"
    printf 'server: %s\ntoken: %s\ncertificate-authority-data: %s\n' \
      "$API_SERVER" "$SA_TOKEN" "$CA_DATA" > "$KUBECONFIG_TOKEN"
    ok "wrote token kubeconfig ($KUBECONFIG_TOKEN)"
  else
    warn "could not mint a ServiceAccount token; tier-2 forks will fail"
  fi
else
  ok "disabled"
fi

# --- 4. IDE gateway ----------------------------------------------------------
say "IDE gateway"
if curl -s -o /dev/null "http://localhost:${IDE_PROXY_PORT}/lab/x.y/"; then
  ok "already on :${IDE_PROXY_PORT}"
else
  pkill -f "ide-gateway.mjs" 2>/dev/null || true
  sleep 1
  IDE_PROXY_PORT="$IDE_PROXY_PORT" nohup node deploy/kubelab/ide-gateway.mjs > "$LOG_DIR/ide-gateway.log" 2>&1 &
  sleep 2
  ok "gateway on :${IDE_PROXY_PORT}"
fi

# --- 4b. Tier-1 execution pool (Piston) --------------------------------------
# Backs the Editor's Run button. Optional: if Docker Compose is unavailable the
# step warns and the API starts with PISTON_ENABLED=false (Run returns 503).
say "Tier-1 execution pool (Piston)"
if curl -sf -o /dev/null "http://localhost:2000/api/v2/runtimes"; then
  ok "piston (:2000) up"
elif command -v docker >/dev/null 2>&1 && docker_run compose version >/dev/null 2>&1; then
  docker_run compose --profile runner up -d piston >/dev/null 2>&1 \
    && wait_for_http "http://localhost:2000/api/v2/runtimes" 30 "piston (:2000)" \
    || warn "piston did not start; Editor Run will return 503"
else
  warn "docker compose unavailable; skipping piston (Editor Run will return 503)"
fi

# The stock image ships only a handful of runtimes (python, javascript, java, c,
# c++, sqlite3); the Editor catalog is larger. Install any missing ones so Run
# works for every offered language. Idempotent; skips cleanly when Piston is off.
if curl -sf -o /dev/null "http://localhost:2000/api/v2/runtimes"; then
  say "Piston runtimes (Editor language catalog)"
  # language[:version] — keep in sync with EDITOR_LANGUAGES in packages/contracts.
  EDITOR_PISTON_RUNTIMES="python javascript java c c++ sqlite3 csharp go rust php ruby kotlin bash"
  have_runtimes="$(curl -s "http://localhost:2000/api/v2/runtimes" 2>/dev/null || echo '[]')"
  installed=0
  for runtime in $EDITOR_PISTON_RUNTIMES; do
    if printf '%s' "$have_runtimes" | grep -q "\"language\":\"${runtime}\""; then
      continue
    fi
    if curl -s -X POST "http://localhost:2000/api/v2/packages" \
        -H 'content-type: application/json' \
        -d "{\"language\":\"${runtime}\",\"version\":\"*\"}" >/dev/null 2>&1; then
      installed=$((installed + 1))
    else
      warn "could not install piston runtime: ${runtime}"
    fi
  done
  if [ "$installed" -gt 0 ]; then
    ok "installed ${installed} editor runtime(s)"
  else
    ok "all editor runtimes present"
  fi
fi

# --- 5. API ------------------------------------------------------------------
say "API"
pkill -f "apps/api/dist/main.js" 2>/dev/null || true
sleep 2
# The sandbox itself runs inside a pod, so KUBERNETES_SERVICE_HOST/PORT point at
# the *outer* cluster. Unset them so the PodProvider's KubernetesClient loads the
# token kubeconfig for minikube instead of trying the wrong API server.
env -u KUBERNETES_SERVICE_HOST -u KUBERNETES_SERVICE_PORT \
  PORT="$PORT" \
  KUBELAB_ENABLED=true \
  KUBELAB_BASE_URL="http://localhost:${KUBELAB_PF_PORT}" \
  KUBELAB_ADMIN_EMAIL="$KUBELAB_ADMIN_EMAIL" \
  KUBELAB_ADMIN_PASSWORD="$KUBELAB_ADMIN_PASSWORD" \
  KUBELAB_ALLOWED_HOSTS="$KUBELAB_ALLOWED_HOSTS" \
  KUBELAB_IDE_SCHEME=https \
  KUBELAB_IDE_PUBLIC_URL="$KUBELAB_IDE_PUBLIC_URL" \
  LAB_ASSET_BASE_URL="$LAB_ASSET_BASE_URL" \
  PROJECTS_ENABLED=true \
  PROJECTS_TIER="$PROJECTS_TIER" \
  POD_PROVIDER_ENABLED="${POD_PROVIDER_ENABLED:-true}" \
  PISTON_ENABLED="${PISTON_ENABLED:-true}" \
  PISTON_BASE_URL="${PISTON_BASE_URL:-http://localhost:2000}" \
  KUBECONFIG="${KUBECONFIG_TOKEN:-$LOG_DIR/kubeconfig-token.yaml}" \
  nohup node apps/api/dist/main.js > "$LOG_DIR/api.log" 2>&1 &
wait_for_http "http://localhost:${PORT}/api/auth/session" 20 "api (:$PORT)" || die "api failed to start (see $LOG_DIR/api.log)"

# --- 6. Web ------------------------------------------------------------------
say "Web"
if curl -sf -o /dev/null "http://localhost:${WEB_PORT}/login"; then
  ok "already on :${WEB_PORT}"
else
  pkill -f "next start -p ${WEB_PORT}" 2>/dev/null || true
  sleep 1
  ( cd apps/web && API_BASE_URL="http://localhost:${PORT}" nohup npx next start -p "$WEB_PORT" > "$LOG_DIR/web.log" 2>&1 & )
  wait_for_http "http://localhost:${WEB_PORT}/login" 20 "web (:$WEB_PORT)" || die "web failed to start (see $LOG_DIR/web.log)"
fi

say "Stack up"
cat <<EOF
  web          http://localhost:${WEB_PORT}      (public: work-1 host)
  api          http://localhost:${PORT}
  IDE gateway  http://localhost:${IDE_PROXY_PORT}      (public: work-2 host)
  kubelab      http://localhost:${KUBELAB_PF_PORT}  (port-forward)

  logs:        ${LOG_DIR}/{api,web,minikube,kubelab-pf,ide-gateway}.log
  demo login:  student@tenxlab.local / demo1234  (instructor@tenxlab.local)

  smoke test:  scripts/dev-smoke.sh
  tear down:   scripts/dev-down.sh
EOF
