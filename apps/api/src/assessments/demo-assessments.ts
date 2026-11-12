import type { Question } from './grader';

/**
 * Demo assessments for local development and the P2 walkthrough. Like the course
 * catalog, these live in code as the system-of-record seed: one graded, proctored
 * assessment (a coding question plus a couple of objective ones) and one ungraded
 * practice set, both attached to the demo Kubernetes course.
 *
 * A `DemoQuestion` carries both the student-facing view fields and the hidden
 * answer key; `toQuestion`/`toView` split them so the answer key never leaves the
 * server.
 */

export interface DemoQuestion {
  id: string;
  /** Grader kind. */
  kind: 'coding' | 'mcq' | 'fill' | 'descriptive';
  prompt: string;
  maxScore: number;
  /** Coding: starter code, possibly carrying a read-only solution region. */
  stubCode?: string;
  /** Coding: the Piston language id to run submissions with. */
  language?: string;
  /** Coding: test cases (hidden from the student). */
  tests?: Array<{ input: string; expected: string }>;
  /** MCQ/fill: the options to render. */
  options?: string[];
  /** MCQ: index of the correct option (or the correct set when `multiple`). */
  correctIndex?: number;
  /** MCQ: whether more than one option must be selected. */
  multiple?: boolean;
  /** Fill: accepted answers (compared case-insensitively). */
  accepted?: string[];
  /** Descriptive: rubric keywords; score is proportional to coverage. */
  rubricKeywords?: string[];
}

export interface DemoAssessment {
  id: string;
  courseSlug: string;
  title: string;
  mode: 'practice' | 'graded';
  /** Only graded assessments are proctored. */
  durationSeconds: number | null;
  questions: DemoQuestion[];
}

const CODING_STUB = [
  'def average(nums):',
  '    """Return the arithmetic mean of a list of numbers."""',
  '    # start your solution',
  '    # Write your code here',
  '    # end your solution',
  '    return result',
  '',
].join('\n');

export const DEMO_ASSESSMENTS: DemoAssessment[] = [
  {
    id: 'k8s-quiz-1',
    courseSlug: 'kubernetes-foundations',
    title: 'Kubernetes Foundations — Graded Test',
    mode: 'graded',
    durationSeconds: 1800,
    questions: [
      {
        id: 'q-pod',
        kind: 'mcq',
        prompt: 'Which object runs one or more containers on a cluster node?',
        maxScore: 20,
        options: ['Pod', 'Service', 'Ingress', 'Namespace'],
        correctIndex: 0,
      },
      {
        id: 'q-mean',
        kind: 'coding',
        prompt:
          'Implement `average(nums)` to return the arithmetic mean. Keep the signature read-only.',
        maxScore: 60,
        stubCode: CODING_STUB,
        language: 'python',
        tests: [
          { input: '[1, 2, 3]', expected: '2.0' },
          { input: '[4, 8]', expected: '6.0' },
        ],
      },
      {
        id: 'q-kubectl',
        kind: 'fill',
        prompt: 'Which kubectl verb creates a resource from a manifest file?',
        maxScore: 20,
        accepted: ['apply', 'kubectl apply'],
      },
    ],
  },
  {
    id: 'k8s-practice-1',
    courseSlug: 'kubernetes-foundations',
    title: 'Kubernetes Foundations — Practice',
    mode: 'practice',
    durationSeconds: null,
    questions: [
      {
        id: 'p-describe',
        kind: 'descriptive',
        prompt: 'In your own words, what does a Kubernetes Pod represent?',
        maxScore: 10,
        rubricKeywords: ['container', 'scheduling', 'unit'],
      },
    ],
  },
];

/** Look up an assessment by id. */
export function demoAssessment(id: string): DemoAssessment | undefined {
  return DEMO_ASSESSMENTS.find((a) => a.id === id);
}

/** The grader question for a demo question, including its hidden answer key. */
export function toQuestion(q: DemoQuestion): Question {
  switch (q.kind) {
    case 'mcq':
      return {
        type: 'mcq',
        id: q.id,
        maxScore: q.maxScore,
        correctIndex: q.correctIndex ?? 0,
        multiple: q.multiple,
      };
    case 'fill':
      return { type: 'fill', id: q.id, maxScore: q.maxScore, accepted: q.accepted ?? [] };
    case 'descriptive':
      return {
        type: 'descriptive',
        id: q.id,
        maxScore: q.maxScore,
        rubricKeywords: q.rubricKeywords ?? [],
      };
    case 'coding':
      return { type: 'coding', id: q.id, maxScore: q.maxScore, tests: q.tests ?? [] };
  }
}

/** The student-facing view of a question: no answer key, no hidden tests. */
export interface QuestionView {
  id: string;
  kind: DemoQuestion['kind'];
  prompt: string;
  maxScore: number;
  stubCode?: string;
  hasSolutionRegion: boolean;
  options?: string[];
  multiple?: boolean;
}

export function toQuestionView(q: DemoQuestion): QuestionView {
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    maxScore: q.maxScore,
    stubCode: q.stubCode,
    // A stub is "read-only protected" only when it actually carries markers.
    hasSolutionRegion: q.kind === 'coding' && hasSolutionMarkers(q.stubCode),
    options: q.options,
    multiple: q.multiple,
  };
}

function hasSolutionMarkers(stub: string | undefined): boolean {
  if (!stub) return false;
  return /start your solution/.test(stub) && /end your solution/.test(stub);
}
