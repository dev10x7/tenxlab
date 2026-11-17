import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryAttemptRepository,
  InMemoryMembershipRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import type { AttemptRecord } from '../common/ports';
import { AssessmentService } from '../assessments/assessment.service';
import { IntegrityService, DEFAULT_SIMILARITY_THRESHOLD } from './integrity.service';
import type { PlagiarismScanner, PlagiarismReport } from '../ai/ai-bridge.client';

const TENANT = 'tenant-1';

/** A submitted attempt with a coding answer for the demo's `q-mean` question. */
function submitted(userId: string, code: string): AttemptRecord {
  return {
    id: `a-${userId}`,
    userId,
    assessmentId: 'k8s-quiz-1',
    status: 'submitted',
    startedAt: new Date('2026-11-11T09:00:00Z'),
    endsAt: null,
    submittedAt: new Date('2026-11-11T09:10:00Z'),
    score: 100,
    answers: JSON.stringify({ 'q-mean': code }),
    results: null,
  };
}

/** A scanner that reports each student as a copy of the previous one. */
function copyScanner(): PlagiarismScanner {
  return {
    async compareSubmissions({ submissions, threshold = DEFAULT_SIMILARITY_THRESHOLD }) {
      return submissions.map((s, i) => {
        const peer = submissions[i - 1] ?? submissions[i + 1];
        const similarity = peer ? 0.95 : 0;
        const report: PlagiarismReport = {
          studentId: s.studentId,
          maxSimilarity: similarity,
          flagged: similarity >= threshold,
          matches: peer ? [{ studentId: peer.studentId, similarity }] : [],
        };
        return report;
      });
    },
  };
}

function wiring(scanner: PlagiarismScanner | null) {
  const attempts = new InMemoryAttemptRepository([
    submitted('u1', 'def average(nums): return sum(nums) / len(nums)'),
    submitted('u2', 'def average(nums): return sum(nums) / len(nums)'),
    submitted('u3', 'def average(nums): return sum(nums) / len(nums)'),
  ]);
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm2', userId: 'u2', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm3', userId: 'u3', tenantId: TENANT, role: 'student', status: 'active' },
  ]);
  const users = new InMemoryUserRepository([
    { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace' },
    { id: 'u2', email: 'alan@example.com', fullName: 'Alan Turing' },
    { id: 'u3', email: 'grace@example.com', fullName: 'Grace Hopper' },
  ]);
  const assessments = new AssessmentService({ attempts, memberships, runner: null });
  const integrity = new IntegrityService({ assessments, memberships, users, scanner });
  return { integrity, assessments };
}

test('a scan flags near-identical submissions and resolves student names', async () => {
  const { integrity } = wiring(copyScanner());
  const scan = await integrity.scanAssessment('k8s-quiz-1', TENANT);

  assert.equal(scan.compared, 3);
  assert.equal(scan.flaggedCount, 3);
  assert.equal(scan.threshold, DEFAULT_SIMILARITY_THRESHOLD);
  const ada = scan.results.find((r) => r.userId === 'u1')!;
  assert.equal(ada.studentName, 'Ada Lovelace');
  assert.equal(ada.flagged, true);
  assert.ok(ada.matches.length >= 1);
  assert.ok(ada.matches[0]!.similarity >= 0.9);
});

test('a custom threshold reclassifies borderline matches', async () => {
  const scanner: PlagiarismScanner = {
    async compareSubmissions({ submissions }) {
      return submissions.map((s, i) => ({
        studentId: s.studentId,
        maxSimilarity: i === 0 ? 0.5 : 0.5,
        flagged: false,
        matches: [],
      }));
    },
  };
  const { integrity } = wiring(scanner);
  const strict = await integrity.scanAssessment('k8s-quiz-1', TENANT, 0.4);
  assert.equal(strict.threshold, 0.4);
  assert.equal(strict.flaggedCount, 3);
});

test('a scan with fewer than two submitters reports an empty cohort', async () => {
  const attempts = new InMemoryAttemptRepository([submitted('u1', 'code')]);
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: TENANT, role: 'student', status: 'active' },
  ]);
  const assessments = new AssessmentService({ attempts, memberships, runner: null });
  const integrity = new IntegrityService({
    assessments,
    memberships,
    users: new InMemoryUserRepository([]),
    scanner: copyScanner(),
  });

  const scan = await integrity.scanAssessment('k8s-quiz-1', TENANT);
  assert.equal(scan.compared, 0);
  assert.deepEqual(scan.results, []);
});

test('an unconfigured scanner reports the scan as unavailable', async () => {
  const { integrity } = wiring(null);
  assert.equal(integrity.available, false);
  const scan = await integrity.scanAssessment('k8s-quiz-1', TENANT);
  assert.equal(scan.compared, 0);
});

test('a malformed answer blob is skipped, not thrown', async () => {
  const attempts = new InMemoryAttemptRepository([
    submitted('u1', 'def average(nums): return sum(nums) / len(nums)'),
    { ...submitted('u2', ''), answers: '{not json' },
    submitted('u3', 'def average(nums): return sum(nums) / len(nums)'),
  ]);
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm2', userId: 'u2', tenantId: TENANT, role: 'student', status: 'active' },
    { id: 'm3', userId: 'u3', tenantId: TENANT, role: 'student', status: 'active' },
  ]);
  const assessments = new AssessmentService({ attempts, memberships, runner: null });
  const integrity = new IntegrityService({
    assessments,
    memberships,
    users: new InMemoryUserRepository([]),
    scanner: copyScanner(),
  });

  const scan = await integrity.scanAssessment('k8s-quiz-1', TENANT);
  // The two valid submitters were compared; the malformed row was skipped.
  assert.equal(scan.compared, 2);
});
