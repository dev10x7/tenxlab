import type { MentorMessageRecord, MentorMessageRepository } from '../common/ports';
import type { MentorAssistant } from '../ai/ai-bridge.client';

/** One turn in the mentor conversation, as the web client renders it. */
export interface MentorTurn {
  id: string;
  role: 'user' | 'mentor';
  content: string;
  topic: string | null;
  createdAt: string;
}

export interface MentorReply {
  /** The mentor's answer turn, ready to append to the transcript. */
  reply: MentorTurn;
  /** Concrete next steps the student can act on. */
  nextSteps: string[];
  suggestedQuestion: string;
}

/** Max length of a student question, so the log cannot grow unbounded. */
export const MENTOR_QUESTION_MAX = 1000;

export interface MentorDeps {
  messages: MentorMessageRepository;
  /** Null when the AI plane is not configured; the surface then answers offline. */
  assistant: MentorAssistant | null;
}

/**
 * The AI Mentor surface (parity §2.5): a study coach the student can ask about
 * a topic. The answer comes from the AI plane's deterministic knowledge base;
 * both the question and the answer are logged so the conversation survives a
 * reload. When the AI plane is unavailable the service degrades to a fixed
 * offline hint rather than failing, so the surface is never dead.
 */
export class MentorService {
  constructor(private readonly deps: MentorDeps) {}

  /** The caller's conversation, oldest first. */
  async history(userId: string): Promise<MentorTurn[]> {
    const rows = await this.deps.messages.listByUser(userId);
    return rows.map(toTurn);
  }

  /** Clear the caller's conversation. */
  async clear(userId: string): Promise<void> {
    await this.deps.messages.clearByUser(userId);
  }

  /**
   * Ask the mentor a question. The question is logged, the AI plane answers,
   * and the answer is logged too — so a reload replays the full exchange.
   */
  async ask(
    userId: string,
    tenantId: string,
    question: string,
  ): Promise<{ ok: true; result: MentorReply } | { ok: false; reason: 'empty' | 'too_long' }> {
    const trimmed = question.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (trimmed.length > MENTOR_QUESTION_MAX) return { ok: false, reason: 'too_long' };

    await this.deps.messages.create({
      tenantId,
      userId,
      role: 'user',
      content: trimmed,
      topic: null,
    });

    const answer = await this.answer(userId, tenantId, trimmed);

    const row = await this.deps.messages.create({
      tenantId,
      userId,
      role: 'mentor',
      content: answer.text,
      topic: answer.topic,
    });

    return {
      ok: true,
      result: {
        reply: toTurn(row),
        nextSteps: answer.nextSteps,
        suggestedQuestion: answer.suggestedQuestion,
      },
    };
  }

  /** Produce the mentor's answer, degrading gracefully when the plane is down. */
  private async answer(
    userId: string,
    tenantId: string,
    question: string,
  ): Promise<{
    text: string;
    topic: string;
    nextSteps: string[];
    suggestedQuestion: string;
  }> {
    if (!this.deps.assistant) return OFFLINE_ANSWER;
    try {
      const answer = await this.deps.assistant.askMentor({
        tenantId,
        studentId: userId,
        question,
      });
      const steps = answer.nextSteps.length
        ? answer.nextSteps
        : OFFLINE_ANSWER.nextSteps;
      return {
        text: formatAnswer(answer.answer, steps),
        topic: answer.topic,
        nextSteps: steps,
        suggestedQuestion: answer.suggestedQuestion,
      };
    } catch {
      return OFFLINE_ANSWER;
    }
  }
}

/** Compose the mentor turn text: the answer plus its numbered next steps. */
export function formatAnswer(answer: string, nextSteps: string[]): string {
  const body = answer.trim();
  if (nextSteps.length === 0) return body;
  const steps = nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `${body}\n\nNext steps:\n${steps}`;
}

const OFFLINE_ANSWER = {
  text:
    'I could not reach the study assistant just now. Break your question into ' +
    'the smallest thing you can try in a lab, and read the error text closely.',
  topic: 'General',
  nextSteps: [
    'Name the one concept you are unsure about.',
    'Find the matching lesson and attempt its lab.',
    'Try again in a moment for a tailored answer.',
  ],
  suggestedQuestion: 'Which lesson are you working on?',
};

function toTurn(row: MentorMessageRecord): MentorTurn {
  return {
    id: row.id,
    role: row.role === 'mentor' ? 'mentor' : 'user',
    content: row.content,
    topic: row.topic ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
