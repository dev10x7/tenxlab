import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ssoErrorMessage,
  labLaunchState,
  lessonStatusLabel,
  courseProgress,
  proxyFetchInit,
  methodHasBody,
  gradebookRowSummary,
  gradebookCellLabel,
  snippetTitle,
  runStatusLabel,
  runHasOutput,
  formatClock,
  clockUrgent,
  riskLevelLabel,
  riskSummaryLabel,
  attemptClockLabel,
  workspaceStatusLabel,
  forkReadyState,
  canSubmitWorkspace,
  submissionStatusLabel,
  projectDeadlinePassed,
  projectDeadlineLabel,
  rankPercentileLabel,
  templateCategoryLabel,
  attendanceStatusLabel,
  attendanceStatusClass,
  attendancePercentLabel,
  nimbusLanding,
  scoreLabel,
  readinessLabel,
  badgeKindLabel,
  questionKindLabel,
  feedKindLabel,
  communicationLabel,
  contestPhaseLabel,
  contestIsLive,
  durationLabel,
  withQuery,
  similarityLabel,
} from '../src/lib/lms.ts';

test('ssoErrorMessage maps every known reason', () => {
  assert.match(ssoErrorMessage('invalid_signature'), /invalid/i);
  assert.match(ssoErrorMessage('token_expired'), /expired/i);
  assert.match(ssoErrorMessage('replay_detected'), /already used/i);
  assert.match(ssoErrorMessage('unknown_partner'), /not registered/i);
  assert.match(ssoErrorMessage('user_not_found'), /could not find/i);
});

test('ssoErrorMessage returns null for unknown or absent reasons', () => {
  assert.equal(ssoErrorMessage(undefined), null);
  assert.equal(ssoErrorMessage('something_else'), null);
});

test('labLaunchState reports readiness, pending, and failure', () => {
  assert.deepEqual(labLaunchState({ status: 'WARM' }), {
    ready: false,
    failed: false,
    ideUrl: null,
  });
  assert.deepEqual(labLaunchState({ status: 'ACTIVE', ideUrl: 'https://ide' }), {
    ready: true,
    failed: false,
    ideUrl: 'https://ide',
  });
  // ACTIVE without a URL is not yet usable.
  assert.equal(labLaunchState({ status: 'ACTIVE', ideUrl: null }).ready, false);
  assert.equal(labLaunchState({ status: 'FAILED' }).failed, true);
});

test('lessonStatusLabel reflects progress and score', () => {
  assert.equal(lessonStatusLabel('not_started', null), 'Not started');
  assert.equal(lessonStatusLabel('in_progress', null), 'In progress');
  assert.equal(lessonStatusLabel('complete', null), 'Completed');
  assert.equal(lessonStatusLabel('complete', 92), 'Completed — 92%');
});

test('courseProgress computes a clamped percentage', () => {
  assert.equal(courseProgress([]), 0);
  assert.equal(courseProgress([{ status: 'complete' }, { status: 'not_started' }]), 50);
  assert.equal(
    courseProgress([{ status: 'complete' }, { status: 'complete' }]),
    100,
  );
});

test('proxyFetchInit disables caching so session polls see fresh status', () => {
  const init = proxyFetchInit({
    method: 'GET',
    headers: new Headers({ cookie: 'a=b' }),
  });
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'manual');
});

test('methodHasBody forwards write bodies and skips reads', () => {
  // Regression: the authoring catch-all proxy dropped POST/PATCH bodies, so
  // "Create course" sent an empty payload and the API rejected it.
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal(methodHasBody(method), true, `${method} carries a body`);
  }
  assert.equal(methodHasBody('GET'), false);
  assert.equal(methodHasBody('HEAD'), false);
});

test('gradebookRowSummary reports progress and average', () => {
  assert.equal(
    gradebookRowSummary({ completed: 1, total: 2, averageScore: 90 }),
    '1/2 lessons · avg 90%',
  );
  assert.equal(
    gradebookRowSummary({ completed: 0, total: 2, averageScore: null }),
    '0/2 lessons · not graded',
  );
});

test('gradebookCellLabel prefers the score, then the status', () => {
  assert.equal(gradebookCellLabel({ status: 'complete', score: 88 }), '88%');
  assert.equal(gradebookCellLabel({ status: 'complete', score: null }), 'Done');
  assert.equal(gradebookCellLabel({ status: 'in_progress', score: null }), 'In progress');
  assert.equal(gradebookCellLabel({ status: 'not_started', score: null }), '—');
});

