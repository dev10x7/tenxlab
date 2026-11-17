/**
 * The AI Interviewer's prompt bank (parity §2.6). Each prompt is a role/topic
 * the student answers out loud; the transcript is scored by the AI plane's
 * `speech.py` against the prompt's expected terms. The bank is fixed so a
 * sitting is reproducible and the scoring is grounded.
 */
export interface InterviewPrompt {
  id: string;
  title: string;
  /** The question put to the student. */
  question: string;
  /** Key terms a strong answer should mention; drives the technical score. */
  expectedTerms: string[];
}

export const INTERVIEW_PROMPTS: InterviewPrompt[] = [
  {
    id: 'k8s-explain-pod',
    title: 'Explain a Kubernetes Pod',
    question:
      'Explain what a Kubernetes Pod is and how it differs from a container.',
    expectedTerms: ['pod', 'container', 'kubernetes', 'node', 'deployment'],
  },
  {
    id: 'k8s-troubleshoot-crashloop',
    title: 'Troubleshoot CrashLoopBackOff',
    question:
      'A Deployment is stuck in CrashLoopBackOff. Walk me through how you debug it.',
    expectedTerms: ['logs', 'pod', 'describe', 'deployment', 'kubernetes'],
  },
  {
    id: 'docker-image-layers',
    title: 'Docker image layers',
    question: 'How do Docker image layers work, and why does layer order matter?',
    expectedTerms: ['layer', 'docker', 'image', 'cache', 'build'],
  },
  {
    id: 'api-design-rest',
    title: 'Design a REST API',
    question:
      'Design a REST API for a task manager. Which endpoints and status codes would you use?',
    expectedTerms: ['rest', 'endpoint', 'http', 'get', 'post', 'resource'],
  },
  {
    id: 'db-indexing',
    title: 'Database indexing',
    question: 'Why add a database index, and what is the cost of doing so?',
    expectedTerms: ['index', 'query', 'database', 'write', 'performance'],
  },
  {
    id: 'behaviour-ownership',
    title: 'Behavioural: ownership',
    question:
      'Tell me about a time you took ownership of a problem end to end. What was the outcome?',
    expectedTerms: ['problem', 'action', 'result', 'learned', 'team'],
  },
];

export function findInterviewPrompt(id: string): InterviewPrompt | null {
  return INTERVIEW_PROMPTS.find((p) => p.id === id) ?? null;
}
