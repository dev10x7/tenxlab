/**
 * Help-centre content.
 *
 * Each guide walks through one shipped surface with numbered steps and a real
 * screenshot of the running app (`/public/help/<screenshot>`). Keeping the
 * content as data — not JSX — lets the hub, the role pages, and the tests read
 * one source, so a guide can never point at a screenshot that is not on disk or
 * a route that does not exist.
 */

export type HelpRole = 'student' | 'instructor';

export interface HelpGuide {
  /** Stable key, also the anchor id on the role page. */
  id: string;
  /** Sidebar glyph, kept dependency-free like the nav icons. */
  icon: string;
  title: string;
  /** One-line summary shown on the hub and the guide header. */
  summary: string;
  /** Live surface the guide documents; every step is a click here. */
  route: string;
  /** Screenshot filename under `/public/help`. */
  screenshot: string;
  /** Ordered walkthrough. Each entry is one concrete action or result. */
  steps: string[];
}

export const STUDENT_GUIDES: HelpGuide[] = [
  {
    id: 'dashboard',
    icon: '◈',
    title: 'Your dashboard',
    summary:
      'See what to do next, resume your last lesson, and track your standing.',
    route: '/dashboard',
    screenshot: 'student-dashboard.png',
    steps: [
      'Open Dashboard from the Home section of the left menu.',
      'In "Up next for you", click any card to jump straight to the project or assessment that needs attention.',
      'Under "Resume learning", click "Continue" to return to the first unfinished lesson of a course.',
      'In "Industry roadmaps", click a course card to see its chapters and your completion percentage.',
      'In "Your standing", read your university and batch rank, percentile, and average score.',
      'In the "Profile completion" panel on the right, work through the checklist to become discoverable by recruiters.',
    ],
  },
  {
    id: 'courses',
    icon: '▤',
    title: 'Courses and lessons',
    summary: 'Work through structured course content and track your progress.',
    route: '/learn',
    screenshot: 'student-learn.png',
    steps: [
      'Open Courses from the Learning section of the left menu.',
      'Each card shows a course, its progress bar, and its lesson count.',
      'Click a course to open its chapters and lessons.',
      'Open a lesson to read the content or run the hands-on exercise.',
      'Your progress updates automatically as you complete lessons.',
    ],
  },
  {
    id: 'catalog',
    icon: '▦',
    title: 'Course catalog',
    summary: 'Find and join the published courses offered to you.',
    route: '/catalog',
    screenshot: 'student-catalog.png',
    steps: [
      'Open Catalog from the left menu.',
      'Every published course for your tenant is listed with its lesson count.',
      'Click a course to open it and read its description.',
      'Enrolled courses then appear under Courses and on your dashboard.',
    ],
  },
  {
    id: 'classes',
    icon: '⛭',
    title: 'Classes and attendance',
    summary: 'Check your timetable and see your attendance percentage.',
    route: '/classes',
    screenshot: 'student-classes.png',
    steps: [
      'Open Classes from the Learning section of the left menu.',
      'The "Overall attendance" card shows your percentage for the term.',
      'Present and late both count as attended; excused sessions are left out.',
      'The "Sessions" table lists each class session with its date and your recorded status.',
      'Your instructor records the status — contact them if a session looks wrong.',
    ],
  },
  {
    id: 'editor',
    icon: '⟨⟩',
    title: 'Code editor',
    summary: 'Write, run, and save code in 13 languages, with an AI tutor.',
    route: '/editor',
    screenshot: 'student-editor.png',
    steps: [
      'Open Editor from the Practice section of the left menu.',
      'Pick a language from the "Language" dropdown; the starter template loads for you.',
      'Type your code in the editor. Keep your answer inside the "start/end your solution" markers when the template has them.',
      'Enter any input your program reads in the "Standard input (STDIN)" box.',
      'Click "Run" (or press Ctrl/Cmd + Enter) to execute; the result appears in "Output".',
      'Click "Save snippet" to keep your work, or "New" to start a fresh file.',
      'If you are stuck, click "Ask AI". Choose "Assist" for an explanation plus a fix, or "Socratic" for a hint only.',
    ],
  },
  {
    id: 'labs',
    icon: '⬡',
    title: 'Labs',
    summary: 'Ungraded, hands-on practice in a real cloud environment.',
    route: '/labs',
    screenshot: 'student-labs.png',
    steps: [
      'Open Labs from the Practice section of the left menu.',
      'Each lab card shows its course and your status.',
      'Click "Launch lab" to spin up a real environment in the browser.',
      'Click "Show hint" any time — hints are free and never affect a score.',
      'Labs are practice only; nothing here is graded.',
    ],
  },
  {
    id: 'assessments',
    icon: '✓',
    title: 'Assessments',
    summary: 'Take graded tests with a timer, proctoring, and auto-grading.',
    route: '/assessments',
    screenshot: 'student-assessments.png',
    steps: [
      'Open Assessments from the Practice section of the left menu.',
      'Each card shows the question count, points, and time limit.',
      'If a card shows a "Start passcode" box, type the code your instructor gave you before starting.',
      'Click "Start test" (or "Start practice") to begin.',
      'The server owns the timer, so refreshing the page never buys extra time.',
      'Keep the tab focused: tab switches, copy/paste, and fullscreen exits are recorded for integrity review.',
      'Submit before the timer runs out; coding answers run against hidden tests.',
    ],
  },
  {
    id: 'nimbus',
    icon: '☁',
    title: 'Nimbus projects',
    summary: 'Fork a template, build in the cloud IDE, and submit your work.',
    route: '/nimbus',
    screenshot: 'student-nimbus.png',
    steps: [
      'Open Nimbus from the Nimbus section of the left menu.',
      '"Open projects" lists published projects you can work on; each shows its technology and deadline.',
      'Click "Fork workspace" on a component to create your own cloud VS Code workspace.',
      'Wait one to two minutes while the workspace starts.',
      'Click "Open workspace" to code in the embedded IDE, or "Open in new tab" for a full-window editor.',
      'Use "Download files" to export your work, and "Delete workspace" to discard it and start over.',
      'When you are finished, click "Stop workspace", then submit it from Nimbus Submissions.',
    ],
  },
  {
    id: 'nimbus-submissions',
    icon: '⇪',
    title: 'Submitting a project',
    summary: 'Send a stopped workspace for your trainer to evaluate.',
    route: '/nimbus/submissions',
    screenshot: 'student-nimbus-submissions.png',
    steps: [
      'Finish your work in Nimbus, then click "Stop workspace" on the component.',
      'Wait for the session to close — a running workspace cannot be submitted.',
      'Open Nimbus Submissions from the left menu.',
      'Add a title and description, and optionally a GitHub URL and a demo URL.',
      'Submit before the deadline; a project closes automatically once its deadline passes.',
      'Your trainer scores the submission and leaves feedback; the status appears in this list.',
    ],
  },
  {
    id: 'nimbus-apps',
    icon: '▷',
    title: 'Publishing apps',
    summary: 'Host a running workspace on a public demo URL.',
    route: '/nimbus/apps',
    screenshot: 'student-nimbus-apps.png',
    steps: [
      'In Nimbus, start a workspace and open it.',
      'Use the "Deploy" control on the component to publish the running service.',
      'Open Nimbus Apps from the left menu to see every published workspace and its live demo URL.',
      'Click a demo URL to open the hosted app, or use "Undeploy" to take it offline.',
    ],
  },
  {
    id: 'ai-mentor',
    icon: '✦',
    title: 'AI Mentor',
    summary: 'Ask a study coach a question and get concrete next steps.',
    route: '/ai-mentor',
    screenshot: 'student-ai-mentor.png',
    steps: [
      'Open AI Mentor from the Learning section of the left menu.',
      'Type a question in the box at the bottom and press Enter or click "Ask".',
      'The mentor answers and suggests next steps drawn from a curated knowledge base.',
      'Your conversation is saved; scroll the panel to revisit earlier turns.',
      'Click "Clear" to start a fresh conversation.',
    ],
  },
  {
    id: 'ai-interviewer',
    icon: '☊',
    title: 'AI Interviewer',
    summary: 'Practise a mock interview and get a communication score.',
    route: '/ai-interviewer',
    screenshot: 'student-ai-interviewer.png',
    steps: [
      'Open AI Interviewer from the Learning section of the left menu.',
      'Pick a prompt from the "Prompt" dropdown to see the question.',
      'Type your spoken answer in the "Your answer" box.',
      'Click "Submit for scoring" to get a communication score with grammar, vocabulary, filler-word, and technical-accuracy breakdowns.',
      'Your sittings are listed below, and the score is added to your Skill Passport.',
    ],
  },
  {
    id: 'resumes',
    icon: '▤',
    title: 'Your skill passport',
    summary: 'See the verified badges you have earned from real work.',
    route: '/resumes',
    screenshot: 'student-resumes.png',
    steps: [
      'Open Resumes from the left menu.',
      'The top card summarises your verified badges and average lab, assessment, and communication scores.',
      'The "Badges" list shows each badge, the kind of work it came from, and its score.',
      'Badges are earned automatically by completing labs, assessments, projects, and mock interviews.',
    ],
  },
  {
    id: 'feed',
    icon: '≣',
    title: 'Activity feed',
    summary: 'See what your batch has been doing, newest first.',
    route: '/feed',
    screenshot: 'student-feed.png',
    steps: [
      'Open Feed from the Home section of the left menu.',
      'Each card shows a classmate, what they did, and when.',
      'Where an item links to the work (a submission, a post), click "Open" to jump to it.',
      'The feed is built from real activity, so it fills up as your batch works.',
    ],
  },
  {
    id: 'social',
    icon: '❋',
    title: 'Social and community',
    summary: 'Post updates and follow the peers you want to keep up with.',
    route: '/social',
    screenshot: 'student-social.png',
    steps: [
      'Open Social from the Community section of the left menu.',
      'Type an update in the box at the top and click "Post" to share it with your batch.',
      'Tick "Following only" to narrow the feed to people you follow.',
      'In the "People" panel, click "Follow" or "Unfollow" to change who you follow.',
      'You can delete any post you wrote with its "Delete" button.',
    ],
  },
];

