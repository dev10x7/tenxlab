import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassportService, readinessScore, toRecruiterCsv } from './passport.service';
import { ContestService } from '../contests/contest.service';
import { InMemoryLeaderboard } from '../contests/leaderboard';
import {
  InMemoryAttemptRepository,
  InMemoryBatchRepository,
  InMemoryContestEntryRepository,
  InMemoryContestRepository,
  InMemoryEnrollmentRepository,
  InMemoryInterviewAttemptRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryProgressRepository,
  InMemoryProjectSubmissionRepository,
  InMemorySkillPassportRepository,
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from '../common/in-memory';

const TENANT = 't1';

function build() {
  const users = new InMemoryUserRepository([
    { id: 's1', email: 'ada@x.dev', fullName: 'Ada Lovelace' },
    { id: 's2', email: 'bob@x.dev', fullName: 'Bob Stone' },
  ]);
  const progress = new InMemoryProgressRepository([
    { id: 'p1', userId: 's1', lessonId: 'l1', status: 'complete', score: 90, attempts: 1, completedAt: new Date('2026-02-01') },
    { id: 'p2', userId: 's1', lessonId: 'l2', status: 'complete', score: 80, attempts: 1, completedAt: new Date('2026-02-02') },
    { id: 'p3', userId: 's1', lessonId: 'l3', status: 'in_progress', score: null, attempts: 1, completedAt: null },
  ]);
  const lessons = new InMemoryLessonRepository([
    { id: 'l1', moduleId: 'm1', title: 'Pods', type: 'reading', maxScore: 100, position: 0 },
    { id: 'l2', moduleId: 'm1', title: 'Services', type: 'reading', maxScore: 100, position: 1 },
  ]);
  const attempts = new InMemoryAttemptRepository([
    { id: 'a1', userId: 's1', assessmentId: 'assess_1', status: 'submitted', startedAt: new Date('2026-02-03'), endsAt: null, submittedAt: new Date('2026-02-03'), score: 70, answers: null, results: null },
    { id: 'a2', userId: 's1', assessmentId: 'assess_2', status: 'in_progress', startedAt: new Date('2026-02-04'), endsAt: null, submittedAt: null, score: null, answers: null, results: null },
  ]);
  const interviews = new InMemoryInterviewAttemptRepository([
    { id: 'iv1', tenantId: TENANT, userId: 's1', promptId: 'p', promptTitle: 'Explain Kubernetes', transcript: '...', communicationScore: 82, grammar: 80, vocabulary: 80, fillerWords: 2, technicalAccuracy: 85, createdAt: new Date('2026-02-07') },
  ]);
  const submissions = new InMemoryProjectSubmissionRepository([
    { id: 'sub1', tenantId: TENANT, projectId: 'proj', componentId: 'comp', userId: 's1', workspaceId: 'ws', title: 'Nimbus App', description: '', githubUrl: null, demoUrl: null, status: 'evaluated', score: 88, feedback: null, autoScore: null, autoReport: null, autoEvaluatedAt: null, submittedAt: new Date('2026-02-05'), evaluatedAt: new Date('2026-02-06') },
  ]);
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 's1', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm2', userId: 's2', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm3', userId: 'i1', tenantId: TENANT, role: 'instructor', status: 'active' },
  ]);
  const tenants = new InMemoryTenantRepository([{ id: TENANT, name: 'Acme University', domain: 'acme.test', maxConcurrentLabs: 5, monthlyBudgetCents: 0, plan: 'institution', status: 'active' }]);
  const batches = new InMemoryBatchRepository([
    { id: 'b1', tenantId: TENANT, name: 'CSE 2026', endDate: new Date('2026-05-31') },
  ]);
  const enrollments = new InMemoryEnrollmentRepository([
    { id: 'e1', userId: 's1', courseId: 'c1', batchId: 'b1' },
  ]);

  const contests = new ContestService({
    contests: new InMemoryContestRepository(),
    entries: new InMemoryContestEntryRepository(),
    leaderboard: new InMemoryLeaderboard(),
    users,
  });

  const service = new PassportService({
    passports: new InMemorySkillPassportRepository(),
    progress,
    attempts,
    interviews,
    submissions,
    lessons,
    memberships,
    users,
    tenants,
    batches,
    enrollments,
    contests,
  });
  return { service };
}

