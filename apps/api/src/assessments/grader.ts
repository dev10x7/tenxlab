/**
 * Deterministic, provider-free grading for the four question types the LMS
 * supports. Each grader returns a score in [0, maxScore] plus per-question
 * feedback, so an instructor can always explain a result.
 */

export interface GradeResult {
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
}

export interface McqQuestion {
  type: 'mcq';
  id: string;
  maxScore: number;
  /** Index of the correct option. */
  correctIndex: number;
  /** Whether more than one option must be selected. */
  multiple?: boolean;
}

export interface FillQuestion {
  type: 'fill';
  id: string;
  maxScore: number;
  /** Accepted answers, compared case-insensitively after trimming. */
  accepted: string[];
}

export interface DescriptiveQuestion {
  type: 'descriptive';
  id: string;
  maxScore: number;
  /** Rubric keywords; score is proportional to coverage. */
  rubricKeywords: string[];
  /** Coverage fraction required for full marks. */
  passFraction?: number;
}

export interface CodingQuestion {
  type: 'coding';
  id: string;
  maxScore: number;
  /** Test cases evaluated against the submitted output. */
  tests: Array<{ input: string; expected: string }>;
}

export type Question =
  | McqQuestion
  | FillQuestion
  | DescriptiveQuestion
  | CodingQuestion;

/** Answers arrive as JSON-safe values keyed by question id. */
export type AnswerMap = Record<string, unknown>;

export function gradeMcq(q: McqQuestion, answer: unknown): GradeResult {
  const picked = Array.isArray(answer) ? answer.map(Number) : [Number(answer)];
  const expected = [q.correctIndex];
  const ok = q.multiple
    ? picked.length === expected.length && picked.every((p) => expected.includes(p))
    : picked.length === 1 && picked[0] === q.correctIndex;
  return {
    score: ok ? q.maxScore : 0,
    maxScore: q.maxScore,
    correct: ok,
    feedback: ok ? 'Correct.' : 'Incorrect option selected.',
  };
}

export function gradeFill(q: FillQuestion, answer: unknown): GradeResult {
  const given = String(answer ?? '').trim().toLowerCase();
  const ok = q.accepted.some((a) => a.trim().toLowerCase() === given);
  return {
    score: ok ? q.maxScore : 0,
    maxScore: q.maxScore,
    correct: ok,
    feedback: ok ? 'Correct.' : 'Answer did not match any accepted value.',
  };
}

export function gradeDescriptive(
  q: DescriptiveQuestion,
  answer: unknown,
): GradeResult {
  const text = String(answer ?? '').toLowerCase();
  const keywords = q.rubricKeywords.map((k) => k.toLowerCase());
  if (keywords.length === 0) {
    const hasText = text.trim().length > 0;
    return {
      score: hasText ? q.maxScore : 0,
      maxScore: q.maxScore,
      correct: hasText,
      feedback: hasText ? 'Answer recorded.' : 'No answer submitted.',
    };
  }
  const hit = keywords.filter((k) => text.includes(k));
  const coverage = hit.length / keywords.length;
  const threshold = q.passFraction ?? 0.6;
  const score = Math.round(q.maxScore * coverage);
  const missing = keywords.filter((k) => !hit.includes(k));
  return {
    score,
    maxScore: q.maxScore,
    correct: coverage >= threshold,
    feedback:
      missing.length === 0
        ? 'All rubric points addressed.'
        : `Missing rubric points: ${missing.join(', ')}.`,
  };
}

/**
 * Coding questions are graded by running the submitted program against test
 * cases. The runner is injected so the same grader works for a containerised
 * sandbox in production and a trivial stub in tests.
 */
export interface CodeRunner {
  run(code: string, input: string): Promise<string>;
}

export async function gradeCoding(
  q: CodingQuestion,
  code: string,
  runner: CodeRunner,
): Promise<GradeResult> {
  if (q.tests.length === 0) {
    return {
      score: 0,
      maxScore: q.maxScore,
      correct: false,
      feedback: 'No test cases configured for this question.',
    };
  }
  let passed = 0;
  for (const test of q.tests) {
    let output: string;
    try {
      output = await runner.run(code, test.input);
    } catch {
      output = '<error>';
    }
    if (normalizeOutput(output) === normalizeOutput(test.expected)) passed += 1;
  }
  const score = Math.round((passed / q.tests.length) * q.maxScore);
  return {
    score,
    maxScore: q.maxScore,
    correct: passed === q.tests.length,
    feedback: `${passed}/${q.tests.length} test cases passed.`,
  };
}

function normalizeOutput(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

/** Grade a whole attempt, dispatching per question type. */
export async function gradeAttempt(
  questions: Question[],
  answers: AnswerMap,
  runner: CodeRunner,
): Promise<{ results: Record<string, GradeResult>; total: number; maxTotal: number }> {
  const results: Record<string, GradeResult> = {};
  let total = 0;
  let maxTotal = 0;

  for (const q of questions) {
    const answer = answers[q.id];
    let result: GradeResult;
    switch (q.type) {
      case 'mcq':
        result = gradeMcq(q, answer);
        break;
      case 'fill':
        result = gradeFill(q, answer);
        break;
      case 'descriptive':
        result = gradeDescriptive(q, answer);
        break;
      case 'coding':
        result = await gradeCoding(q, String(answer ?? ''), runner);
        break;
    }
    results[q.id] = result;
    total += result.score;
    maxTotal += result.maxScore;
  }

  return { results, total, maxTotal };
}
