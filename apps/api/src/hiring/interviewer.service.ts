import type {
  InterviewAttemptRecord,
  InterviewAttemptRepository,
} from '../common/ports';
import type { SpeechEvaluator } from '../ai/ai-bridge.client';
import { findInterviewPrompt, INTERVIEW_PROMPTS, type InterviewPrompt } from './interview-prompts';
import type { PassportService } from './passport.service';

/** A mock-interview sitting, as the web client renders it. */
export interface InterviewAttemptView {
  id: string;
  promptId: string;
  promptTitle: string;
  transcript: string;
  communicationScore: number;
  grammar: number;
  vocabulary: number;
  fillerWords: number;
  technicalAccuracy: number;
  createdAt: string;
}

/** Max transcript length, so one answer cannot store an unbounded blob. */
export const INTERVIEW_TRANSCRIPT_MAX = 8000;

export interface InterviewerDeps {
  interviews: InterviewAttemptRepository;
  /** Null when the AI plane is not configured; scoring then degrades offline. */
  evaluator: SpeechEvaluator | null;
  /** Refreshes the student's Skill Passport after a scored sitting. */
  passports: PassportService;
}

/**
 * The AI Interviewer surface (parity §2.6): a student answers a prompt out loud,
 * the transcript is scored for communication, and the score is written back onto
 * their Skill Passport — so a recruiter sees it alongside the lab evidence.
 *
 * When the AI plane is unavailable the service scores the transcript with a
 * small local heuristic, so the surface still works and the passport still
 * updates; the local score is deterministic and offline, mirroring the plane's
 * own rules at a coarser grain.
 */
export class InterviewerService {
  constructor(private readonly deps: InterviewerDeps) {}

  /** The prompt bank, for the student to pick from. */
  prompts(): InterviewPrompt[] {
    return INTERVIEW_PROMPTS;
  }

  /** The caller's sittings, newest first. */
  async history(userId: string): Promise<InterviewAttemptView[]> {
    const rows = await this.deps.interviews.listByUser(userId);
    return rows.map(toView);
  }

  /**
   * Score one answer and persist the sitting. The student's passport is
   * refreshed so their communication score reflects the latest sitting.
   */
  async submit(
    userId: string,
    tenantId: string,
    promptId: string,
    transcript: string,
  ): Promise<
    | { ok: true; attempt: InterviewAttemptView }
    | { ok: false; reason: 'unknown_prompt' | 'empty' | 'too_long' }
  > {
    const prompt = findInterviewPrompt(promptId);
    if (!prompt) return { ok: false, reason: 'unknown_prompt' };

    const text = transcript.trim();
    if (!text) return { ok: false, reason: 'empty' };
    if (text.length > INTERVIEW_TRANSCRIPT_MAX) return { ok: false, reason: 'too_long' };

    const score = await this.score(userId, tenantId, prompt, text);
    const row = await this.deps.interviews.create({
      tenantId,
      userId,
      promptId: prompt.id,
      promptTitle: prompt.title,
      transcript: text,
      communicationScore: score.communicationScore,
      grammar: score.grammar,
      vocabulary: score.vocabulary,
      fillerWords: score.fillerWords,
      technicalAccuracy: score.technicalAccuracy,
    });

    // The passport reads the latest sitting, so this keeps it current.
    await this.deps.passports.refresh(userId, tenantId);
    return { ok: true, attempt: toView(row) };
  }

  private async score(
    userId: string,
    tenantId: string,
    prompt: InterviewPrompt,
    transcript: string,
  ): Promise<{
    communicationScore: number;
    grammar: number;
    vocabulary: number;
    fillerWords: number;
    technicalAccuracy: number;
  }> {
    if (this.deps.evaluator) {
      try {
        return await this.deps.evaluator.evaluateSpeech({
          tenantId,
          studentId: userId,
          promptId: prompt.id,
          transcript,
          expectedTerms: prompt.expectedTerms,
        });
      } catch {
        // fall through to the local heuristic
      }
    }
    return localSpeechScore(transcript, prompt.expectedTerms);
  }
}

const FILLERS = ['um', 'uh', 'erm', 'like', 'basically', 'actually', 'literally'];

/**
 * A coarse, deterministic speech score used when the AI plane is unavailable.
 * It mirrors `speech.py`'s shape (grammar / vocabulary / fillers / tech) at a
 * lower fidelity so the surface and the passport still update offline.
 */
export function localSpeechScore(
  transcript: string,
  expectedTerms: string[],
): {
  communicationScore: number;
  grammar: number;
  vocabulary: number;
  fillerWords: number;
  technicalAccuracy: number;
} {
  const lowered = transcript.toLowerCase();
  const words = lowered.match(/[a-z']+/g) ?? [];
  const n = Math.max(words.length, 1);

  const fillerHits = FILLERS.reduce(
    (sum, f) => sum + (lowered.match(new RegExp(`\\b${f}\\b`, 'g'))?.length ?? 0),
    0,
  );
  const fillerWords = clamp(100 - Math.round((fillerHits / n) * 100) * 3);

  const distinct = new Set(words).size;
  const vocabulary = clamp(Math.round(60 + 40 * (distinct / n)));

  const sentences = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  let grammar = 100;
  const avgLen = words.length / Math.max(sentences.length, 1);
  if (avgLen > 40) grammar -= 20;
  if (transcript && transcript[0] !== transcript[0]!.toUpperCase()) grammar -= 10;
  if (sentences.length === 0) grammar = 40;
  grammar = clamp(grammar);

  const matched = expectedTerms.filter((t) => lowered.includes(t.toLowerCase()));
  const technicalAccuracy = expectedTerms.length
    ? clamp(Math.round((matched.length / expectedTerms.length) * 100))
    : 0;

  const communicationScore = clamp(
    Math.round(
      0.3 * grammar + 0.2 * vocabulary + 0.2 * fillerWords + 0.3 * technicalAccuracy,
    ),
  );

  return { communicationScore, grammar, vocabulary, fillerWords, technicalAccuracy };
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function toView(row: InterviewAttemptRecord): InterviewAttemptView {
  return {
    id: row.id,
    promptId: row.promptId,
    promptTitle: row.promptTitle,
    transcript: row.transcript,
    communicationScore: row.communicationScore,
    grammar: row.grammar,
    vocabulary: row.vocabulary,
    fillerWords: row.fillerWords,
    technicalAccuracy: row.technicalAccuracy,
    createdAt: row.createdAt.toISOString(),
  };
}
