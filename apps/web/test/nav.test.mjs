import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navSections, navItems, activeHref, helpHref } from '../src/lib/nav.ts';

test('student nav leads with the Home section (Dashboard, Feed)', () => {
  const home = navSections('student').find((s) => s.title === 'Home');
  assert.ok(home, 'student nav has a Home section');
  assert.deepEqual(
    home.items.map((i) => i.href),
    ['/dashboard', '/feed'],
  );
});

test('student nav mirrors ByteXL sections in order', () => {
  const titles = navSections('student').map((s) => s.title);
  assert.deepEqual(titles, [
    'Home',
    'Learning',
    'Practice',
    'Nimbus',
    'Insights',
    'Community',
  ]);
});

test('the Nimbus section carries build, submissions, and apps', () => {
  const nimbus = navSections('student').find((s) => s.title === 'Nimbus');
  assert.ok(nimbus, 'student nav has a Nimbus section');
  assert.deepEqual(
    nimbus.items.map((i) => i.href),
    ['/nimbus', '/nimbus/submissions', '/nimbus/apps'],
  );
});

test('learning and practice hold the daily destinations', () => {
  const sections = navSections('student');
  const learning = sections.find((s) => s.title === 'Learning');
  const practice = sections.find((s) => s.title === 'Practice');
  assert.deepEqual(
    learning?.items.map((i) => i.href),
    ['/ai-mentor', '/learn', '/catalog', '/classes'],
  );
  assert.deepEqual(
    practice?.items.map((i) => i.href),
    ['/editor', '/labs', '/assessments', '/contests'],
  );
});

test('contests is a live student and instructor surface (no phase badge)', () => {
  const student = navItems('student').find((i) => i.href === '/contests');
  assert.ok(student, 'student nav has /contests');
  assert.equal(student.phase, undefined, '/contests is wired to the API');

  const instructor = navItems('instructor').find((i) => i.href === '/contests');
  assert.ok(instructor, 'instructor nav has /contests');
  assert.equal(instructor.phase, undefined, '/contests is wired to the API');
});

test('community holds social, support, and the student help centre', () => {
  const community = navSections('student').find((s) => s.title === 'Community');
  assert.deepEqual(
    community?.items.map((i) => i.href),
    ['/social', '/support', '/help/student'],
  );
});

test('every role reaches the support desk (live, no phase badge)', () => {
  for (const role of ['student', 'instructor', 'admin']) {
    const item = navItems(role).find((i) => i.href === '/support');
    assert.ok(item, `${role} nav has /support`);
    assert.equal(item.phase, undefined, `/support is wired to the API (${role})`);
  }
});

test('every role links a help centre, and instructors can reach attendance', () => {
  assert.ok(
    navItems('student').some((i) => i.href === '/help/student'),
    'student nav links /help/student',
  );
  const instructor = navItems('instructor').map((i) => i.href);
  assert.ok(instructor.includes('/help/instructor'), 'instructor links help');
  assert.ok(instructor.includes('/classes'), 'instructor reaches /classes');
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
  for (const href of ['/batches', '/grading', '/question-bank', '/authoring']) {
    assert.ok(hrefs.includes(href), `instructor sees ${href}`);
  }
});

test('the authoring surface is a live instructor destination (no phase badge)', () => {
  const item = navItems('instructor').find((i) => i.href === '/authoring');
  assert.ok(item, 'instructor nav has /authoring');
  assert.equal(item.phase, undefined, '/authoring is wired to the API');
});

test('activeHref keeps the authoring parent lit inside the course editor', () => {
  assert.equal(activeHref('/authoring', 'instructor'), '/authoring');
  assert.equal(activeHref('/authoring/course-1', 'instructor'), '/authoring');
});

test('unknown roles fall back to the student layout', () => {
  assert.deepEqual(navSections(undefined), navSections('student'));
});

test('activeHref highlights the current page', () => {
  assert.equal(activeHref('/dashboard', 'student'), '/dashboard');
  assert.equal(activeHref('/learn', 'student'), '/learn');
});

test('activeHref prefers the nested Nimbus item over the parent', () => {
  assert.equal(activeHref('/nimbus/submissions', 'student'), '/nimbus/submissions');
  assert.equal(activeHref('/nimbus/apps', 'student'), '/nimbus/apps');
  assert.equal(activeHref('/nimbus', 'student'), '/nimbus');
});

test('activeHref keeps the Nimbus parent lit on the in-panel workspace route', () => {
  assert.equal(activeHref('/nimbus/workspace/fork-1', 'student'), '/nimbus');
});

test('activeHref matches nested paths by longest prefix', () => {
  assert.equal(activeHref('/admin/users/123', 'admin'), '/admin/users');
  assert.equal(activeHref('/admin/organizations', 'admin'), '/admin/organizations');
});

