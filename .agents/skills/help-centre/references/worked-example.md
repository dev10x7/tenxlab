# Worked example — TenXLab help centre

A complete, real configuration and the files it produces. Use it as a
reference when adapting the skill to a new project.

## help.config.mjs (abridged)

```js
export default {
  baseUrl: 'http://localhost:3000',
  outDir: 'apps/web/public/help',

  loginPath: '/login',
  emailSelector: '#email',
  passwordSelector: '#password',
  submitSelector: 'button[type=submit]',
  successPath: '**/dashboard',

  viewport: { width: 1440, height: 900 },
  settleMs: 1200,

  users: {
    student: { email: 'student@tenxlab.local', password: 'demo1234' },
    instructor: { email: 'instructor@tenxlab.local', password: 'demo1234' },
  },

  // Seed attendance rows so the instructor matrix screenshot is not empty.
  async beforeCapture({ baseUrl }) {
    const api = baseUrl.replace(':3000', ':4000');
    const login = await fetch(`${api}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'instructor@tenxlab.local',
        password: 'demo1234',
      }),
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    await fetch(`${api}/api/attendance/batches/demo-batch-2026/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Intro to Kubernetes',
        scheduledAt: '2026-11-16T09:00:00.000Z',
      }),
    });
  },

  roles: {
    student: [
      { id: 'dashboard', icon: '◈', title: 'Your dashboard', route: '/dashboard',
        summary: 'See what to do next, resume your last lesson, and track your standing.',
        steps: [
          'Open Dashboard from the Home section of the left menu.',
          'In "Up next for you", click any card to jump to the work that needs attention.',
          'Under "Resume learning", click Continue to return to your first unfinished lesson.',
        ] },
      { id: 'catalog', icon: '▦', title: 'Course catalog', route: '/catalog',
        summary: 'Find and join the published courses offered to you.',
        steps: ['Open Catalog from the left menu.', 'Click a course to read its description.'] },
      // ... editor, labs, assessments, nimbus, nimbus-submissions, nimbus-apps
    ],
    instructor: [
      { id: 'dashboard', icon: '◈', title: 'Instructor home', route: '/dashboard',
        summary: 'Your landing point for teaching, grading, and authoring.',
        steps: ['Sign in — instructors land on a home view, not the student dashboard.'] },
      { id: 'classes', icon: '⛭', title: 'Class sessions and attendance', route: '/classes',
        summary: 'Schedule sessions and record a cohort attendance matrix.',
        steps: [
          'Open Classes from the left menu.',
          'Under "Schedule a session", enter a title and date, then click "Add session".',
          'Use each cell’s dropdown to mark Present, Absent, Late, or Excused.',
        ] },
      // ... batches, grading, proctoring, authoring, nimbus, assessments
    ],
  },
};
```

## Files the scaffold produces

- `apps/web/src/lib/help.ts` — `HelpGuide` interface, `STUDENT_GUIDES`,
  `INSTRUCTOR_GUIDES`, `guidesFor(role)`, `guideById(role, id)`.
- `apps/web/src/components/HelpGuide.tsx` — `HelpGuideCard` (header + `<img
  className="help-shot">` + `<ol className="help-steps">`) and `HelpToc`.
- `apps/web/src/components/RoleHelpPage.tsx` — the shared role page.
- `apps/web/src/app/help/page.tsx` — hub with one card per role.
- `apps/web/src/app/help/<role>/page.tsx` — one page per role.

## CSS the components expect

Add these classes to the app's global stylesheet. The layout is a sticky table
of contents beside a column of guide cards.

```css
.help-layout { display: grid; grid-template-columns: 240px 1fr; gap: 24px;
  margin-top: 20px; align-items: start; }
.help-toc { position: sticky; top: 88px; }
.help-toc ul { list-style: none; margin: 0; padding: 0; }
.help-toc li { margin: 6px 0; }
.help-guides { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.help-guide { scroll-margin-top: 88px; }   /* clears the sticky top bar */
.help-shot { display: block; width: 100%; height: auto; margin: 12px 0 4px;
  border: 1px solid var(--border); border-radius: var(--radius); }
.help-steps { margin: 12px 0 0; padding-left: 22px; }
.help-steps li { margin: 6px 0; line-height: 1.5; }
@media (max-width: 900px) {
  .help-layout { grid-template-columns: 1fr; }
  .help-toc { position: static; }
}
```

## A test that keeps the guides honest

A unit test over the data module catches drift without a browser. It asserts
each guide has steps and that its screenshot exists on disk.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { STUDENT_GUIDES, INSTRUCTOR_GUIDES } from '../src/lib/help.ts';

for (const [role, guides] of [
  ['student', STUDENT_GUIDES],
  ['instructor', INSTRUCTOR_GUIDES],
]) {
  for (const g of guides) {
    test(`${role}/${g.id} has steps and a screenshot`, () => {
      assert.ok(g.steps.length > 0, 'has steps');
      assert.ok(g.route.startsWith('/'), 'has a route');
      assert.ok(
        existsSync(new URL(`../public/help/${g.screenshot}`, import.meta.url)),
        `screenshot on disk: ${g.screenshot}`,
      );
    });
  }
}
```

Run with Node's built-in test runner and TypeScript stripping:

```bash
node --experimental-strip-types --test "test/*.test.mjs"
```

## Dockerfile note

The web image must copy the static assets, or screenshots 404 in the container:

```dockerfile
# in the runner stage
COPY apps/web/public ./apps/web/public
```

Verify inside the container with a plain HTTP probe:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/help/student-dashboard.png
```
