import type { CodeRunResult } from '@tenxlab/contracts';
import { LabProviderError, type CodeExecutionProvider, type CodeRunInput } from './types';

export interface PistonProviderOptions {
  /** Base URL of the Piston service, e.g. http://localhost:2000 */
  baseUrl: string;
  /** Runtime version selector; `*` lets the pool pick the newest installed. */
  version?: string;
  /** Default wall-clock limit per run, in milliseconds. */
  runTimeoutMs?: number;
  /** Compile-stage limit, in milliseconds (Java/C++/etc. need headroom). */
  compileTimeoutMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Tier-1 code execution over Piston's HTTP API.
 *
 * Piston is a request/response service (ADR-12): `POST /api/v2/execute` takes a
 * language, version, source and stdin, and returns stdout/stderr/exit-code. It
 * sandboxes each run with Isolate inside its own container — an external
 * service we call over the network, never a library we link (ADR-7 safe).
 *
 * The LMS never talks to Piston directly; it depends on `CodeExecutionProvider`.
 * This class is the only place that knows Piston's wire format.
 */
export class PistonProvider implements CodeExecutionProvider {
  readonly name = 'piston';

  private readonly baseUrl: string;
  private readonly version: string;
  private readonly runTimeoutMs: number;
  private readonly compileTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PistonProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.version = opts.version ?? '*';
    this.runTimeoutMs = opts.runTimeoutMs ?? 5000;
    this.compileTimeoutMs = opts.compileTimeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(input: CodeRunInput): Promise<CodeRunResult> {
    const base = {
      language: input.runtime,
      version: this.version,
      files: [{ name: fileNameFor(input.runtime), content: input.source }],
      stdin: input.stdin ?? '',
    };

    const res = await this.execute({
      ...base,
      run_timeout: input.runTimeoutMs ?? this.runTimeoutMs,
      compile_timeout: this.compileTimeoutMs,
    });

    if (res.ok) {
      const json = (await res.json()) as PistonResponse;
      return normalize(json);
    }

    const text = await res.text().catch(() => '');

    // Piston answers 400 with a message when the runtime is unknown; that is a
    // normal outcome for a bad language pick, not a transport failure.
    if (res.status === 400 && /runtime|language|version/i.test(text)) {
      return unsupportedResult(text);
    }

    // A 400 saying a timeout exceeds the server's ceiling means this Piston is
    // configured below our default (its stock run_timeout is 3000ms). The run is
    // still valid, so retry once with the server's own limits rather than
    // failing the student.
    if (res.status === 400 && /cannot exceed the configured limit/i.test(text)) {
      const retry = await this.execute(base);
      if (retry.ok) {
        const json = (await retry.json()) as PistonResponse;
        return normalize(json);
      }
      const retryText = await retry.text().catch(() => '');
      throw new LabProviderError(`Piston execute failed (${retry.status})`, retry.status, retryText);
    }

    throw new LabProviderError(`Piston execute failed (${res.status})`, res.status, text);
  }

  private async execute(body: Record<string, unknown>): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/v2/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LabProviderError(
        `Piston request failed: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }
  }
}

interface PistonStage {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
  output?: string;
}

interface PistonResponse {
  run?: PistonStage;
  compile?: PistonStage;
  message?: string;
}

function normalize(json: PistonResponse): CodeRunResult {
  const run = json.run ?? {};
  const compile = json.compile ?? {};
  // Compiler diagnostics live on the compile stage; surface them as stderr so a
  // failed compile is visible without a separate field.
  const stderr = [compile.stderr, run.stderr].filter((s) => s && s.length > 0).join('\n');
  const signal = run.signal ?? null;
  const exitCode = typeof run.code === 'number' ? run.code : null;
  return {
    stdout: run.stdout ?? '',
    stderr,
    exitCode,
    executionTimeMs: 0,
    // Piston reports a killed process as a signal with no exit code.
    timedOut: exitCode === null && signal === 'SIGKILL',
    unsupported: false,
  };
}

function unsupportedResult(message: string): CodeRunResult {
  return {
    stdout: '',
    stderr: message,
    exitCode: null,
    executionTimeMs: 0,
    timedOut: false,
    unsupported: true,
  };
}

/**
 * Piston infers the compiler/runner from the file name for some languages
 * (Java needs `Main.java`), so give each runtime a conventional name.
 */
function fileNameFor(runtime: string): string {
  const ext: Record<string, string> = {
    python: 'main.py',
    javascript: 'main.js',
    java: 'Main.java',
    c: 'main.c',
    'c++': 'main.cpp',
    sqlite3: 'main.sql',
  };
  return ext[runtime] ?? 'main.txt';
}