test('activeHref returns null when nothing matches', () => {
  assert.equal(activeHref('/login', 'student'), null);
  assert.equal(activeHref('/', 'student'), null);
});

test('helpHref routes each role to its own guides', () => {
  assert.equal(helpHref('student'), '/help/student');
  assert.equal(helpHref('instructor'), '/help/instructor');
  assert.equal(helpHref('admin'), '/help/instructor');
  assert.equal(helpHref(undefined), '/help/student');
});

test('activeHref keeps the role help item lit on the shared hub', () => {
  assert.equal(activeHref('/help', 'student'), '/help/student');
  assert.equal(activeHref('/help', 'instructor'), '/help/instructor');
  assert.equal(activeHref('/help/student', 'student'), '/help/student');
  assert.equal(activeHref('/help/instructor', 'instructor'), '/help/instructor');
});

test('batches and grading are reachable P1 surfaces (no phase badge)', () => {
  const items = navItems('instructor');
  for (const href of ['/batches', '/grading']) {
    const item = items.find((i) => i.href === href);
    assert.ok(item, `instructor nav has ${href}`);
    assert.equal(item.phase, undefined, `${href} is a live P1 surface`);
  }
});

test('the editor is a live student surface (no phase badge)', () => {
  const item = navItems('student').find((i) => i.href === '/editor');
  assert.ok(item, 'student nav has /editor');
  assert.equal(item.phase, undefined, '/editor is wired to the API');
});

test('assessments and proctoring are live P2 surfaces (no phase badge)', () => {
  const student = navItems('student');
  const assessments = student.find((i) => i.href === '/assessments');
  assert.ok(assessments, 'student nav has /assessments');
  assert.equal(assessments.phase, undefined, '/assessments is wired to the API');

  const proctoring = navItems('instructor').find((i) => i.href === '/proctoring');
  assert.ok(proctoring, 'instructor nav has /proctoring');
  assert.equal(proctoring.phase, undefined, '/proctoring is wired to the API');
});

test('the dashboard and its Nimbus sub-surfaces are live (no phase badge)', () => {
  const student = navItems('student');
  for (const href of ['/dashboard', '/nimbus', '/nimbus/submissions', '/nimbus/apps']) {
    const item = student.find((i) => i.href === href);
    assert.ok(item, `student nav has ${href}`);
    assert.equal(item.phase, undefined, `${href} is wired to the API`);
  }
});

test('the P3 surfaces are live destinations (no phase badge)', () => {
  const student = navItems('student');
  for (const href of ['/reports', '/feed', '/social', '/resumes', '/ai-mentor', '/ai-interviewer']) {
    const item = student.find((i) => i.href === href);
    assert.ok(item, `student nav has ${href}`);
    assert.equal(item.phase, undefined, `${href} is wired to the API`);
  }
  const instructor = navItems('instructor').find((i) => i.href === '/question-bank');
  assert.ok(instructor, 'instructor nav has /question-bank');
  assert.equal(instructor.phase, undefined, '/question-bank is wired to the API');
  const admin = navItems('admin').find((i) => i.href === '/admin/organizations');
  assert.ok(admin, 'admin nav has /admin/organizations');
  assert.equal(admin.phase, undefined, '/admin/organizations is wired to the API');
});

test('nimbus is a live student and instructor surface (no phase badge)', () => {
  const student = navItems('student').find((i) => i.href === '/nimbus');
  assert.ok(student, 'student nav has /nimbus');
  assert.equal(student.phase, undefined, '/nimbus is wired to the API');

  const instructor = navItems('instructor').find((i) => i.href === '/nimbus');
  assert.ok(instructor, 'instructor nav has /nimbus');
  assert.equal(instructor.phase, undefined, '/nimbus is wired to the API');
});

test('clarity is a live student and instructor surface (no phase badge)', () => {
  const student = navItems('student').find((i) => i.href === '/clarity');
  assert.ok(student, 'student nav has /clarity');
  assert.equal(student.phase, undefined, '/clarity is wired to the API');

  const instructor = navItems('instructor').find((i) => i.href === '/clarity');
  assert.ok(instructor, 'instructor nav has /clarity');
  assert.equal(instructor.phase, undefined, '/clarity is wired to the API');
});

test('the Insights section leads with reports, resumes, interviewer, then clarity', () => {
  const insights = navSections('student').find((s) => s.title === 'Insights');
  assert.ok(insights, 'student nav has an Insights section');
  assert.deepEqual(
    insights.items.map((i) => i.href),
    ['/reports', '/resumes', '/ai-interviewer', '/clarity'],
  );
});