test('snippetTitle falls back for blank titles', () => {
  assert.equal(snippetTitle('  Two Sum  '), 'Two Sum');
  assert.equal(snippetTitle(''), 'Untitled');
  assert.equal(snippetTitle('   '), 'Untitled');
  assert.equal(snippetTitle(null), 'Untitled');
  assert.equal(snippetTitle(undefined), 'Untitled');
});

test('runStatusLabel distinguishes each run outcome', () => {
  assert.equal(
    runStatusLabel({ exitCode: 0, timedOut: false, unsupported: false, executionTimeMs: 42 }),
    'Finished in 42 ms',
  );
  assert.equal(
    runStatusLabel({ exitCode: 1, timedOut: false, unsupported: false, executionTimeMs: 5 }),
    'Exited with code 1',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: true, unsupported: false, executionTimeMs: 5000 }),
    'Timed out',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: false, unsupported: true, executionTimeMs: 0 }),
    'Runtime unavailable',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: false, unsupported: false, executionTimeMs: 0 }),
    'Stopped',
  );
});

test('runHasOutput is true when either stream has content', () => {
  assert.equal(runHasOutput({ stdout: 'hi', stderr: '' }), true);
  assert.equal(runHasOutput({ stdout: '', stderr: 'boom' }), true);
  assert.equal(runHasOutput({ stdout: '', stderr: '' }), false);
});

test('formatClock renders m:ss and h:mm:ss, clamping negatives', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(1800), '30:00');
  assert.equal(formatClock(3661), '1:01:01');
  assert.equal(formatClock(-5), '0:00');
});

test('clockUrgent fires only in the last two minutes', () => {
  assert.equal(clockUrgent(121), false);
  assert.equal(clockUrgent(120), true);
  assert.equal(clockUrgent(0), true);
});

test('riskLevelLabel maps each band', () => {
  assert.equal(riskLevelLabel('low'), 'Low risk');
  assert.equal(riskLevelLabel('medium'), 'Review');
  assert.equal(riskLevelLabel('high'), 'High risk');
});

test('riskSummaryLabel pluralizes the signal count', () => {
  assert.equal(
    riskSummaryLabel({ eventCount: 1, riskScore: 8, riskLevel: 'low' }),
    'Low risk · 1 signal · score 8',
  );
  assert.equal(
    riskSummaryLabel({ eventCount: 3, riskScore: 25, riskLevel: 'medium' }),
    'Review · 3 signals · score 25',
  );
});

test('attemptClockLabel shows Untimed when there is no deadline', () => {
  assert.equal(attemptClockLabel(null), 'Untimed');
  assert.equal(attemptClockLabel(90), '1:30');
});

test('workspaceStatusLabel maps every lifecycle state', () => {
  assert.equal(workspaceStatusLabel('provisioning'), 'Starting…');
  assert.equal(workspaceStatusLabel('running'), 'Running');
  assert.equal(workspaceStatusLabel('stopped'), 'Stopped');
  assert.equal(workspaceStatusLabel('failed'), 'Failed');
  assert.equal(workspaceStatusLabel('weird'), 'weird');
});

test('forkReadyState reports readiness, pending, and failure', () => {
  assert.deepEqual(forkReadyState({ status: 'provisioning' }), {
    ready: false,
    failed: false,
    ideUrl: null,
  });
  assert.deepEqual(forkReadyState({ status: 'running', ideUrl: 'https://ide' }), {
    ready: true,
    failed: false,
    ideUrl: 'https://ide',
  });
  assert.deepEqual(forkReadyState({ status: 'failed' }), {
    ready: false,
    failed: true,
    ideUrl: null,
  });
});

test('canSubmitWorkspace only allows a stopped workspace', () => {
  assert.equal(canSubmitWorkspace('stopped'), true);
  assert.equal(canSubmitWorkspace('running'), false);
  assert.equal(canSubmitWorkspace('provisioning'), false);
});

test('submissionStatusLabel shows the score once evaluated', () => {
  assert.equal(submissionStatusLabel({ status: 'submitted', score: null }), 'Submitted');
  assert.equal(
    submissionStatusLabel({ status: 'evaluated', score: 92 }),
    'Evaluated — 92',
  );
});

test('projectDeadlinePassed only closes a project past a real deadline', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  assert.equal(projectDeadlinePassed(null, now), false);
  assert.equal(projectDeadlinePassed('2026-05-01T00:00:00Z', now), true);
  assert.equal(projectDeadlinePassed('2026-07-01T00:00:00Z', now), false);
});

test('projectDeadlineLabel reads Closed once the deadline passes', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  assert.equal(projectDeadlineLabel(null, now), 'No deadline');
  assert.equal(
    projectDeadlineLabel('2026-05-01T00:00:00Z', now),
    'Closed — deadline passed',
  );
  assert.match(projectDeadlineLabel('2026-07-01T00:00:00Z', now), /^Due /);
});

