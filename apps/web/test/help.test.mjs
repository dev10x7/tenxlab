import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  STUDENT_GUIDES,
  INSTRUCTOR_GUIDES,
  guidesFor,
  guideById,
} from '../src/lib/help.ts';
import { navItems } from '../src/lib/nav.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_HELP = join(here, '..', 'public', 'help');

const ALL = [
  ['student', STUDENT_GUIDES],
  ['instructor', INSTRUCTOR_GUIDES],
];

test('student and instructor guides are non-empty', () => {
  assert.ok(STUDENT_GUIDES.length > 0, 'student guides exist');
  assert.ok(INSTRUCTOR_GUIDES.length > 0, 'instructor guides exist');
});

test('every guide has steps and a screenshot that ships on disk', () => {
  for (const [role, guides] of ALL) {
    for (const g of guides) {
      assert.ok(g.id, `${role}/${g.title} has an id`);
      assert.ok(g.title, `${role}/${g.id} has a title`);
      assert.ok(g.summary, `${role}/${g.id} has a summary`);
      assert.ok(g.steps.length >= 3, `${role}/${g.id} has at least 3 steps`);
      assert.ok(
        g.steps.every((s) => s.trim().length > 0),
        `${role}/${g.id} steps are all non-empty`,
      );
      assert.ok(
        existsSync(join(PUBLIC_HELP, g.screenshot)),
        `${role}/${g.id} screenshot public/help/${g.screenshot} exists`,
      );
    }
  }
});

test('guide ids are unique within a role', () => {
  for (const [role, guides] of ALL) {
    const ids = guides.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, `${role} guide ids are unique`);
  }
});

test('every guide documents a live nav route for its role', () => {
  for (const [role, guides] of ALL) {
    const hrefs = new Set(navItems(role).map((i) => i.href));
    for (const g of guides) {
      assert.ok(
        hrefs.has(g.route),
        `${role}/${g.id} route ${g.route} is reachable in the ${role} nav`,
      );
    }
  }
});

test('guidesFor defaults unknown roles to the student set', () => {
  assert.equal(guidesFor('student'), STUDENT_GUIDES);
  assert.equal(guidesFor('instructor'), INSTRUCTOR_GUIDES);
  assert.equal(guidesFor(undefined), STUDENT_GUIDES);
  assert.equal(guidesFor('admin'), STUDENT_GUIDES);
});

test('guideById finds a guide within a role and misses cleanly', () => {
  assert.equal(guideById('student', 'dashboard')?.title, 'Your dashboard');
  assert.equal(guideById('instructor', 'grading')?.title, 'Gradebook');
  assert.equal(guideById('student', 'does-not-exist'), undefined);
});