test('forStudent derives badges from every evidence kind, newest first', async () => {
  const { service } = build();
  const passport = await service.forStudent('s1', TENANT);
  assert.equal(passport.fullName, 'Ada Lovelace');
  assert.equal(passport.email, 'ada@x.dev');
  assert.equal(passport.verifiedBadges, 5); // 2 labs + 1 assessment + 1 project + 1 interview
  assert.equal(passport.avgLabScore, 85);
  assert.equal(passport.avgAssessmentScore, 70);
  assert.equal(passport.communicationScore, 82);

  const kinds = passport.badges.map((b) => b.kind).sort();
  assert.deepEqual(kinds, ['assessment', 'interview', 'lab', 'lab', 'project']);
  // Newest first: the interview (2026-02-07) leads.
  assert.equal(passport.badges[0]!.kind, 'interview');
  // Lab badges carry the lesson title, not the id.
  const lab = passport.badges.find((b) => b.kind === 'lab');
  assert.ok(lab && (lab.label === 'Pods' || lab.label === 'Services'));
  // Every badge has a stable, unique id.
  const ids = passport.badges.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the recruiter shortlist filters by institution, graduation year, and score', async () => {
  const { service } = build();
  const all = await service.recruiter(TENANT);
  assert.ok(all.some((r) => r.userId === 's1'));
  // The instructor membership is not a student row.
  assert.ok(!all.some((r) => r.userId === 'i1'));

  const ada = all.find((r) => r.userId === 's1')!;
  assert.equal(ada.institution, 'Acme University');
  assert.equal(ada.graduationYear, 2026);

  const byInstitution = await service.recruiter(TENANT, { institution: 'acme' });
  assert.equal(byInstitution.length, 2, 'both students are at Acme University');
  const noInstitution = await service.recruiter(TENANT, { institution: 'nowhere' });
  assert.equal(noInstitution.length, 0);

  const byYear = await service.recruiter(TENANT, { graduationYear: 2025 });
  assert.equal(byYear.length, 0);

  const byLabScore = await service.recruiter(TENANT, { minLabScore: 90 });
  assert.equal(byLabScore.length, 0, 'nobody averages 90+');

  const byBadges = await service.recruiter(TENANT, { minBadges: 1 });
  assert.equal(byBadges.length, 1);
});

test('the CSV export has a header and one quoted row per candidate', async () => {
  const { service } = build();
  const csv = await service.recruiterCsv(TENANT);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'userId,fullName,email,institution,graduationYear,verifiedBadges,avgLabScore,communicationScore,bestContestRank,readiness');
  assert.equal(lines.length, 3, 'a header plus one row per student');
  assert.ok(lines[1]!.startsWith('s1,Ada Lovelace,ada@x.dev,'));
});

test('readinessScore blends, passes through a single score, and is null with none', () => {
  assert.equal(readinessScore(80, 60), 70);
  assert.equal(readinessScore(80, null), 80);
  assert.equal(readinessScore(null, 60), 60);
  assert.equal(readinessScore(null, null), null);
});

test('toRecruiterCsv escapes commas and quotes in a field', () => {
  const csv = toRecruiterCsv([
    {
      userId: 's1',
      fullName: 'Doe, Jane "JJ"',
      email: 'jj@x.dev',
      institution: 'Acme, Inc.',
      graduationYear: null,
      verifiedBadges: 1,
      avgLabScore: null,
      communicationScore: null,
      bestContestRank: null,
      readiness: null,
    },
  ]);
  assert.ok(csv.includes('"Doe, Jane ""JJ"""'));
  assert.ok(csv.includes('"Acme, Inc."'));
});
