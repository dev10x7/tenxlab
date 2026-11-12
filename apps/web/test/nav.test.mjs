import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navSections, navItems, activeHref } from '../src/lib/nav.ts';

test('student nav leads with the daily destinations', () => {
  const primary = navItems('student').slice(0, 3).map((i) => i.href);
  assert.deepEqual(primary, ['/dashboard', '/learn', '/catalog']);
});

test('labs live under More for students, not as a primary item', () => {
  const sections = navSections('student');
  const more = sections.find((s) => s.title === 'More');
  assert.ok(more, 'student nav has a More section');
  assert.ok(more.items.some((i) => i.href === '/labs'));
  const home = sections.find((s) => s.title === 'Home');
  assert.ok(!home?.items.some((i) => i.href === '/labs'));
});

test('every role exposes a dashboard and no duplicate hrefs', () => {
  for (const role of ['student', 'instructor', 'admin']) {
    const hrefs = navItems(role).map((i) => i.href);
    assert.ok(hrefs.includes('/dashboard'), `${role} has a dashboard`);
    assert.equal(new Set(hrefs).size, hrefs.length, `${role} has no duplicate hrefs`);
  }
});

test('instructor nav includes teaching and authoring surfaces', () => {
  const hrefs = navItems('instructor').map((i) => i.href);
  for (const href of ['/batches', '/grading', '/question-bank']) {
    assert.ok(hrefs.includes(href), `instructor sees ${href}`);
  }
});

test('unknown roles fall back to the student layout', () => {
  assert.deepEqual(navSections(undefined), navSections('student'));
});

test('activeHref highlights the current page', () => {
  assert.equal(activeHref('/dashboard', 'student'), '/dashboard');
  assert.equal(activeHref('/learn', 'student'), '/learn');
});

test('activeHref matches nested paths by longest prefix', () => {
  assert.equal(activeHref('/admin/users/123', 'admin'), '/admin/users');
  assert.equal(activeHref('/admin/organizations', 'admin'), '/admin/organizations');
});

test('activeHref returns null when nothing matches', () => {
  assert.equal(activeHref('/login', 'student'), null);
  assert.equal(activeHref('/', 'student'), null);
});

test('batches and grading are reachable P1 surfaces (no phase badge)', () => {
  const items = navItems('instructor');
  for (const href of ['/batches', '/grading']) {
    const item = items.find((i) => i.href === href);
    assert.ok(item, `instructor nav has ${href}`);
    assert.equal(item.phase, undefined, `${href} is a live P1 surface`);
  }
});
