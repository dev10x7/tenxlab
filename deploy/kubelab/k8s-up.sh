#!/bin/sh
#
# k8s-up.sh — bootstrap the compose lab execution plane.
#
# Runs once as the `k8s-up` compose service and exits when the plane is ready,
# so the API can depend on it (`service_completed_successfully`) and start with
# a cluster already serving labs. Idempotent: a second `docker compose up`
# detects the existing cluster and only re-checks readiness.
#
# Steps: create the kind cluster on the compose `labs` network, install
# ingress-nginx, apply KubeLab, mint the KubeLab admin, and write the API's
# kubeconfig.
#
# On the node address: per-session IDE ingress hosts are
# `kubelab-<...>.<node-ip>.nip.io`, and the API's kubeconfig targets the same
# address, so it has to be known before `api` starts — it cannot be discovered
# later. It also cannot be pinned after creation: kind bakes the boot-time
# advertise address into the control-plane static pod manifests, so moving the
# node afterwards leaves the apiserver crashlooping. Instead the node takes a
# deterministic address by construction: every other member of the `labs`
# network is on a static address, so Docker's IPAM hands the node the first free
# one, `LAB_NODE_IP`. The check below fails loudly if that invariant breaks.
set -eu

LAB_NODE_IP="${LAB_NODE_IP:-192.168.240.2}"
LAB_DOCKER_NETWORK="${LAB_DOCKER_NETWORK:-tenxlab_labs}"
CLUSTER_NAME="${CLUSTER_NAME:-tenxlab}"
KIND_NODE_IMAGE="${KIND_NODE_IMAGE:-kindest/node:v1.31.0}"
KUBELAB_NAMESPACE="${KUBELAB_NAMESPACE:-kubelab}"
KUBELAB_ALLOWED_HOSTS="${KUBELAB_ALLOWED_HOSTS:-${LAB_NODE_IP}.nip.io}"
KUBELAB_ADMIN_EMAIL="${KUBELAB_ADMIN_EMAIL:-tenxlab@tenxlab.local}"
KUBELAB_ADMIN_PASSWORD="${KUBELAB_ADMIN_PASSWORD:-tenxlab-dev-admin}"
KUBECONFIG_OUT="${KUBECONFIG_OUT:-/kubeconfig/config}"
INGRESS_MANIFEST_URL="${INGRESS_MANIFEST_URL:-https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/kind/deploy.yaml}"
NODE_CONTAINER="${CLUSTER_NAME}-control-plane"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# The node is created on this network and reached by its address on it, so every
# kind call that resolves the node must agree on the network.
export KIND_EXPERIMENTAL_DOCKER_NETWORK="$LAB_DOCKER_NETWORK"

say "kind cluster '$CLUSTER_NAME'"
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  ok "already exists"
else
  # kind ignores an unset/blank network silently, which would strand the node
  # on its own bridge and make it unreachable from the API. Fail loudly instead.
  docker network inspect "$LAB_DOCKER_NETWORK" >/dev/null 2>&1 \
    || die "docker network '$LAB_DOCKER_NETWORK' not found; is the compose stack up?"
  sed "s/__LAB_NODE_IP__/${LAB_NODE_IP}/" /etc/kind/kind-compose.yaml > /tmp/kind.yaml
  kind create cluster --config /tmp/kind.yaml --image "$KIND_NODE_IMAGE" --wait 300s
fi