test('rankPercentileLabel reads as a top-percent band', () => {
  assert.equal(rankPercentileLabel(100), 'Top of the cohort');
  assert.equal(rankPercentileLabel(90), 'Top 10%');
  assert.equal(rankPercentileLabel(75), 'Top 25%');
  assert.equal(rankPercentileLabel(50), 'Top 50%');
  assert.equal(rankPercentileLabel(49), 'Bottom half');
  assert.equal(rankPercentileLabel(0), 'Bottom half');
});

test('rankPercentileLabel clamps out-of-range input', () => {
  assert.equal(rankPercentileLabel(150), 'Top of the cohort');
  assert.equal(rankPercentileLabel(-10), 'Bottom half');
});

test('templateCategoryLabel names the picker groups (Nov\'25 §1.5)', () => {
  assert.equal(templateCategoryLabel('front_end'), 'Front end');
  assert.equal(templateCategoryLabel('back_end'), 'Backend');
  assert.equal(templateCategoryLabel('full_stack'), 'Full stack');
  assert.equal(templateCategoryLabel('database'), 'Database');
  assert.equal(templateCategoryLabel('other'), 'Other templates');
  assert.equal(templateCategoryLabel('unknown'), 'Other templates');
});

test('attendanceStatusLabel names every status including the unmarked state', () => {
  assert.equal(attendanceStatusLabel('present'), 'Present');
  assert.equal(attendanceStatusLabel('absent'), 'Absent');
  assert.equal(attendanceStatusLabel('late'), 'Late');
  assert.equal(attendanceStatusLabel('excused'), 'Excused');
  assert.equal(attendanceStatusLabel('not_marked'), 'Not marked');
  assert.equal(attendanceStatusLabel('anything-else'), 'Not marked');
});

test('attendanceStatusClass maps to a stable css class', () => {
  assert.equal(attendanceStatusClass('present'), 'present');
  assert.equal(attendanceStatusClass('absent'), 'absent');
  assert.equal(attendanceStatusClass('late'), 'late');
  assert.equal(attendanceStatusClass('excused'), 'excused');
  assert.equal(attendanceStatusClass('not_marked'), 'not_marked');
  assert.equal(attendanceStatusClass('unknown'), 'not_marked');
});

test('attendancePercentLabel flags a shortfall below the 75% threshold', () => {
  assert.equal(attendancePercentLabel(100), '100%');
  assert.equal(attendancePercentLabel(75), '75%');
  assert.equal(attendancePercentLabel(74), '74% — below 75%');
  assert.equal(attendancePercentLabel(0), '0% — below 75%');
});

test('attendancePercentLabel clamps out-of-range input', () => {
  assert.equal(attendancePercentLabel(140), '100%');
  assert.equal(attendancePercentLabel(-5), '0% — below 75%');
});

test('nimbusLanding folds projects, statuses, and submissions into one view', () => {
  const landing = nimbusLanding({
    projects: [
      {
        project: { id: 'p1', title: 'Task API', deadline: null },
        components: [
          { title: 'API', technology: 'spring-boot', fork: { id: 'f1' } },
          { title: 'Web', technology: 'react', fork: null },
        ],
      },
      {
        project: { id: 'p2', title: 'Data Lab', deadline: null },
        components: [{ title: 'DB', technology: 'postgres', fork: null }],
      },
    ],
    statuses: {
      f1: {
        workspaceId: 'w1',
        status: 'running',
        ideUrl: 'https://ide',
        deployUrl: 'https://app',
      },
    },
    submissionCount: 3,
  });

  assert.equal(landing.workspaces.length, 1);
  assert.equal(landing.workspaces[0].forkId, 'f1');
  assert.equal(landing.workspaces[0].workspaceId, 'w1');
  assert.equal(landing.workspaces[0].deployUrl, 'https://app');
  assert.deepEqual(landing.counts, {
    workspaces: 1,
    running: 1,
    liveApps: 1,
    openProjects: 2,
    submissions: 3,
  });
});

test('nimbusLanding lists only projects with an unforked component', () => {
  const landing = nimbusLanding({
    projects: [
      {
        project: { id: 'p1', title: 'Done', deadline: null },
        components: [{ title: 'API', technology: 'java', fork: { id: 'f1' } }],
      },
    ],
    statuses: { f1: { workspaceId: 'w1', status: 'stopped', ideUrl: null, deployUrl: null } },
    submissionCount: 0,
  });

  assert.equal(landing.openProjects.length, 0);
  assert.equal(landing.counts.openProjects, 0);
  assert.equal(landing.counts.running, 0);
});