export const INSTRUCTOR_GUIDES: HelpGuide[] = [
  {
    id: 'dashboard',
    icon: '◈',
    title: 'Instructor home',
    summary: 'Your landing point for teaching, grading, and authoring.',
    route: '/dashboard',
    screenshot: 'instructor-dashboard.png',
    steps: [
      'Sign in — instructors land on a home view, not the student dashboard.',
      'Use the left menu to reach Teaching (Batches, Grading, Proctoring), Authoring, and Reports.',
      'The student dashboard is the learner view; you always see the staff surfaces.',
    ],
  },
  {
    id: 'batches',
    icon: '⬢',
    title: 'Batches and rosters',
    summary: 'Create cohorts and assign students to a course.',
    route: '/batches',
    screenshot: 'instructor-batches.png',
    steps: [
      'Open Batches from the Teaching section of the left menu.',
      'Type a batch name under "Create a batch" and click "Create batch".',
      'Each batch lists its student count and a "Open gradebook" link.',
      'Under "Assign a student", pick a learner and click "Assign" to enrol them.',
      'Open the gradebook to see how the cohort is progressing.',
    ],
  },
  {
    id: 'grading',
    icon: '✎',
    title: 'Gradebook',
    summary: 'See completion and scores across a batch.',
    route: '/grading',
    screenshot: 'instructor-grading.png',
    steps: [
      'Open Grading from the Teaching section of the left menu.',
      'Pick a batch from the tabs at the top.',
      'Each row is a student; each column is a lesson or assessment.',
      'Scores land automatically from the lab grader and assessments.',
      'The final column shows overall progress and the average score.',
    ],
  },
  {
    id: 'proctoring',
    icon: '◔',
    title: 'Proctoring review',
    summary: 'Review exam-integrity signals for graded attempts.',
    route: '/proctoring',
    screenshot: 'instructor-proctoring.png',
    steps: [
      'Open Proctoring from the Teaching section of the left menu.',
      'Each row aggregates browser-reported events — tab switches, copy/paste, fullscreen exits — into a risk score.',
      'A high risk score is a prompt to review, never an automatic verdict.',
      'Click an attempt to inspect the individual events behind its score.',
    ],
  },
  {
    id: 'classes',
    icon: '⛭',
    title: 'Class sessions and attendance',
    summary: 'Schedule sessions and record a cohort attendance matrix.',
    route: '/classes',
    screenshot: 'instructor-classes.png',
    steps: [
      'Open Classes from the left menu.',
      'Choose the batch you want to record attendance for.',
      'Under "Schedule a session", enter a title and date, then click "Add session".',
      'The "Attendance matrix" shows one row per student and one column per session.',
      'Use each cell’s dropdown to mark Present, Absent, Late, or Excused.',
      'Present and late count as attended; excused is left out of a student’s percentage. The overall column updates live.',
    ],
  },
  {
    id: 'authoring',
    icon: '✍',
    title: 'Authoring courses',
    summary: 'Build courses as chapters of lessons and publish them.',
    route: '/authoring',
    screenshot: 'instructor-authoring.png',
    steps: [
      'Open Authoring from the Authoring section of the left menu.',
      'Enter a title and description, then click "Create course".',
      'Open the course to add chapters (modules) and lessons.',
      'A lesson can be a reading, an interactive lab, or a link to an assessment.',
      'Drafts stay hidden from students until you publish the course.',
    ],
  },
  {
    id: 'nimbus',
    icon: '☁',
    title: 'Authoring projects',
    summary: 'Create forkable projects and review student submissions.',
    route: '/nimbus',
    screenshot: 'instructor-nimbus.png',
    steps: [
      'Open Nimbus from the More section of the left menu.',
      'The "Usage this month" card shows spend and active labs for your tenant.',
      'Under "Create a project", add a title, description, an optional deadline, and a starting template (languages, frameworks, or databases).',
      'Click "Create draft", then add components — each is one technology backed by a template.',
      'Publish the project to let students fork it.',
      'Click "Review submissions" to open the evaluation queue and score student work.',
    ],
  },
  {
    id: 'assessments',
    icon: '✓',
    title: 'Assessments and labs',
    summary: 'Reuse assessments and labs across your courses.',
    route: '/assessments',
    screenshot: 'instructor-assessments.png',
    steps: [
      'The Assessments and Labs surfaces are shared with students — you see the same catalog.',
      'Attach an assessment or lab to a lesson while authoring a course.',
      'Set a start passcode on a graded assessment to gate who can begin it.',
      'Proctoring signals for graded attempts appear under Proctoring.',
    ],
  },
  {
    id: 'question-bank',
    icon: '⊞',
    title: 'Question bank',
    summary: 'Keep reusable questions and drop them into any test.',
    route: '/question-bank',
    screenshot: 'instructor-question-bank.png',
    steps: [
      'Open Question Bank from the Authoring section of the left menu.',
      'Under "Add a question", pick a kind (coding, multiple choice, fill in the blank, or descriptive).',
      'For a multiple-choice question, enter one option per line and set the maximum score.',
      'Add comma-separated tags so you can filter the bank later.',
      'Click "Add question" to save it; filter the list by kind or tag, or delete a question with its "Delete" button.',
    ],
  },
  {
    id: 'reports',
    icon: '◱',
    title: 'Student reports',
    summary: 'Read cohort completion, scores, and attendance per batch.',
    route: '/reports',
    screenshot: 'instructor-reports.png',
    steps: [
      'Open Reports from the More section of the left menu.',
      'The table lists each batch with its student count, average completion, average score, attendance, and pending submissions.',
      'Click "View" on a row to open that batch’s per-student breakdown.',
      'Every figure is rolled from the same data the gradebook and attendance board use, so it stays consistent.',
    ],
  },
];

/** The guides for a role, defaulting to student for unknown roles. */
export function guidesFor(role: HelpRole | string | undefined): HelpGuide[] {
  return role === 'instructor' ? INSTRUCTOR_GUIDES : STUDENT_GUIDES;
}

/** Look up a guide by id within a role's set. */
export function guideById(
  role: HelpRole,
  id: string,
): HelpGuide | undefined {
  return guidesFor(role).find((g) => g.id === id);
}
