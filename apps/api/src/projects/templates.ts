import type { ProjectTemplate, ProjectTemplateKind } from '@tenxlab/contracts';

/**
 * The project template catalog — the ByteXL "Nimbus" equivalent.
 *
 * Two shapes, matching ByteXL (see docs/BYTEXL_PARITY_ANALYSIS.md §1.4):
 *  - `framework`: dependency-ready stacks a student builds in directly.
 *  - `base_image`: a bare OS (Debian) with no language; the student installs
 *    what they need, used for network-OS and infra practice.
 *
 * A template is only a scaffold descriptor; provisioning happens through the
 * `LabProvider` seam, so adding a template does not add a code path.
 */
export interface TemplateSeed {
  slug: string;
  title: string;
  description: string;
  kind: ProjectTemplateKind;
  stack: string;
  image: string;
}

export const PROJECT_TEMPLATES: TemplateSeed[] = [
  {
    slug: 'python-flask',
    title: 'Python Flask',
    description: 'Flask web service on Python 3 with pip available.',
    kind: 'framework',
    stack: 'python',
    image: 'code-server-python:latest',
  },
  {
    slug: 'java',
    title: 'Java',
    description: 'JDK with Maven for plain Java projects.',
    kind: 'framework',
    stack: 'java',
    image: 'code-server-java:latest',
  },
  {
    slug: 'spring-boot',
    title: 'Spring Boot',
    description: 'Spring Boot service scaffold with Maven.',
    kind: 'framework',
    stack: 'spring-boot',
    image: 'code-server-java:latest',
  },
  {
    slug: 'spring-boot-mongodb',
    title: 'Spring Boot + MongoDB',
    description: 'Spring Boot backend wired to a MongoDB instance.',
    kind: 'framework',
    stack: 'spring-boot',
    image: 'code-server-java:latest',
  },
  {
    slug: 'react',
    title: 'React',
    description: 'React front end with npm available.',
    kind: 'framework',
    stack: 'react',
    image: 'code-server-node:latest',
  },
  {
    slug: 'debian-base',
    title: 'Debian (base image)',
    description:
      'Bare Debian with no language installed. Install what you need with apt — used for network-OS and infra practice.',
    kind: 'base_image',
    stack: 'debian',
    image: 'code-server-debian:latest',
  },
];

/** Resolve a template seed to its contract shape. */
export function projectTemplate(seed: TemplateSeed): ProjectTemplate {
  return { id: seed.slug, ...seed };
}

/** Look up a template seed by slug. */
export function findTemplate(slug: string): TemplateSeed | null {
  return PROJECT_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

/** All templates as contract objects. */
export function listTemplates(): ProjectTemplate[] {
  return PROJECT_TEMPLATES.map(projectTemplate);
}
