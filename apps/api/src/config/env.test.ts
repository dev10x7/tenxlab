import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://localhost:5432/tenxlab',
  SESSION_SECRET: 'x'.repeat(32),
} as NodeJS.ProcessEnv;

test('isLoopbackHost flags the hostnames a browser resolves to itself', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.0.0.53'), true);
  assert.equal(isLoopbackHost('api.localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('labs.example.com'), false);
  assert.equal(isLoopbackHost('work-2-abc.prod-runtime.all-hands.dev'), false);
});

test('loadEnv treats an empty KUBELAB_IDE_PUBLIC_URL as unset', () => {
  const env = loadEnv({ ...base, KUBELAB_IDE_PUBLIC_URL: '' });
  assert.equal(env.KUBELAB_IDE_PUBLIC_URL, undefined);
});

test('loadEnv rejects a loopback KUBELAB_IDE_PUBLIC_URL in production', () => {
  assert.throws(
    () =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        KUBELAB_IDE_PUBLIC_URL: 'http://localhost:12001',
      }),
    /loopback/,
  );
});

test('loadEnv warns but allows a loopback KUBELAB_IDE_PUBLIC_URL in development', () => {
  const env = loadEnv({
    ...base,
    NODE_ENV: 'development',
    KUBELAB_IDE_PUBLIC_URL: 'http://localhost:12001',
  });
  assert.equal(env.KUBELAB_IDE_PUBLIC_URL, 'http://localhost:12001');
});

test('loadEnv accepts a public KUBELAB_IDE_PUBLIC_URL', () => {
  const env = loadEnv({
    ...base,
    NODE_ENV: 'production',
    KUBELAB_IDE_PUBLIC_URL: 'https://work-2-abc.prod-runtime.all-hands.dev',
  });
  assert.equal(env.KUBELAB_IDE_PUBLIC_URL, 'https://work-2-abc.prod-runtime.all-hands.dev');
});
