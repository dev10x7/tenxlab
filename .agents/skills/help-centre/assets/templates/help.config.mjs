/**
 * Help-centre configuration — copy to the project root as `help.config.mjs`
 * and edit. This one file drives all three skill scripts:
 *
 *   scaffold-help.mjs        -> writes the TypeScript guide data module
 *   capture-screenshots.mjs  -> logs in per role and screenshots each route
 *   verify-help.mjs          -> checks every referenced screenshot exists
 *
 * Keep the guide ids stable: they are the screenshot filename suffixes
 * (`<role>-<id>.png`), the anchor ids on the role page, and the test keys.
 */
export default {
  // Where the running app is, and where screenshots are written (relative to
  // the project root). `outDir` is the web app's served static directory.
  baseUrl: 'http://localhost:3000',
  outDir: 'apps/web/public/help',

  // Login form: the field/button selectors and the URL a successful sign-in
  // lands on. `successPath` is a Playwright URL matcher.
  loginPath: '/login',
  emailSelector: '#email',
  passwordSelector: '#password',
  submitSelector: 'button[type=submit]',
  successPath: '**/dashboard',

  // Screenshot viewport and how long to let a page settle before capturing.
  viewport: { width: 1440, height: 900 },
  settleMs: 1200,

  // Demo credentials per role. Override with env vars in CI if needed.
  users: {
    student: { email: 'student@tenxlab.local', password: 'demo1234' },
    instructor: { email: 'instructor@tenxlab.local', password: 'demo1234' },
  },

  // Optional: seed rows so screenshots are not empty. Receives { baseUrl }.
  // async beforeCapture({ baseUrl }) { /* POST to your API here */ },

  // One guide list per role. Each guide maps 1:1 to a live route.
  roles: {
    student: [
      {
        id: 'dashboard',
        icon: '◈',
        title: 'Your dashboard',
        summary: 'See what to do next, resume your last lesson, and track your standing.',
        route: '/dashboard',
        steps: [
          'Open Dashboard from the Home section of the left menu.',
          'Click any card in "Up next for you" to jump to the work that needs attention.',
          'Under "Resume learning", click Continue to return to your first unfinished lesson.',
        ],
      },
    ],
    instructor: [
      {
        id: 'dashboard',
        icon: '◈',
        title: 'Instructor home',
        summary: 'Your landing point for teaching, grading, and authoring.',
        route: '/dashboard',
        steps: [
          'Sign in — instructors land on a home view, not the student dashboard.',
          'Use the left menu to reach Teaching, Authoring, and Reports.',
        ],
      },
    ],
  },
};
