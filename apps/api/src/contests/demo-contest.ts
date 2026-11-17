import type { ContestRecord } from '../common/ports';

/**
 * A seeded contest so the `/contests` surface has content on first boot and the
 * Phase G exit criterion (a live contest with a real-time leaderboard) can be
 * driven without an authoring step. Open-ended (no window) so it is always
 * `live`, mirroring the always-on ranks the dashboard already shows.
 */
export const DEMO_CONTEST: ContestRecord = {
  id: 'demo-contest-k8s-sprint',
  tenantId: 'demo-tenant',
  title: 'Kubernetes Fundamentals Sprint',
  description:
    'A timed sprint across the Kubernetes foundations lessons. Highest score wins; ties are broken by the fastest completion.',
  status: 'published',
  startAt: null,
  endAt: null,
  maxScore: 100,
  exerciseSlug: 'create-simple-pod',
  createdBy: 'demo-instructor',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};
