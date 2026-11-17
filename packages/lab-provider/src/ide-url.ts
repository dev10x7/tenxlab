/**
 * IDE URL composition.
 *
 * A lab's IDE lives on a per-session ingress host (e.g.
 * `kubelab-<lab>-<ex>-<user>.192.168.240.2.nip.io`). That host is *stable* for
 * the life of the session, but the browser-facing URL around it is a function
 * of deployment config: either the ingress host directly, or a public gateway
 * that fronts it as `<gateway>/lab/<host>/`.
 *
 * Persisting the composed URL bakes deployment config into the database, so a
 * base-URL change silently strands every existing row. The rule here is that
 * only the host is durable state; the URL is derived on every read.
 */

export interface ComposeIdeUrlOptions {
  /** Public gateway base that fronts per-session ingress hosts. */
  publicIdeBaseUrl?: string | null;
  /** Scheme used when no gateway is configured. Defaults to https. */
  ideScheme?: 'https' | 'http';
}

/**
 * Build the browser-facing IDE URL from a session's stable ingress host.
 * Returns null when there is no host (a session that never provisioned).
 */
export function composeIdeUrl(
  host: string | null | undefined,
  opts: ComposeIdeUrlOptions = {},
): string | null {
  if (!host) return null;
  const base = opts.publicIdeBaseUrl?.replace(/\/$/, '');
  if (base) return `${base}/lab/${host}/`;
  return `${opts.ideScheme ?? 'https'}://${host}/`;
}
