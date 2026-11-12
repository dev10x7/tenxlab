import type { KubeLabExerciseDescriptor } from '@tenxlab/lab-provider';

/**
 * Demo content for local development and UI walkthroughs. This is the LMS
 * system-of-record seed: one tenant, one published course, and one interactive
 * lab whose exercise is mirrored into KubeLab on first launch.
 *
 * In production this data lives in Postgres (see prisma/schema.prisma); the
 * shapes here match those models so the swap is mechanical.
 */

export interface DemoLesson {
  id: string;
  moduleId: string;
  title: string;
  /** Catalog presentation: video | reading | lab | quiz. */
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  /** System-of-record lesson type. */
  type: 'video' | 'reading' | 'interactive_lab' | 'quiz';
  maxScore: number;
  exerciseSlug?: string;
  runtimeTier?: 'tier_1_microvm' | 'tier_2_container' | 'tier_3_vcluster';
}

export interface DemoModule {
  id: string;
  courseSlug: string;
  title: string;
}

export interface DemoCourse {
  slug: string;
  title: string;
  description: string;
  modules: DemoModule[];
  lessons: DemoLesson[];
}

export const DEMO_COURSES: DemoCourse[] = [
  {
    slug: 'kubernetes-foundations',
    title: 'Kubernetes Foundations',
    description:
      'Learn core Kubernetes objects hands-on. Spin up a real cluster in the browser, create a Pod, and get graded automatically.',
    modules: [
      { id: 'k8s-m1', courseSlug: 'kubernetes-foundations', title: 'Getting started' },
    ],
    lessons: [
      {
        id: 'k8s-l1',
        moduleId: 'k8s-m1',
        title: 'What is Kubernetes?',
        kind: 'reading',
        type: 'reading',
        maxScore: 0,
      },
      {
        id: 'k8s-l2',
        moduleId: 'k8s-m1',
        title: 'Create your first Pod',
        kind: 'lab',
        type: 'interactive_lab',
        maxScore: 100,
        exerciseSlug: 'create-simple-pod',
        runtimeTier: 'tier_3_vcluster',
      },
    ],
  },
];

/**
 * The demo academic batch the seeded student belongs to, so the instructor
 * gradebook has a roster on first boot without any manual setup.
 */
export const DEMO_BATCH = {
  id: 'demo-batch-2026',
  tenantId: 'demo-tenant',
  name: 'Demo Batch 2026',
};

/**
 * Stable course id for a catalog slug. Course ids are not part of the demo
 * corpus (which is keyed by slug), so the system of record derives one here and
 * every writer — the seed, the catalog DTO, enrolments — uses the same rule.
 */
export function courseIdForSlug(slug: string): string {
  return `course-${slug}`;
}

/**
 * Exercise registry: maps an LMS exercise slug to the KubeLab lab/exercise to
 * materialise, plus the script URLs the KubeLab agent fetches from inside the
 * cluster. The scripts themselves are served by this API (see labs/assets).
 */
export function buildExerciseDescriptor(
  exerciseSlug: string,
  assetBaseUrl: string,
): KubeLabExerciseDescriptor {
  const base = assetBaseUrl.replace(/\/$/, '');
  switch (exerciseSlug) {
    case 'create-simple-pod':
      return {
        labSlug: 'kubernetes-foundations',
        labTitle: 'Kubernetes Foundations',
        exerciseTitle: 'Create your first Pod',
        bootstrapUrl: `${base}/api/labs/assets/create-simple-pod/bootstrap.sh`,
        checkUrl: `${base}/api/labs/assets/create-simple-pod/check.sh`,
      };
    default:
      throw new Error(`No KubeLab exercise mapping for slug "${exerciseSlug}"`);
  }
}

/** bootstrap.sh — seeds the student's workspace with the exercise files. */
export const EXERCISE_BOOTSTRAP: Record<string, string> = {
  'create-simple-pod': `#!/bin/sh
set -e
mkdir -p /home/kubelab-agent/exercise
cat > /home/kubelab-agent/exercise/pod.yaml <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: demo-pod
  labels:
    app: demo
spec:
  containers:
    - name: web
      image: nginx:alpine
      ports:
        - containerPort: 80
YAML
echo "Workspace ready. Apply pod.yaml with: kubectl apply -f pod.yaml"
`,
};

/** check.sh — runs in the agent pod; prints a JSON verdict KubeLab records. */
export const EXERCISE_CHECK: Record<string, string> = {
  'create-simple-pod': `#!/bin/sh
if kubectl get pod demo-pod >/dev/null 2>&1; then
  echo '{"passed":true,"score":100,"message":"demo-pod is running"}'
else
  echo '{"passed":false,"score":0,"message":"demo-pod was not found"}'
fi
`,
};
