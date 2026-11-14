import { readFileSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { ClusterClient } from './pod.provider';

/**
 * Minimal Kubernetes API client.
 *
 * The operator needs only create-or-replace, get, list and delete on namespaced
 * objects, so this talks to the API server directly instead of pulling in the
 * (large, ESM-only) `@kubernetes/client-node`. That keeps the operator's
 * dependency surface tiny and the license gate trivial.
 *
 * Config comes from the usual in-cluster or kubeconfig locations.
 */
export interface K8sClientOptions {
  /** API server base URL. Defaults to the in-cluster env or kubeconfig. */
  serverUrl?: string;
  /** Bearer token for the API server. */
  token?: string;
  /** CA certificate (PEM) used to verify the API server. */
  caCert?: string;
  /** Skip TLS verification. Only for local development. */
  insecureSkipTlsVerify?: boolean;
}

export class KubernetesClient implements ClusterClient {
  private readonly serverUrl: string;
  private readonly token?: string;
  private readonly caCert?: string;
  private readonly insecure: boolean;

  constructor(opts: K8sClientOptions = {}) {
    const resolved = opts.serverUrl ? opts : { ...loadKubeConfig(), ...opts };
    this.serverUrl = (resolved.serverUrl ?? 'https://kubernetes.default.svc').replace(/\/$/, '');
    this.token = resolved.token;
    this.caCert = resolved.caCert;
    this.insecure = resolved.insecureSkipTlsVerify ?? false;
  }

  async apply(manifest: Record<string, unknown>): Promise<void> {
    const meta = manifest.metadata as { name?: string; namespace?: string } | undefined;
    const name = meta?.name;
    if (!name) throw new Error('manifest is missing metadata.name');
    const namespace = meta?.namespace;
    const path = objectPath(manifest, name, namespace);
    const existing = await this.tryGet(path);
    await this.send(existing ? 'PATCH' : 'POST', existing ? path : collectionPath(manifest, namespace), manifest, existing ? 'application/merge-patch+json' : 'application/json');
  }

  async delete(kind: string, name: string, namespace: string): Promise<void> {
    const path = apiPath(kind, namespace, name);
    const res = await this.send('DELETE', path, undefined, 'application/json', [200, 202, 404]);
    void res;
  }

  async get(kind: string, name: string, namespace: string): Promise<Record<string, unknown> | null> {
    const res = await this.send('GET', apiPath(kind, namespace, name), undefined, 'application/json', [200, 404]);
    return res.status === 404 ? null : (res.body as Record<string, unknown>);
  }

  async list(kind: string, namespace: string): Promise<Record<string, unknown>[]> {
    const res = await this.send('GET', apiPath(kind, namespace, undefined), undefined, 'application/json');
    const body = res.body as { items?: Record<string, unknown>[] };
    return body.items ?? [];
  }

  private async tryGet(path: string): Promise<boolean> {
    const res = await this.send('GET', path, undefined, 'application/json', [200, 404]);
    return res.status === 200;
  }

  private send(
    method: string,
    path: string,
    body?: unknown,
    contentType = 'application/json',
    okStatuses: number[] = [200, 201, 202],
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(`${this.serverUrl}${path}`);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (payload !== undefined) {
      headers['content-type'] = contentType;
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    if (this.token) headers['authorization'] = `Bearer ${this.token}`;

    const requestFn = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const options = {
      method,
      headers,
      ...(url.protocol === 'http:'
        ? {}
        : { ca: this.caCert, rejectUnauthorized: !this.insecure }),
    };

    return new Promise((resolve, reject) => {
      const req = requestFn(url, options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (!okStatuses.includes(status)) {
            reject(new Error(`k8s ${method} ${path} failed (${status}): ${text.slice(0, 500)}`));
            return;
          }
          let parsed: unknown = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = text;
          }
          resolve({ status, body: parsed });
        });
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}

/**
 * Build the API path for an object. Core kinds (Namespace, Pod, Service, ...)
 * live under `/api/v1`; everything else under `/apis/<group>/<version>`. We only
 * need core v1 and networking.k8s.io/v1 here.
 */
function apiPath(kind: string, namespace: string, name?: string): string {
  const base = kindGroup(kind);
  const nsPart = namespace ? `/namespaces/${namespace}` : '';
  const namePart = name ? `/${name}` : '';
  return `${base}${nsPart}/${kindPlural(kind)}${namePart}`;
}

function collectionPath(manifest: Record<string, unknown>, namespace?: string): string {
  return apiPath(String(manifest.kind), namespace ?? '', undefined);
}

function objectPath(manifest: Record<string, unknown>, name: string, namespace?: string): string {
  return apiPath(String(manifest.kind), namespace ?? '', name);
}

function kindGroup(kind: string): string {
  if (kind === 'Ingress') return '/apis/networking.k8s.io/v1';
  if (kind === 'Job' || kind === 'CronJob') return '/apis/batch/v1';
  return '/api/v1';
}

const PLURALS: Record<string, string> = {
  Namespace: 'namespaces',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  Pod: 'pods',
  Service: 'services',
  Ingress: 'ingresses',
  Job: 'jobs',
  CronJob: 'cronjobs',
};

function kindPlural(kind: string): string {
  const plural = PLURALS[kind];
  if (!plural) throw new Error(`KubernetesClient does not know how to address kind "${kind}"`);
  return plural;
}

interface KubeConfig {
  serverUrl?: string;
  token?: string;
  caCert?: string;
}

/** In-cluster service account, then KUBECONFIG, then ~/.kube/config. */
function loadKubeConfig(): KubeConfig {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT;
  if (host && port) {
    const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
    const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
    return {
      serverUrl: `https://${host}:${port}`,
      token: existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : undefined,
      caCert: existsSync(caPath) ? readFileSync(caPath, 'utf8') : undefined,
    };
  }

  const path = process.env.KUBECONFIG ?? `${process.env.HOME ?? ''}/.kube/config`;
  if (!existsSync(path)) return {};
  return parseKubeConfig(readFileSync(path, 'utf8'));
}

/** Minimal kubeconfig parser: lifts the server, token and CA out of the file. */
export function parseKubeConfig(text: string): KubeConfig {
  // A YAML parse would need a dependency; the fields we want are simple enough
  // to lift with targeted regexes over the document.
  const server = text.match(/server:\s*(\S+)/)?.[1];
  const token = text.match(/token:\s*(\S+)/)?.[1];
  const caData = text.match(/certificate-authority-data:\s*(\S+)/)?.[1];
  return {
    serverUrl: server,
    token,
    caCert: caData ? Buffer.from(caData, 'base64').toString('utf8') : undefined,
  };
}
