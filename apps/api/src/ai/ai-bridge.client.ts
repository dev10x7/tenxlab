/**
 * Minimal client for the TenXLab AI plane (FastAPI).
 *
 * ByteXL auto-evaluates submissions with SonarQube; we mirror that with the
 * in-house `quality.py` analyzer (ADR-13) so the license gate stays
 * permissive-only. Only the one endpoint we need is implemented, so there is no
 * SDK dependency — the same shape as `GitHubClient`.
 */

export interface AiBridgeClientOptions {
  /** Base URL of the AI plane, e.g. `http://localhost:8000`. */
  baseUrl: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** One issue the analyzer raised, with the line it points at (when known). */
export interface QualityIssue {
  code: string;
  message: string;
  line: number | null;
}

/** A quality report: a 0-100 score plus the explainable issues behind it. */
export interface QualityReport {
  score: number;
  issueCount: number;
  issues: QualityIssue[];
}

export class AiBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiBridgeError';
  }
}

/** What the evaluation service needs from the AI plane (fakeable in tests). */
export interface QualityAnalyzer {
  scoreQuality(input: {
    tenantId: string;
    projectId: string;
    studentId: string;
    code: string;
  }): Promise<QualityReport>;
}

/**
 * Tutor modes (parity §1.6). `assist` is the practice-editor behaviour and may
 * return corrected code; `socratic` never does and is the only mode a graded
 * assessment may reach.
 */
export type TutorMode = 'assist' | 'socratic';

/** A tutor review: an explanation, the issues behind it, and (assist only) code. */
export interface TutorReport {
  mode: TutorMode;
  score: number;
  issueCount: number;
  issues: QualityIssue[];
  explanation: string;
  correctedCode: string | null;
  followUpQuestion: string | null;
}

/** What the editor's tutor needs from the AI plane (fakeable in tests). */
export interface CodeReviewer {
  reviewCode(input: {
    language: string;
    code: string;
    mode: TutorMode;
    stderr?: string;
  }): Promise<TutorReport>;
}

/** A project title/description the suggester proposed, with what it used. */
export interface CopySuggestion {
  title: string;
  description: string;
  basedOn: string[];
}

/** What the project authoring form needs from the AI plane (fakeable in tests). */
export interface CopySuggester {
  suggestProjectCopy(input: {
    hint?: string;
    stacks: string[];
    componentTitles: string[];
  }): Promise<CopySuggestion>;
}

/** A study-coach answer for one AI Mentor question (parity §2.5). */
export interface MentorAnswer {
  topic: string;
  answer: string;
  nextSteps: string[];
  suggestedQuestion: string;
}

/** What the AI Mentor surface needs from the AI plane (fakeable in tests). */
export interface MentorAssistant {
  askMentor(input: {
    tenantId: string;
    studentId: string;
    question: string;
  }): Promise<MentorAnswer>;
}

/** A communication score for one mock-interview answer (parity §2.6). */
export interface SpeechReport {
  communicationScore: number;
  grammar: number;
  vocabulary: number;
  fillerWords: number;
  technicalAccuracy: number;
}

/** What the AI Interviewer surface needs from the AI plane (fakeable in tests). */
export interface SpeechEvaluator {
  evaluateSpeech(input: {
    tenantId: string;
    studentId: string;
    promptId: string;
    transcript: string;
    expectedTerms: string[];
  }): Promise<SpeechReport>;
}

/** One student's similarity result in a cohort scan (parity §4.2). */
export interface PlagiarismMatch {
  studentId: string;
  similarity: number;
}

/** A student's plagiarism report: their worst match plus every match found. */
export interface PlagiarismReport {
  studentId: string;
  maxSimilarity: number;
  flagged: boolean;
  matches: PlagiarismMatch[];
}

/** What the batch-scope anti-cheat scan needs from the AI plane (fakeable). */
export interface PlagiarismScanner {
  /**
   * Compare every submission in a cohort against the rest and return a report
   * per student. The AI plane is rename-invariant (winnowing fingerprints), so
   * a renamed copy is still caught.
   */
  compareSubmissions(input: {
    tenantId: string;
    exerciseId: string;
    submissions: Array<{ studentId: string; code: string }>;
    threshold?: number;
  }): Promise<PlagiarismReport[]>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class AiBridgeClient
  implements
    QualityAnalyzer,
    CodeReviewer,
    CopySuggester,
    MentorAssistant,
    SpeechEvaluator,
    PlagiarismScanner
{
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AiBridgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Score a body of source code with the AI plane's quality analyzer. */
  async scoreQuality(input: {
    tenantId: string;
    projectId: string;
    studentId: string;
    code: string;
  }): Promise<QualityReport> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/quality/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          student_id: input.studentId,
          code: input.code,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'request failed';
      throw new AiBridgeError(`AI plane unreachable: ${reason}`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AiBridgeError(`AI plane rejected the request (${res.status})`, res.status);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      score: clampScore(json.score),
      issueCount: Number(json.issue_count ?? 0),
      issues: normaliseIssues(json.issues),
    };
  }

