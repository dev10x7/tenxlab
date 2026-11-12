import type { ProjectComponentRecord, ProjectRecord } from '../common/ports';

/**
 * A seeded demo project so the Projects surface has content the moment the
 * stack boots, matching how the demo catalog and batch are seeded. The project
 * is published and open-ended (no deadline) so a student can fork and submit
 * without a clock in the way. It carries a single component (a Spring Boot
 * backend); a multi-component project would add one row per technology.
 */
export const DEMO_PROJECT: ProjectRecord = {
  id: 'project-demo-spring-api',
  tenantId: 'demo-tenant',
  title: 'Build a Spring Boot REST API',
  description:
    'Create a small Spring Boot service with create, read, and delete endpoints, then submit your workspace with an optional GitHub link.',
  runtimeTier: 'tier_2_container',
  status: 'published',
  deadline: null,
  maxScore: 100,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const DEMO_PROJECT_COMPONENT: ProjectComponentRecord = {
  id: 'project-component-demo-spring-api',
  tenantId: 'demo-tenant',
  projectId: DEMO_PROJECT.id,
  title: 'REST API service',
  technology: 'spring-boot',
  templateSlug: 'spring-boot',
  templateWorkspaceId: null,
  position: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};
