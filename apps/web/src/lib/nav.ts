/**
 * Role-aware navigation model.
 *
 * Mirrors the shape ByteXL uses: each persona (student, instructor, admin) has
 * a fixed set of primary destinations in a sidebar, and everything else lives
 * behind a "More" section. The structure is data, not JSX, so it can be unit
 * tested and shared between the sidebar and any future command palette.
 *
 * The module-to-route mapping follows ByteXL's four student-facing modules
 * (Editor, Labs, Assessments, Nimbus) plus Learn, Reports, and Resumes.
 */

export type Role = 'student' | 'instructor' | 'admin';

export interface NavItem {
  /** Route path, also the React key. */
  href: string;
  label: string;
  /** Short glyph shown in the sidebar; keeps the build dependency-free. */
  icon: string;
  /** One-line description for empty states on the destination page. */
  blurb: string;
  /** Phase that delivers this surface; shown as a badge until then. */
  phase?: 'P1' | 'P2' | 'P3';
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const DASHBOARD: NavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  icon: '◈',
  blurb: 'Your courses, progress, and next actions in one place.',
};

const LEARN: NavItem = {
  href: '/learn',
  label: 'Learn',
  icon: '▤',
  blurb: 'Structured course content: videos, readings, and topics.',
};

const CATALOG: NavItem = {
  href: '/catalog',
  label: 'Catalog',
  icon: '❏',
  blurb: 'Every published course you can enrol in.',
};

const EDITOR: NavItem = {
  href: '/editor',
  label: 'Editor',
  icon: '⟨⟩',
  blurb: 'Write, run, and save code in the browser — with STDIN and snippets.',
};

const LABS: NavItem = {
  href: '/labs',
  label: 'Labs',
  icon: '⬡',
  blurb: 'Ungraded, hands-on practice with hints — spin up a real environment.',
};

const ASSESSMENTS: NavItem = {
  href: '/assessments',
  label: 'Assessments',
  icon: '✓',
  blurb: 'Graded tests with proctoring, timers, and auto-grading.',
};

const NIMBUS: NavItem = {
  href: '/nimbus',
  label: 'Nimbus',
  icon: '☁',
  blurb: 'Build, host, and auto-evaluate projects in the cloud.',
};

const REPORTS: NavItem = {
  href: '/reports',
  label: 'Reports',
  icon: '▦',
  blurb: 'Scores, completion, and cohort analytics.',
  phase: 'P3',
};

const RESUMES: NavItem = {
  href: '/resumes',
  label: 'Resumes',
  icon: '▣',
  blurb: 'Your skill passport: verified lab and assessment evidence.',
  phase: 'P3',
};

const AI_MENTOR: NavItem = {
  href: '/ai-mentor',
  label: 'AI Mentor',
  icon: '✦',
  blurb: 'A Socratic tutor that guides without handing over the answer.',
  phase: 'P3',
};

const AI_INTERVIEWER: NavItem = {
  href: '/ai-interviewer',
  label: 'AI Interviewer',
  icon: '◉',
  blurb: 'Mock interviews with automated soft-skills scoring.',
  phase: 'P3',
};

const BATCHES: NavItem = {
  href: '/batches',
  label: 'Batches',
  icon: '⬢',
  blurb: 'Manage student cohorts and their assignments.',
};

const QUESTION_BANK: NavItem = {
  href: '/question-bank',
  label: 'Question Bank',
  icon: '⊞',
  blurb: 'Reusable questions and test cases across courses.',
  phase: 'P3',
};

const GRADING: NavItem = {
  href: '/grading',
  label: 'Grading',
  icon: '✎',
  blurb: 'Review submissions, proctoring risk, and override scores.',
};

const PROCTORING: NavItem = {
  href: '/proctoring',
  label: 'Proctoring',
  icon: '◔',
  blurb: 'Exam integrity: tab switches, copy/paste, and risk scores.',
};

const USERS: NavItem = {
  href: '/admin/users',
  label: 'Users',
  icon: '⚇',
  blurb: 'People in your institution and their roles.',
  phase: 'P2',
};

const ORGS: NavItem = {
  href: '/admin/organizations',
  label: 'Organizations',
  icon: '⌂',
  blurb: 'Tenants, departments, and institution settings.',
  phase: 'P3',
};

/**
 * The student layout mirrors ByteXL's: the daily destinations are primary, and
 * Labs (plus the rest) live under "More".
 */
const STUDENT: NavSection[] = [
  {
    title: 'Home',
    items: [DASHBOARD, LEARN, CATALOG],
  },
  {
    title: 'Practice',
    items: [EDITOR, ASSESSMENTS, NIMBUS],
  },
  {
    title: 'More',
    items: [LABS, AI_MENTOR, AI_INTERVIEWER, REPORTS, RESUMES],
  },
];

const INSTRUCTOR: NavSection[] = [
  {
    title: 'Home',
    items: [DASHBOARD, LEARN, CATALOG],
  },
  {
    title: 'Teaching',
    items: [BATCHES, GRADING, PROCTORING],
  },
  {
    title: 'Authoring',
    items: [QUESTION_BANK, ASSESSMENTS, LABS],
  },
  {
    title: 'More',
    items: [REPORTS, NIMBUS],
  },
];

const ADMIN: NavSection[] = [
  {
    title: 'Home',
    items: [DASHBOARD],
  },
  {
    title: 'Administration',
    items: [USERS, ORGS],
  },
  {
    title: 'Insight',
    items: [REPORTS, PROCTORING],
  },
];

const BY_ROLE: Record<Role, NavSection[]> = {
  student: STUDENT,
  instructor: INSTRUCTOR,
  admin: ADMIN,
};

/** The sidebar sections for a role. Unknown roles fall back to student. */
export function navSections(role: Role | undefined): NavSection[] {
  return BY_ROLE[role ?? 'student'] ?? STUDENT;
}

/** Flat list of a role's items, in sidebar order. */
export function navItems(role: Role | undefined): NavItem[] {
  return navSections(role).flatMap((s) => s.items);
}

/** Look up a nav item by href across all roles (used by placeholder pages). */
export function navItemByHref(href: string): NavItem | undefined {
  const seen = new Set<string>();
  for (const role of Object.keys(BY_ROLE) as Role[]) {
    for (const item of navItems(role)) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      if (item.href === href) return item;
    }
  }
  return undefined;
}

/**
 * The nav item whose href best matches a pathname, so the sidebar can highlight
 * the current page. Longest prefix wins, so `/admin/users` beats `/`.
 */
export function activeHref(pathname: string, role: Role | undefined): string | null {
  const items = navItems(role);
  let best: string | null = null;
  for (const item of items) {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}
