/**
 * Regenerate the help-centre screenshots.
 *
 * Boots a headless Chromium against a running stack (docker compose up), signs
 * in as the seeded demo student and instructor, and writes one screenshot per
 * shipped feature into apps/web/public/help/. The guide content in
 * src/lib/help.ts references these files by name, and a unit test fails if a
 * referenced screenshot is missing, so re-run this after a UI change.
 *
 *   docker compose up -d --build
 *   node scripts/shots/capture-help.mjs
 *
 * Override the target with BASE_URL (default http://localhost:3000).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:4000';
const OUT = 'apps/web/public/help';
const PASSWORD = 'demo1234';

const STUDENT = [
  ['dashboard', '/dashboard'],
  ['learn', '/learn'],
  ['classes', '/classes'],
  ['catalog', '/catalog'],
  ['editor', '/editor'],
  ['labs', '/labs'],
  ['assessments', '/assessments'],
  ['nimbus', '/nimbus'],
  ['nimbus-submissions', '/nimbus/submissions'],
  ['nimbus-apps', '/nimbus/apps'],
];

const INSTRUCTOR = [
  ['dashboard', '/dashboard'],
  ['batches', '/batches'],
  ['grading', '/grading'],
  ['proctoring', '/proctoring'],
  ['classes', '/classes'],
  ['authoring', '/authoring'],
  ['nimbus', '/nimbus'],
  ['assessments', '/assessments'],
];

/** Give the instructor-attendance screenshots real rows to show. */
async function seedAttendance() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'instructor@tenxlab.local',
      password: PASSWORD,
    }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const headers = { 'content-type': 'application/json', cookie };
  const call = (method, path, body) =>
    fetch(`${API}${path}`, { method, headers, body: JSON.stringify(body) });

  const sessions = [
    ['Intro to Kubernetes', '2026-11-16T09:00:00.000Z', 'present'],
    ['Pods and Deployments', '2026-11-18T09:00:00.000Z', 'late'],
  ];
  for (const [title, scheduledAt, status] of sessions) {
    const created = await call('POST', '/api/attendance/batches/demo-batch-2026/sessions', {
      title,
      scheduledAt,
    });
    const session = await created.json();
    if (session?.id) {
      await call('PATCH', `/api/attendance/sessions/${session.id}`, {
        userId: 'demo-student',
        status,
      });
    }
  }
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function shoot(page, prefix, routes) {
  for (const [name, path] of routes) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${prefix}-${name}.png`, fullPage: true });
    console.log(`  ${prefix}-${name}.png  <- ${path}`);
  }
}

mkdirSync(OUT, { recursive: true });
await seedAttendance().catch((err) =>
  console.warn('attendance seed skipped:', err.message),
);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

console.log('student screenshots:');
const studentPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await signIn(studentPage, 'student@tenxlab.local');
await shoot(studentPage, 'student', STUDENT);

console.log('instructor screenshots:');
const instructorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await signIn(instructorPage, 'instructor@tenxlab.local');
await shoot(instructorPage, 'instructor', INSTRUCTOR);

await browser.close();
console.log(`\nWrote screenshots to ${OUT}`);
