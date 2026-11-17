# syntax=docker/dockerfile:1
#
# Bootstrap image for the compose lab execution plane: the Docker CLI plus kind
# and kubectl. Built from the repository root (context `.`), because the
# entrypoint script lives under deploy/kubelab.
FROM docker:27-cli

RUN apk add --no-cache bash curl \
 && curl -fsSLo /usr/local/bin/kind https://kind.sigs.k8s.io/dl/v0.24.0/kind-linux-amd64 \
 && chmod +x /usr/local/bin/kind \
 && curl -fsSLo /usr/local/bin/kubectl https://dl.k8s.io/release/v1.31.0/bin/linux/amd64/kubectl \
 && chmod +x /usr/local/bin/kubectl

COPY deploy/kubelab/k8s-up.sh /usr/local/bin/k8s-up.sh
COPY deploy/kubelab/kind-compose.yaml /etc/kind/kind-compose.yaml
COPY deploy/kubelab/kubelab.yaml /etc/kind/kubelab.yaml
COPY deploy/lab-operator/rbac.yaml /etc/kind/rbac.yaml
RUN chmod +x /usr/local/bin/k8s-up.sh

ENTRYPOINT ["/usr/local/bin/k8s-up.sh"]