  /** Review code with the AI plane's tutor (assist or socratic mode). */
  async reviewCode(input: {
    language: string;
    code: string;
    mode: TutorMode;
    stderr?: string;
  }): Promise<TutorReport> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/tutor/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          language: input.language,
          code: input.code,
          mode: input.mode,
          stderr: input.stderr ?? '',
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'request failed';
      throw new AiBridgeError(`AI plane unreachable: ${reason}`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AiBridgeError(`AI plane rejected the request (${res.status})`, res.status);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      mode: json.mode === 'socratic' ? 'socratic' : 'assist',
      score: clampScore(json.score),
      issueCount: Number(json.issue_count ?? 0),
      issues: normaliseIssues(json.issues),
      explanation: typeof json.explanation === 'string' ? json.explanation : '',
      correctedCode: typeof json.corrected_code === 'string' ? json.corrected_code : null,
      followUpQuestion:
        typeof json.follow_up_question === 'string' ? json.follow_up_question : null,
    };
  }

  /** Suggest a project title/description from its structural facts (§2.11). */
  async suggestProjectCopy(input: {
    hint?: string;
    stacks: string[];
    componentTitles: string[];
  }): Promise<CopySuggestion> {
    const json = await this.postJson('/v1/copy/suggest', {
      hint: input.hint ?? '',
      stacks: input.stacks,
      component_titles: input.componentTitles,
    });
    return {
      title: typeof json.title === 'string' ? json.title : '',
      description: typeof json.description === 'string' ? json.description : '',
      basedOn: Array.isArray(json.based_on)
        ? json.based_on.map((v) => String(v))
        : [],
    };
  }

  /** Ask the AI Mentor a study question. */
  async askMentor(input: {
    tenantId: string;
    studentId: string;
    question: string;
  }): Promise<MentorAnswer> {
    const json = await this.postJson('/v1/mentor/ask', {
      tenant_id: input.tenantId,
      student_id: input.studentId,
      question: input.question,
    });
    return {
      topic: typeof json.topic === 'string' ? json.topic : 'General',
      answer: typeof json.answer === 'string' ? json.answer : '',
      nextSteps: Array.isArray(json.next_steps)
        ? json.next_steps.map((v) => String(v))
        : [],
      suggestedQuestion:
        typeof json.suggested_question === 'string' ? json.suggested_question : '',
    };
  }

  /** Score a mock-interview transcript (grammar, vocabulary, fillers, tech). */
  async evaluateSpeech(input: {
    tenantId: string;
    studentId: string;
    promptId: string;
    transcript: string;
    expectedTerms: string[];
  }): Promise<SpeechReport> {
    const json = await this.postJson('/v1/speech/evaluate', {
      tenant_id: input.tenantId,
      student_id: input.studentId,
      prompt_id: input.promptId,
      transcript: input.transcript,
      expected_terms: input.expectedTerms,
    });
    const breakdown = (json.breakdown ?? {}) as Record<string, unknown>;
    return {
      communicationScore: clampScore(json.communication_score),
      grammar: clampScore(breakdown.grammar),
      vocabulary: clampScore(breakdown.vocabulary),
      fillerWords: clampScore(breakdown.filler_words),
      technicalAccuracy: clampScore(breakdown.technical_accuracy),
    };
  }

  /** Compare a cohort's submissions for similarity (batch-scope anti-cheat). */
  async compareSubmissions(input: {
    tenantId: string;
    exerciseId: string;
    submissions: Array<{ studentId: string; code: string }>;
    threshold?: number;
  }): Promise<PlagiarismReport[]> {
    const json = await this.postJson('/v1/plagiarism/score', {
      tenant_id: input.tenantId,
      exercise_id: input.exerciseId,
      submissions: input.submissions.map((s) => ({
        student_id: s.studentId,
        code: s.code,
      })),
      ...(input.threshold != null ? { threshold: input.threshold } : {}),
    });
    const results = Array.isArray(json.results) ? json.results : [];
    return results.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const matches = Array.isArray(r.matches) ? r.matches : [];
      return {
        studentId: String(r.student_id ?? ''),
        maxSimilarity: clampRatio(r.max_similarity),
        flagged: r.flagged === true,
        matches: matches.map((m) => {
          const match = (m ?? {}) as Record<string, unknown>;
          return {
            studentId: String(match.student_id ?? ''),
            similarity: clampRatio(match.similarity),
          };
        }),
      };
    });
  }

  /** POST a JSON body and parse the JSON response, mapping errors uniformly. */
  private async postJson(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'request failed';
      throw new AiBridgeError(`AI plane unreachable: ${reason}`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AiBridgeError(`AI plane rejected the request (${res.status})`, res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Clamp a similarity ratio to [0, 1] and round to four decimals. */
function clampRatio(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
}

function normaliseIssues(value: unknown): QualityIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      code: String(i.code ?? ''),
      message: String(i.message ?? ''),
      line: typeof i.line === 'number' ? i.line : null,
    };
  });
}
