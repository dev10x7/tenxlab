/**
 * The Clarity task bank (parity §2.10). Each task is one English-practice item
 * for a skill (reading, writing, listening, speaking); the AI plane grades the
 * student's response against `expectedTerms` and maps the score to a CEFR band.
 *
 * The bank is fixed so a sitting is reproducible and the scoring is grounded —
 * the same prompt always asks for the same ideas, so a band compares like with
 * like. `listening` tasks carry a passage the student hears (played by the
 * browser); `reading` tasks carry one they read.
 */
export interface ClarityTask {
  id: string;
  /** reading | writing | listening | speaking */
  skill: string;
  title: string;
  /** What the student is asked to do. */
  prompt: string;
  /** reading/listening: the passage the response is about. */
  passage?: string;
  /** Key ideas a strong response should mention; drives the content score. */
  expectedTerms: string[];
}

export const CLARITY_SKILLS = ['reading', 'writing', 'listening', 'speaking'] as const;

export const CLARITY_TASKS: ClarityTask[] = [
  {
    id: 'reading-k8s-basics',
    skill: 'reading',
    title: 'Kubernetes basics',
    prompt: 'Read the passage and explain, in your own words, what a Pod is.',
    passage:
      'A Pod is the smallest deployable unit in Kubernetes. It wraps one or more '
      + 'containers that share a network namespace and storage. Pods run on a '
      + 'node, and a Deployment keeps the requested number of Pods running.',
    expectedTerms: ['pod', 'container', 'kubernetes', 'node', 'deployment'],
  },
  {
    id: 'reading-docker-layers',
    skill: 'reading',
    title: 'Docker image layers',
    prompt: 'Summarise why layer order matters when building a Docker image.',
    passage:
      'A Docker image is a stack of read-only layers. Each instruction in a '
      + 'Dockerfile creates a layer, and Docker caches layers to speed up builds. '
      + 'Placing instructions that change often after the ones that rarely change '
      + 'keeps the cache warm.',
    expectedTerms: ['layer', 'cache', 'docker', 'build', 'dockerfile'],
  },
  {
    id: 'writing-standup-update',
    skill: 'writing',
    title: 'Write a standup update',
    prompt:
      'Write a short standup update: what you finished, what you are doing next, '
      + 'and any blocker. Use complete sentences.',
    expectedTerms: ['finished', 'next', 'blocker', 'working'],
  },
  {
    id: 'writing-bug-report',
    skill: 'writing',
    title: 'Write a bug report',
    prompt:
      'Write a bug report for a failing login: describe the expected result, the '
      + 'actual result, and the steps to reproduce it.',
    expectedTerms: ['expected', 'actual', 'reproduce', 'steps', 'login'],
  },
  {
    id: 'listening-k8s-overview',
    skill: 'listening',
    title: 'Listen: cluster overview',
    prompt: 'Listen to the passage, then explain what the control plane does.',
    passage:
      'A Kubernetes cluster has a control plane and worker nodes. The control '
      + 'plane runs the API server, the scheduler, and the controller manager. The '
      + 'scheduler places Pods on nodes, and the controllers reconcile the desired '
      + 'state with the observed state.',
    expectedTerms: ['control plane', 'scheduler', 'node', 'state', 'api server'],
  },
  {
    id: 'speaking-explain-rest',
    skill: 'speaking',
    title: 'Speak: explain a REST API',
    prompt:
      'Speak for a minute explaining what a REST API is and give one example '
      + 'endpoint. Speak clearly and avoid filler words.',
    expectedTerms: ['rest', 'http', 'endpoint', 'get', 'resource'],
  },
];

export function findClarityTask(id: string): ClarityTask | null {
  return CLARITY_TASKS.find((t) => t.id === id) ?? null;
}

/** The task bank filtered to one skill, or the whole bank when skill is absent. */
export function clarityTasksFor(skill: string | undefined): ClarityTask[] {
  if (!skill) return CLARITY_TASKS;
  return CLARITY_TASKS.filter((t) => t.skill === skill);
}