# The node's address is the one the API and every IDE ingress host are built
# from, so a mismatch is fatal rather than something to paper over.
ACTUAL_IP="$(docker inspect "$NODE_CONTAINER" \
  --format "{{(index .NetworkSettings.Networks \"$LAB_DOCKER_NETWORK\").IPAddress}}" 2>/dev/null || true)"
[ "$ACTUAL_IP" = "$LAB_NODE_IP" ] || die "node is at '$ACTUAL_IP' but LAB_NODE_IP is '$LAB_NODE_IP'.
      Delete the cluster (kind delete cluster --name $CLUSTER_NAME) and the
      network (docker network rm $LAB_DOCKER_NETWORK), then re-run."
ok "node at $LAB_NODE_IP"

# kubeconfig for this bootstrap's own kubectl calls. kind writes a loopback
# server address that does not resolve here; point it at the node instead.
say "kubeconfig"
export KUBECONFIG=/tmp/bootstrap-kubeconfig
kind export kubeconfig --name "$CLUSTER_NAME" --kubeconfig "$KUBECONFIG"
sed -i "s#https://127.0.0.1:[0-9]*#https://${LAB_NODE_IP}:6443#" "$KUBECONFIG"
ok "server https://${LAB_NODE_IP}:6443"

# ingress-nginx terminates the per-session code-server ingress hosts. The
# upstream `kind` manifest schedules its controller onto the labelled node.
say "ingress-nginx"
if kubectl get namespace ingress-nginx >/dev/null 2>&1; then
  ok "already installed"
else
  kubectl apply -f "$INGRESS_MANIFEST_URL"
fi
# The controller pod is created asynchronously after the deployment, so
# `kubectl wait` can run before the label matches anything; poll instead.
ready=""
i=0
while [ "$i" -lt 60 ]; do
  ready="$(kubectl -n ingress-nginx get pods -l app.kubernetes.io/component=controller \
    -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || true)"
  [ "$ready" = "true" ] && break
  i=$((i + 1))
  sleep 5
done
[ "$ready" = "true" ] || die "ingress-nginx controller did not become ready"
ok "controller ready"

# KubeLab control plane. The committed manifest targets minikube's fixed node
# IP; retarget its wildcard host base to this cluster's address.
say "KubeLab control plane"
sed "s/192\.168\.49\.2\.nip\.io/${KUBELAB_ALLOWED_HOSTS}/g" /etc/kind/kubelab.yaml > /tmp/kubelab.yaml
kubectl apply -f /tmp/kubelab.yaml
kubectl -n "$KUBELAB_NAMESPACE" rollout status statefulset/kubelab --timeout=300s
ok "KubeLab ready (IDE hosts *.${KUBELAB_ALLOWED_HOSTS})"

# RBAC for the tier-2 pod provider, which talks to the API server directly.
# Then mint a ServiceAccount token kubeconfig: the API's kubeconfig reader
# understands token auth, not kind's client certificates.
say "tier-2 pod provider RBAC"
kubectl apply -f /etc/kind/rbac.yaml
SA_TOKEN="$(kubectl -n tenxlab-system create token tenxlab-lab-operator --duration=8760h)"
CA_DATA="$(kubectl get configmap kube-root-ca.crt -o jsonpath='{.data.ca\.crt}' | base64 -w0)"
mkdir -p "$(dirname "$KUBECONFIG_OUT")"
printf 'server: https://%s:6443\ntoken: %s\ncertificate-authority-data: %s\n' \
  "$LAB_NODE_IP" "$SA_TOKEN" "$CA_DATA" > "$KUBECONFIG_OUT"
chmod 644 "$KUBECONFIG_OUT"
ok "wrote $KUBECONFIG_OUT (token auth, https://${LAB_NODE_IP}:6443)"

# The API authenticates to KubeLab's admin-only control API, so create the
# admin once. Creation 400s once any admin exists, so confirm by signing in.
say "KubeLab admin"
kubectl -n "$KUBELAB_NAMESPACE" port-forward svc/kubelab-service 8090:8090 >/tmp/pf.log 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT INT TERM
i=0
while [ "$i" -lt 30 ]; do
  curl -sf -o /dev/null http://localhost:8090/api/health && break
  i=$((i + 1))
  sleep 2
done
curl -s -o /dev/null -X POST http://localhost:8090/api/admins \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${KUBELAB_ADMIN_EMAIL}\",\"password\":\"${KUBELAB_ADMIN_PASSWORD}\",\"passwordConfirm\":\"${KUBELAB_ADMIN_PASSWORD}\"}" || true
if curl -sf -o /dev/null -X POST http://localhost:8090/api/admins/auth-with-password \
     -H 'content-type: application/json' \
     -d "{\"identity\":\"${KUBELAB_ADMIN_EMAIL}\",\"password\":\"${KUBELAB_ADMIN_PASSWORD}\"}"; then
  ok "${KUBELAB_ADMIN_EMAIL} authenticates"
else
  echo "warning: ${KUBELAB_ADMIN_EMAIL} cannot authenticate" >&2
fi
kill "$PF_PID" 2>/dev/null || true
trap - EXIT INT TERM

printf '\n\033[1;32mlab execution plane ready\033[0m\n'
