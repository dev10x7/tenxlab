import type {
  ProjectTemplate,
  ProjectTemplateCategory,
  ProjectTemplateKind,
} from '@tenxlab/contracts';

/**
 * The project template catalog — the ByteXL "Nimbus" equivalent.
 *
 * Shapes, matching ByteXL (see docs/BYTEXL_PARITY_ANALYSIS.md §1.4, §1.5):
 *  - `framework`: dependency-ready stacks a student builds in directly.
 *  - `base_image`: a bare OS (Debian) with no language; the student installs
 *    what they need, used for network-OS and infra practice.
 *
 * Templates are grouped into the picker's categories (front end / backend /
 * full stack / database / other). A **database** template is a `framework`
 * workspace whose image ships the engine pre-installed (MySQL, PostgreSQL, SQL
 * Server, MongoDB), so a student builds against a real database without a
 * separate provisioning step.
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
  category: ProjectTemplateCategory;
  /** Database engine a database workspace ships with, e.g. "postgres". */
  database?: string;
}

export const PROJECT_TEMPLATES: TemplateSeed[] = [
  {
    slug: 'python-flask',
    title: 'Python Flask',
    description: 'Flask web service on Python 3 with pip available.',
    kind: 'framework',
    stack: 'python',
    image: 'code-server-python:latest',
    category: 'back_end',
  },
  {
    slug: 'java',
    title: 'Java',
    description: 'JDK with Maven for plain Java projects.',
    kind: 'framework',
    stack: 'java',
    image: 'code-server-java:latest',
    category: 'back_end',
  },
  {
    slug: 'spring-boot',
    title: 'Spring Boot',
    description: 'Spring Boot service scaffold with Maven.',
    kind: 'framework',
    stack: 'spring-boot',
    image: 'code-server-java:latest',
    category: 'back_end',
  },
  {
    slug: 'spring-boot-mongodb',
    title: 'Spring Boot + MongoDB',
    description: 'Spring Boot backend wired to a MongoDB instance.',
    kind: 'framework',
    stack: 'spring-boot',
    image: 'code-server-java:latest',
    category: 'full_stack',
  },
  {
    slug: 'react',
    title: 'React',
    description: 'React front end with npm available.',
    kind: 'framework',
    stack: 'react',
    image: 'code-server-node:latest',
    category: 'front_end',
  },
  {
    slug: 'debian-base',
    title: 'Debian (base image)',
    description:
      'Bare Debian with no language installed. Install what you need with apt — used for network-OS and infra practice.',
    kind: 'base_image',
    stack: 'debian',
    image: 'code-server-debian:latest',
    category: 'other',
  },
  {
    slug: 'mysql',
    title: 'MySQL',
    description: 'MySQL server pre-installed and running, ready for SQL practice.',
    kind: 'framework',
    stack: 'mysql',
    image: 'code-server-mysql:latest',
    category: 'database',
    database: 'mysql',
  },
  {
    slug: 'postgres',
    title: 'PostgreSQL',
    description: 'PostgreSQL server pre-installed and running, ready for SQL practice.',
    kind: 'framework',
    stack: 'postgres',
    image: 'code-server-postgres:latest',
    category: 'database',
    database: 'postgres',
  },
  {
    slug: 'sqlserver',
    title: 'SQL Server',
    description: 'Microsoft SQL Server pre-installed, ready for T-SQL practice.',
    kind: 'framework',
    stack: 'sqlserver',
    image: 'code-server-sqlserver:latest',
    category: 'database',
    database: 'sqlserver',
  },
  {
    slug: 'mongodb',
    title: 'MongoDB',
    description: 'MongoDB server pre-installed, ready for document-model practice.',
    kind: 'framework',
    stack: 'mongodb',
    image: 'code-server-mongodb:latest',
    category: 'database',
    database: 'mongodb',
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