test('nimbusLanding treats a missing status as still provisioning', () => {
  const landing = nimbusLanding({
    projects: [
      {
        project: { id: 'p1', title: 'Task API', deadline: null },
        components: [{ title: 'API', technology: 'java', fork: { id: 'f1' } }],
      },
    ],
    statuses: {},
    submissionCount: 0,
  });

  assert.equal(landing.workspaces[0].status, 'provisioning');
  assert.equal(landing.workspaces[0].ideUrl, null);
});

test('nimbusLanding with no projects is empty', () => {
  const landing = nimbusLanding({ projects: [], statuses: {}, submissionCount: 0 });
  assert.deepEqual(landing.workspaces, []);
  assert.deepEqual(landing.openProjects, []);
  assert.equal(landing.counts.workspaces, 0);
});

// ------------------------------------------------------------ P3 helpers

test('scoreLabel formats a score as a percent, or a dash when null', () => {
  assert.equal(scoreLabel(0), '0%');
  assert.equal(scoreLabel(72.4), '72%');
  assert.equal(scoreLabel(140), '100%');
  assert.equal(scoreLabel(-5), '0%');
  assert.equal(scoreLabel(null), '\u2014');
  assert.equal(scoreLabel(undefined), '\u2014');
});

test('readinessLabel bands a passport readiness score', () => {
  assert.equal(readinessLabel(null), 'No evidence yet');
  assert.equal(readinessLabel(80), 'Interview ready');
  assert.equal(readinessLabel(60), 'Developing');
  assert.equal(readinessLabel(20), 'Early');
});

test('badgeKindLabel title-cases known kinds and falls back', () => {
  assert.equal(badgeKindLabel('lab'), 'Lab');
  assert.equal(badgeKindLabel('assessment'), 'Assessment');
  assert.equal(badgeKindLabel('interview'), 'Interview');
  assert.equal(badgeKindLabel('mystery'), 'Badge');
});

test('questionKindLabel title-cases known kinds and falls back', () => {
  assert.equal(questionKindLabel('mcq'), 'Multiple choice');
  assert.equal(questionKindLabel('fill'), 'Fill in the blank');
  assert.equal(questionKindLabel('coding'), 'Coding');
  assert.equal(questionKindLabel('mystery'), 'Question');
});

test('feedKindLabel title-cases known kinds and falls back', () => {
  assert.equal(feedKindLabel('submission'), 'Submission');
  assert.equal(feedKindLabel('completion'), 'Completion');
  assert.equal(feedKindLabel('mystery'), 'Activity');
});

test('communicationLabel bands a communication score', () => {
  assert.equal(communicationLabel(null), 'Not yet interviewed');
  assert.equal(communicationLabel(85), '85% \u2014 strong');
  assert.equal(communicationLabel(65), '65% \u2014 solid');
  assert.equal(communicationLabel(30), '30% \u2014 needs practice');
});

test('contestPhaseLabel names each phase and falls back', () => {
  assert.equal(contestPhaseLabel('draft'), 'Draft');
  assert.equal(contestPhaseLabel('scheduled'), 'Scheduled');
  assert.equal(contestPhaseLabel('live'), 'Live now');
  assert.equal(contestPhaseLabel('ended'), 'Ended');
  assert.equal(contestPhaseLabel('mystery'), 'Contest');
});

test('contestIsLive is true only while a contest is live', () => {
  assert.equal(contestIsLive('live'), true);
  for (const phase of ['draft', 'scheduled', 'ended']) {
    assert.equal(contestIsLive(phase), false, `${phase} is not live`);
  }
});

test('durationLabel renders minutes and seconds compactly', () => {
  assert.equal(durationLabel(0), '0s');
  assert.equal(durationLabel(1500), '2s');
  assert.equal(durationLabel(95_000), '1m 35s');
  assert.equal(durationLabel(120_000), '2m 0s');
  assert.equal(durationLabel(-50), '0s');
});

test('withQuery appends a search string and leaves a bare path alone', () => {
  assert.equal(withQuery('/api/passport/recruiter', ''), '/api/passport/recruiter');
  assert.equal(
    withQuery('/api/passport/recruiter', '?minLabScore=70'),
    '/api/passport/recruiter?minLabScore=70',
  );
});

test('similarityLabel renders a ratio as a clamped percentage', () => {
  assert.equal(similarityLabel(0), '0%');
  assert.equal(similarityLabel(0.93), '93%');
  assert.equal(similarityLabel(1), '100%');
  assert.equal(similarityLabel(1.5), '100%');
  assert.equal(similarityLabel(-0.2), '0%');
});
