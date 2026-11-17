/** DI tokens, kept separate from AppModule to avoid circular imports. */
export const ENV = 'TENXLAB_ENV';
export const JWT = 'TENXLAB_JWT';
export const SSO = 'TENXLAB_SSO';
export const LAUNCH = 'TENXLAB_LAUNCH';
export const USAGE = 'TENXLAB_USAGE';
export const GRADEBOOK = 'TENXLAB_GRADEBOOK';
export const SESSION = 'TENXLAB_SESSION';
export const CATALOG = 'TENXLAB_CATALOG';
export const COURSE_CATALOG = 'TENXLAB_COURSE_CATALOG';
export const COURSE_AUTHORING = 'TENXLAB_COURSE_AUTHORING';
export const PROVIDER = 'TENXLAB_LAB_PROVIDER';
/**
 * The persistent (fork) provider: the same tiers as `PROVIDER` but tier-2 is a
 * Deployment+PVC rather than a bare pod, so a fork can be scaled to zero without
 * losing its volume (ADR-20). Null when projects are disabled.
 */
export const FORK_PROVIDER = 'TENXLAB_FORK_PROVIDER';
export const PROGRESS = 'TENXLAB_PROGRESS';
export const STORE = 'TENXLAB_STORE';
export const BATCH = 'TENXLAB_BATCH';
export const EDITOR = 'TENXLAB_EDITOR';
export const RUNNER = 'TENXLAB_CODE_RUNNER';
export const ASSESSMENT = 'TENXLAB_ASSESSMENT';
export const PROCTOR = 'TENXLAB_PROCTOR';
export const INTEGRITY = 'TENXLAB_INTEGRITY';
export const PROJECT = 'TENXLAB_PROJECT';
export const PROJECT_SUBMISSION = 'TENXLAB_PROJECT_SUBMISSION';
export const GIT = 'TENXLAB_GIT';
export const GITHUB = 'TENXLAB_GITHUB';
export const SECRET_BOX = 'TENXLAB_SECRET_BOX';
export const AI_BRIDGE = 'TENXLAB_AI_BRIDGE';
export const QUALITY = 'TENXLAB_QUALITY';
export const PROJECT_COPY = 'TENXLAB_PROJECT_COPY';
export const DASHBOARD = 'TENXLAB_DASHBOARD';
export const ATTENDANCE = 'TENXLAB_ATTENDANCE';
export const SUPPORT = 'TENXLAB_SUPPORT';
export const PASSPORT = 'TENXLAB_PASSPORT';
export const REPORTS = 'TENXLAB_REPORTS';
export const MENTOR = 'TENXLAB_MENTOR';
export const INTERVIEWER = 'TENXLAB_INTERVIEWER';
export const FEED = 'TENXLAB_FEED';
export const SOCIAL = 'TENXLAB_SOCIAL';
export const QUESTION_BANK = 'TENXLAB_QUESTION_BANK';
export const ORGS = 'TENXLAB_ORGS';
export const CONTEST = 'TENXLAB_CONTEST';
export const LEADERBOARD = 'TENXLAB_LEADERBOARD';
export const CLARITY = 'TENXLAB_CLARITY';
