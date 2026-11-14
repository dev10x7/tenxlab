/**
 * Minimal GitHub client for the "publish to GitHub" flow.
 *
 * ByteXL pushes from the IDE's Source Control tab to the student's own GitHub
 * account using an OAuth device flow. We mirror that: the student authorises
 * once with a short code, the LMS stores the resulting token (encrypted), then
 * creates a repo on their behalf and pushes the workspace to it. Only the few
 * endpoints needed are implemented, so there is no SDK dependency.
 */

export interface GitHubClientOptions {
  /** OAuth app client id (public; the device flow has no client secret). */
  clientId: string;
  /** API base, overridable for GitHub Enterprise or tests. */
  apiBase?: string;
  /** OAuth base, overridable for GitHub Enterprise or tests. */
  oauthBase?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceTokenFailure =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'error';

export type DeviceTokenResult =
  | { ok: true; token: string; scopes: string }
  | { ok: false; reason: DeviceTokenFailure };

export interface GitHubUser {
  login: string;
}

export interface GitHubRepo {
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubClient {
  private readonly apiBase: string;
  private readonly oauthBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitHubClientOptions) {
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.oauthBase = (opts.oauthBase ?? 'https://github.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Begin the device flow: the user code the student types into GitHub. */
  async startDeviceFlow(): Promise<DeviceCodeGrant> {
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      scope: 'repo',
    });
    const res = await this.fetchImpl(`${this.oauthBase}/login/device/code`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new GitHubError(`device code request failed (${res.status})`, res.status);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      deviceCode: String(json.device_code ?? ''),
      userCode: String(json.user_code ?? ''),
      verificationUri: String(json.verification_uri ?? ''),
      expiresIn: Number(json.expires_in ?? 900),
      interval: Number(json.interval ?? 5),
    };
  }

  /** Poll for the token once the student has approved the code. */
  async pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const res = await this.fetchImpl(`${this.oauthBase}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.access_token === 'string' && json.access_token) {
      return { ok: true, token: json.access_token, scopes: String(json.scope ?? '') };
    }
    return { ok: false, reason: normaliseError(json.error) };
  }

  /** The authenticated user's login, used to label the connection. */
  async getUser(token: string): Promise<GitHubUser> {
    const res = await this.fetchImpl(`${this.apiBase}/user`, { headers: this.auth(token) });
    if (!res.ok) throw new GitHubError(`could not read the GitHub user (${res.status})`, res.status);
    const json = (await res.json()) as { login?: string };
    return { login: String(json.login ?? '') };
  }

  /**
   * Create a repository, or return the existing one of the same name. A 422
   * "already exists" is not an error: publishing twice to the same repo is the
   * normal re-publish path.
   */
  async ensureRepo(
    token: string,
    name: string,
    options: { private?: boolean; description?: string } = {},
  ): Promise<GitHubRepo> {
    const res = await this.fetchImpl(`${this.apiBase}/user/repos`, {
      method: 'POST',
      headers: { ...this.auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        private: options.private ?? false,
        description: options.description ?? 'Created with TenXLab',
        auto_init: false,
      }),
    });
    if (res.status === 201) {
      return toRepo((await res.json()) as Record<string, unknown>);
    }
    if (res.status === 422) {
      // Name taken: fetch it instead of failing the publish.
      const existing = await this.getRepo(token, name);
      if (existing) return existing;
    }
    throw new GitHubError(`could not create the GitHub repository (${res.status})`, res.status);
  }

  /** Look up the authenticated user's repo by name. */
  async getRepo(token: string, name: string): Promise<GitHubRepo | null> {
    const user = await this.getUser(token);
    const res = await this.fetchImpl(`${this.apiBase}/repos/${user.login}/${name}`, {
      headers: this.auth(token),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`could not read the repository (${res.status})`, res.status);
    return toRepo((await res.json()) as Record<string, unknown>);
  }

  private auth(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
  }
}

function normaliseError(value: unknown): DeviceTokenFailure {
  switch (value) {
    case 'authorization_pending':
    case 'slow_down':
    case 'expired_token':
    case 'access_denied':
      return value;
    default:
      return 'error';
  }
}

function toRepo(json: Record<string, unknown>): GitHubRepo {
  return {
    fullName: String(json.full_name ?? ''),
    htmlUrl: String(json.html_url ?? ''),
    cloneUrl: String(json.clone_url ?? ''),
    defaultBranch: String(json.default_branch ?? 'main'),
  };
}
