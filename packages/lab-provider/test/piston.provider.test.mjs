import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PistonProvider } from '../dist/index.js';

/**
 * Fake of Piston's `/api/v2/execute`. Records the request body so tests can
 * assert the wire shape, and returns a canned response per scenario.
 */
function fakePiston(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const scenario = handler(JSON.parse(init.body));
    if (scenario.transportError) throw new Error('ECONNREFUSED');
    return {
      ok: scenario.status >= 200 && scenario.status < 300,
      status: scenario.status,
      json: async () => scenario.body ?? {},
      text: async () => scenario.text ?? JSON.stringify(scenario.body ?? {}),
    };
  };
  return { calls, impl };
}

function provider(impl, opts = {}) {
  return new PistonProvider({ baseUrl: 'http://piston.local', fetchImpl: impl, ...opts });
}

test('run posts language, source, stdin and timeouts to Piston', async () => {
  const fake = fakePiston(() => ({
    status: 200,
    body: { run: { stdout: 'hello\n', stderr: '', code: 0, signal: null } },
  }));
  const result = await provider(fake.impl).run({
    runtime: 'python',
    source: 'print("hello")',
    stdin: 'in',
    runTimeoutMs: 2000,
  });

  assert.equal(fake.calls.length, 1);
  const body = fake.calls[0].body;
  assert.equal(fake.calls[0].url, 'http://piston.local/api/v2/execute');
  assert.equal(body.language, 'python');
  assert.equal(body.version, '*');
  assert.equal(body.stdin, 'in');
  assert.equal(body.run_timeout, 2000);
  assert.deepEqual(body.files, [{ name: 'main.py', content: 'print("hello")' }]);

  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.exitCode, 0);
  assert.equal(result.unsupported, false);
  assert.equal(result.timedOut, false);
});

test('run gives Java a Main.java file name', async () => {
  const fake = fakePiston(() => ({ status: 200, body: { run: { stdout: '', code: 0 } } }));
  await provider(fake.impl).run({ runtime: 'java', source: 'class Main {}' });
  assert.equal(fake.calls[0].body.files[0].name, 'Main.java');
});

test('compile diagnostics are surfaced as stderr', async () => {
  const fake = fakePiston(() => ({
    status: 200,
    body: {
      compile: { stderr: 'main.c:3: error: expected ;', code: 1 },
      run: { stdout: '', stderr: '', code: 1, signal: null },
    },
  }));
  const result = await provider(fake.impl).run({ runtime: 'c', source: 'int main(){}' });
  assert.match(result.stderr, /error: expected/);
  assert.equal(result.exitCode, 1);
});

test('a SIGKILL with no exit code is reported as a timeout', async () => {
  const fake = fakePiston(() => ({
    status: 200,
    body: { run: { stdout: '', stderr: '', code: null, signal: 'SIGKILL' } },
  }));
  const result = await provider(fake.impl).run({ runtime: 'python', source: 'while True: pass' });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test('an unknown runtime 400 is an unsupported result, not an error', async () => {
  const fake = fakePiston(() => ({
    status: 400,
    text: '{"message":"runtime is unknown"}',
  }));
  const result = await provider(fake.impl).run({ runtime: 'brainfuck', source: '+' });
  assert.equal(result.unsupported, true);
  assert.match(result.stderr, /runtime is unknown/);
});

test('a transport failure raises a provider error', async () => {
  const fake = fakePiston(() => ({ transportError: true }));
  await assert.rejects(
    () => provider(fake.impl).run({ runtime: 'python', source: 'x' }),
    /Piston request failed/,
  );
});

test('a 5xx from Piston raises a provider error', async () => {
  const fake = fakePiston(() => ({ status: 503, text: 'unavailable' }));
  await assert.rejects(
    () => provider(fake.impl).run({ runtime: 'python', source: 'x' }),
    /Piston execute failed \(503\)/,
  );
});

test('a run_timeout over the server ceiling retries without explicit limits', async () => {
  let call = 0;
  const fake = fakePiston(() => {
    call += 1;
    if (call === 1) {
      return {
        status: 400,
        text: '{"message":"run_timeout cannot exceed the configured limit of 3000"}',
      };
    }
    return { status: 200, body: { run: { stdout: 'ok\n', code: 0, signal: null } } };
  });
  const result = await provider(fake.impl).run({ runtime: 'python', source: 'print("ok")' });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].body.run_timeout, 5000);
  assert.equal(fake.calls[1].body.run_timeout, undefined);
  assert.equal(result.stdout, 'ok\n');
});

test('run timeout defaults are overridable at construction', async () => {
  const fake = fakePiston(() => ({ status: 200, body: { run: { stdout: '', code: 0 } } }));
  await provider(fake.impl, { runTimeoutMs: 1234, compileTimeoutMs: 4321 }).run({
    runtime: 'python',
    source: 'x',
  });
  assert.equal(fake.calls[0].body.run_timeout, 1234);
  assert.equal(fake.calls[0].body.compile_timeout, 4321);
});
