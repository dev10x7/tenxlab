// Public gateway for per-session lab IDEs.
//
// Lab IDEs are code-server pods exposed by KubeLab on per-session ingress
// hostnames (kubelab-<lab>-<exercise>-<user>.<allowedHosts>) that resolve to the
// cluster node IP. That IP is not reachable from a remote browser, so this
// gateway lets the browser reach them over a single public port by path:
//
//   https://<gateway>/lab/<ingress-host>/<rest>  ->  https://<ingress-host>/<rest>
//
// The adapter emits IDE URLs in exactly that shape when KUBELAB_IDE_PUBLIC_URL
// is set. code-server serves at its host root with relative asset URLs, so the
// prefix round-trips cleanly as long as it is stripped before forwarding.
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.IDE_PROXY_PORT || 12001);
const PREFIX = '/lab/';
const agent = new https.Agent({ rejectUnauthorized: false });

export function resolveTarget(url) {
  if (!url || !url.startsWith(PREFIX)) return null;
  const rest = url.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '/' : rest.slice(slash);
  if (!host.includes('.')) return null;
  return { host, path };
}

/**
 * Rewrite browser headers for the upstream ingress host.
 *
 * The browser sends `Origin: https://<gateway-host>` on every WebSocket upgrade
 * and POST (it does not know it is talking through a path proxy). Forwarding
 * that verbatim makes code-server hang the handshake instead of replying, so
 * the IDE never boots. A reverse proxy must present the upstream's own origin.
 */
export function upstreamHeaders(reqHeaders, host) {
  const headers = { ...reqHeaders, host };
  if (headers.origin) headers.origin = `https://${host}`;
  return headers;
}

function forward(req, res) {
  const target = resolveTarget(req.url);
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: expected /lab/<ingress-host>/...\n');
    return;
  }
  const headers = upstreamHeaders(req.headers, target.host);
  const upstream = https.request(
    {
      host: target.host,
      port: 443,
      method: req.method,
      path: target.path,
      headers,
      agent,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream error: ${e.message}\n`);
  });
  req.pipe(upstream);
}

const server = http.createServer(forward);

server.on('upgrade', (req, socket, head) => {
  const target = resolveTarget(req.url);
  if (!target) return socket.destroy();
  const headers = upstreamHeaders(req.headers, target.host);
  const upstream = https.request(
    {
      host: target.host,
      port: 443,
      method: req.method,
      path: target.path,
      headers,
      agent,
    },
  );
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (upHead && upHead.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.on('error', () => socket.destroy());
  if (head && head.length) upstream.write(head);
  upstream.end();
});

// Only listen when run directly; importing for tests must not bind a port.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ide gateway :${PORT} serving /lab/<ingress-host>/...`);
  });
}
