import { z } from 'zod';

/**
 * Runtime tier for a lab. Determines which execution runtime the LabProvider
 * adapter routes the session to.
 */
export const RuntimeTier = z.enum([
  'tier_1_microvm',
  'tier_2_container',
  'tier_3_vcluster',
]);
export type RuntimeTier = z.infer<typeof RuntimeTier>;

/** Roles a membership can hold within a tenant. */
export const MembershipRole = z.enum([
  'student',
  'instructor',
  'college_admin',
  'recruiter',
  'platform_admin',
]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/**
 * Launch JWT payload. Signed RS256 by the LMS, verified by KubeLab and the AI
 * plane via the LMS JWKS endpoint (no shared secret).
 */
export const LabLaunchJwtPayload = z.object({
  iss: z.literal('tenxlms'),
  sub: z.string().min(1), // user id
  aud: z.string().min(1).default('kubelab'),
  tenant_id: z.string().min(1),
  membership_role: MembershipRole,
  batch_id: z.string().min(1).optional(),
  course_id: z.string().min(1).optional(),
  exercise_id: z.string().min(1),
  runtime_tier: RuntimeTier,
  session_id: z.string().min(1),
  callback_url: z.string().url(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});
export type LabLaunchJwtPayload = z.infer<typeof LabLaunchJwtPayload>;

/**
 * Editor languages.
 *
 * A curated list, not Piston's full inventory: each entry carries the display
 * name, the Piston runtime alias, the CodeMirror language id, a starter
 * template, and a sensible stdin placeholder. Keeping it curated means the
 * picker shows exactly what the tier-1 pool is known to serve.
 */
export const EditorLanguage = z.object({
  /** Stable id used by the client and stored on a snippet, e.g. `python`. */
  id: z.string().min(1),
  /** Human label, e.g. `Python 3`. */
  label: z.string().min(1),
  /** Piston runtime alias, e.g. `python`. */
  pistonRuntime: z.string().min(1),
  /** CodeMirror 6 language id, e.g. `python`. */
  cmLanguage: z.string().min(1),
  /** Editor file extension, e.g. `.py`. */
  extension: z.string().min(1),
  /** Starter code shown when the editor is empty. */
  template: z.string(),
  /** Placeholder describing the STDIN the template reads. */
  stdinHint: z.string().default(''),
});
export type EditorLanguage = z.infer<typeof EditorLanguage>;

/**
 * The languages the Editor offers. Curated rather than "everything Piston can
 * run": each entry is a template a student can actually start from. Every entry
 * must be runnable by the tier-1 Piston pool — `pistonRuntime` matches Piston's
 * runtime alias — so the Run button never fails for a listed language. ByteXL's
 * editor advertises 70+; we grow this list as the pool's installs grow.
 */
export const EDITOR_LANGUAGES: EditorLanguage[] = [
  {
    id: 'python',
    label: 'Python 3',
    pistonRuntime: 'python',
    cmLanguage: 'python',
    extension: '.py',
    template: [
      'import sys',
      '',
      'def main() -> None:',
      '    data = sys.stdin.read().strip()',
      '    # start your solution',
      '    print(data)',
      '    # end your solution',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'javascript',
    label: 'JavaScript (Node)',
    pistonRuntime: 'javascript',
    cmLanguage: 'javascript',
    extension: '.js',
    template: [
      'const fs = require("fs");',
      '',
      'const input = fs.readFileSync(0, "utf8").trim();',
      '// start your solution',
      'console.log(input);',
      '// end your solution',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'java',
    label: 'Java',
    pistonRuntime: 'java',
    cmLanguage: 'java',
    extension: '.java',
    template: [
      'import java.util.Scanner;',
      '',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner in = new Scanner(System.in);',
      '        String data = in.hasNextLine() ? in.nextLine() : "";',
      '        // start your solution',
      '        System.out.println(data);',
      '        // end your solution',
      '    }',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'c',
    label: 'C (GCC)',
    pistonRuntime: 'c',
    cmLanguage: 'c',
    extension: '.c',
    template: [
      '#include <stdio.h>',
      '',
      'int main(void) {',
      '    char buf[1024];',
      '    if (!fgets(buf, sizeof buf, stdin)) return 0;',
      '    // start your solution',
      '    fputs(buf, stdout);',
      '    // end your solution',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'cpp',
    label: 'C++ (GCC)',
    pistonRuntime: 'c++',
    cmLanguage: 'cpp',
    extension: '.cpp',
    template: [
      '#include <iostream>',
      '#include <string>',
      '',
      'int main() {',
      '    std::string data;',
      '    std::getline(std::cin, data);',
      '    // start your solution',
      '    std::cout << data << std::endl;',
      '    // end your solution',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'sql',
    label: 'SQL (SQLite)',
    pistonRuntime: 'sqlite3',
    cmLanguage: 'sql',
    extension: '.sql',
    template: [
      '-- start your solution',
      'SELECT 1 AS answer;',
      '-- end your solution',
      '',
    ].join('\n'),
    stdinHint: 'SQL runs against a scratch SQLite database; stdin is unused.',
  },
  {
    id: 'csharp',
    label: 'C# (.NET)',
    pistonRuntime: 'csharp',
    cmLanguage: 'csharp',
    extension: '.cs',
    template: [
      'using System;',
      '',
      'class Program {',
      '    static void Main() {',
      '        string data = Console.ReadLine() ?? "";',
      '        // start your solution',
      '        Console.WriteLine(data);',
      '        // end your solution',
      '    }',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'go',
    label: 'Go',
    pistonRuntime: 'go',
    cmLanguage: 'go',
    extension: '.go',
    template: [
      'package main',
      '',
      'import (',
      '\t"bufio"',
      '\t"fmt"',
      '\t"os"',
      ')',
      '',
      'func main() {',
      '\tscanner := bufio.NewScanner(os.Stdin)',
      '\tline := ""',
      '\tif scanner.Scan() {',
      '\t\tline = scanner.Text()',
      '\t}',
      '\t// start your solution',
      '\tfmt.Println(line)',
      '\t// end your solution',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'rust',
    label: 'Rust',
    pistonRuntime: 'rust',
    cmLanguage: 'rust',
    extension: '.rs',
    template: [
      'use std::io::{self, BufRead};',
      '',
      'fn main() {',
      '    let line = io::stdin().lock().lines().next()',
      '        .and_then(|l| l.ok())',
      '        .unwrap_or_default();',
      '    // start your solution',
      '    println!("{}", line);',
      '    // end your solution',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'php',
    label: 'PHP',
    pistonRuntime: 'php',
    cmLanguage: 'php',
    extension: '.php',
    template: [
      '<?php',
      '$data = rtrim(fgets(STDIN));',
      '// start your solution',
      'echo $data . "\\n";',
      '// end your solution',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'ruby',
    label: 'Ruby',
    pistonRuntime: 'ruby',
    cmLanguage: 'ruby',
    extension: '.rb',
    template: [
      'data = $stdin.gets&.chomp || ""',
      '# start your solution',
      'puts data',
      '# end your solution',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    pistonRuntime: 'kotlin',
    cmLanguage: 'kotlin',
    extension: '.kt',
    template: [
      'fun main() {',
      '    val data = readLine() ?: ""',
      '    // start your solution',
      '    println(data)',
      '    // end your solution',
      '}',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
  {
    id: 'bash',
    label: 'Bash',
    pistonRuntime: 'bash',
    cmLanguage: 'bash',
    extension: '.sh',
    template: [
      'read -r data',
      '# start your solution',
      'echo "$data"',
      '# end your solution',
      '',
    ].join('\n'),
    stdinHint: 'One line of text, read from standard input.',
  },
];

/** Look up a language by its stable id. */
export function editorLanguage(id: string): EditorLanguage | undefined {
  return EDITOR_LANGUAGES.find((l) => l.id === id);
}

/** A code-run request against the tier-1 execution pool. */
export const CodeRunRequest = z.object({
  language: z.string().min(1),
  source: z.string().max(100_000),
  stdin: z.string().max(100_000).default(''),
});
export type CodeRunRequest = z.infer<typeof CodeRunRequest>;

/** Outcome of a code run. Mirrors Piston's fields, normalised. */
export const CodeRunResult = z.object({
  stdout: z.string(),
  stderr: z.string(),
  /** Process exit status; `null` when the run was killed (timeout/signal). */
  exitCode: z.number().int().nullable(),
  /** Wall-clock execution time in milliseconds. */
  executionTimeMs: z.number().int().nonnegative(),
  /** True when the run was killed for exceeding the time limit. */
  timedOut: z.boolean(),
  /** True when the language/runtime was unknown to the pool. */
  unsupported: z.boolean(),
});
export type CodeRunResult = z.infer<typeof CodeRunResult>;

/** Completion webhook: KubeLab -> LMS, on exercise_sessions update. */
export const ExerciseStatus = z.enum(['PASSED', 'FAILED', 'ERROR']);
export type ExerciseStatus = z.infer<typeof ExerciseStatus>;

export const CompletionWebhook = z.object({
  event: z.literal('exercise.completed'),
  event_id: z.string().min(1),
  student_id: z.string().min(1),
  tenant_id: z.string().min(1),
  batch_id: z.string().min(1).optional(),
  exercise_id: z.string().min(1),
  session_id: z.string().min(1),
  status: ExerciseStatus,
  score: z.number().min(0).max(100),
  execution_time_ms: z.number().int().nonnegative(),
  attempt_count: z.number().int().positive(),
  code_snapshot_url: z.string().min(1).optional(),
  timestamp: z.string().datetime(),
});
export type CompletionWebhook = z.infer<typeof CompletionWebhook>;

/** HMAC signature header for all inbound webhooks. */
export const SIGNATURE_HEADER = 'x-tenxlab-signature-256';

/** AI plane webhook events. */
export const AiWebhook = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('plagiarism.scored'),
    event_id: z.string().min(1),
    tenant_id: z.string().min(1),
    exercise_id: z.string().min(1),
    subject_student_id: z.string().min(1),
    max_similarity: z.number().min(0).max(1),
    matches: z
      .array(
        z.object({
          student_id: z.string().min(1),
          similarity: z.number().min(0).max(1),
          diff_url: z.string().url().optional(),
        }),
      )
      .default([]),
    flagged: z.boolean(),
  }),
  z.object({
    event: z.literal('quality.scored'),
    event_id: z.string().min(1),
    tenant_id: z.string().min(1),
    project_id: z.string().min(1),
    student_id: z.string().min(1),
    score: z.number().min(0).max(100),
    issues: z.number().int().nonnegative(),
  }),
  z.object({
    event: z.literal('speech.evaluated'),
    event_id: z.string().min(1),
    tenant_id: z.string().min(1),
    student_id: z.string().min(1),
    prompt_id: z.string().min(1),
    communication_score: z.number().min(0).max(100),
    breakdown: z.object({
      grammar: z.number().min(0).max(100),
      vocabulary: z.number().min(0).max(100),
      filler_words: z.number().min(0).max(100),
      technical_accuracy: z.number().min(0).max(100),
    }),
  }),
]);
export type AiWebhook = z.infer<typeof AiWebhook>;

/** Partner SSO (college -> TenXLab), HS256 signed-token redirect. */
export const PartnerSsoClaims = z.object({
  sub: z.string().email(),
  partnerId: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type PartnerSsoClaims = z.infer<typeof PartnerSsoClaims>;

export const PartnerSsoError = z.enum([
  'invalid_signature',
  'token_expired',
  'replay_detected',
  'unknown_partner',
  'user_not_found',
]);
export type PartnerSsoError = z.infer<typeof PartnerSsoError>;

/** Provisioning spec passed to a LabProvider adapter. */
export const LabSpec = z.object({
  exercise_id: z.string().min(1),
  runtime_tier: RuntimeTier,
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  image: z.string().optional(),
  resource_limits: z
    .object({
      cpu: z.string(),
      memory: z.string(),
    })
    .optional(),
  ttl_seconds: z.number().int().positive().default(1800),
  network_policy: z.enum(['allowlist', 'deny_all', 'open']).default('allowlist'),
});
export type LabSpec = z.infer<typeof LabSpec>;

export const SessionStatus = z.enum(['WARM', 'ACTIVE', 'IDLE', 'TERMINATED']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionHandle = z.object({
  session_id: z.string().min(1),
  status: SessionStatus,
  tier: RuntimeTier,
  ide_url: z.string().url().optional(),
  provider_ref: z.string().optional(),
  started_at: z.string().datetime(),
  last_activity_at: z.string().datetime(),
  ttl_seconds: z.number().int().positive(),
});
export type SessionHandle = z.infer<typeof SessionHandle>;

// ---------------------------------------------------------------- Assessment

/** How an assessment is presented and whether it is graded. */
export const AssessmentMode = z.enum(['practice', 'graded']);
export type AssessmentMode = z.infer<typeof AssessmentMode>;

/** The four question kinds the LMS grades. */
export const QuestionKind = z.enum(['coding', 'mcq', 'fill', 'descriptive']);
export type QuestionKind = z.infer<typeof QuestionKind>;

/** A single question as shown to a student (no answer key). */
export const AssessmentQuestion = z.object({
  id: z.string().min(1),
  kind: QuestionKind,
  prompt: z.string(),
  maxScore: z.number().int().positive(),
  /** Coding only: the stub the student starts from. */
  stubCode: z.string().optional(),
  /** Coding only: whether the stub carries a read-only solution region. */
  hasSolutionRegion: z.boolean().default(false),
  /** Choice/fill only: the options to render. */
  options: z.array(z.string()).optional(),
  /** Fill only: whether more than one option may be selected. */
  multiple: z.boolean().optional(),
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestion>;

/** An assessment as shown to a student, with the attempt window when started. */
export const AssessmentView = z.object({
  id: z.string().min(1),
  courseSlug: z.string().min(1),
  title: z.string(),
  mode: AssessmentMode,
  /** Proctoring is only enforced for graded assessments. */
  proctored: z.boolean().default(false),
  durationSeconds: z.number().int().positive().nullable().default(null),
  maxScore: z.number().int().positive(),
  questions: z.array(AssessmentQuestion),
});
export type AssessmentView = z.infer<typeof AssessmentView>;

/** A student's answers, keyed by question id. Values are JSON-safe. */
export const AssessmentAnswers = z.record(z.unknown());
export type AssessmentAnswers = z.infer<typeof AssessmentAnswers>;

export const AttemptStatus = z.enum(['in_progress', 'submitted', 'expired']);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

/** A live attempt: the assessment plus the server-authoritative clock. */
export const AttemptView = z.object({
  id: z.string().min(1),
  assessmentId: z.string().min(1),
  status: AttemptStatus,
  startedAt: z.string().datetime(),
  /** Server-computed deadline; null for untimed practice. */
  endsAt: z.string().datetime().nullable(),
  remainingSeconds: z.number().int().nonnegative().nullable(),
  assessment: AssessmentView,
});
export type AttemptView = z.infer<typeof AttemptView>;

/** Per-question result returned after a submission is graded. */
export const QuestionResult = z.object({
  questionId: z.string().min(1),
  score: z.number().nonnegative(),
  maxScore: z.number().positive(),
  correct: z.boolean(),
  feedback: z.string(),
});
export type QuestionResult = z.infer<typeof QuestionResult>;

/** The outcome of a graded submission. */
export const AttemptResult = z.object({
  attemptId: z.string().min(1),
  status: AttemptStatus,
  score: z.number().nonnegative(),
  maxScore: z.number().positive(),
  results: z.array(QuestionResult),
});
export type AttemptResult = z.infer<typeof AttemptResult>;

/**
 * Proctoring events a student's browser reports. These are client-reported
 * signals, aggregated into a risk score — never treated as proof of cheating.
 */
export const ProctorEventType = z.enum([
  'focus_lost',
  'focus_gained',
  'copy',
  'paste',
  'fullscreen_exit',
  'display_count',
  'vm_detected',
  'network_lost',
]);
export type ProctorEventType = z.infer<typeof ProctorEventType>;

export const ProctorEventInput = z.object({
  type: ProctorEventType,
  /** Optional client detail, e.g. the display count. */
  detail: z.string().max(200).optional(),
});
export type ProctorEventInput = z.infer<typeof ProctorEventInput>;

/** Aggregated integrity view for one attempt, for the instructor. */
export const ProctorSummary = z.object({
  attemptId: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
  riskScore: z.number().int().nonnegative(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  counts: z.record(z.number().int().nonnegative()),
});
export type ProctorSummary = z.infer<typeof ProctorSummary>;

// ---------------------------------------------------------------- Projects
// ByteXL "Nimbus" equivalent: a student forks a project's template into a
// durable cloud workspace, builds in an online VS Code, and submits the
// workspace plus optional GitHub/demo links for trainer evaluation.

/** Two template shapes: a dependency-ready framework, or a bare base image. */
export const ProjectTemplateKind = z.enum(['framework', 'base_image']);
export type ProjectTemplateKind = z.infer<typeof ProjectTemplateKind>;

/** A template a workspace can be created from (e.g. React, Spring Boot, Debian). */
export const ProjectTemplate = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  description: z.string().default(''),
  kind: ProjectTemplateKind,
  /** Framework/language label, e.g. "react", "spring-boot", "debian". */
  stack: z.string().min(1),
  /** Container image the workspace runs. */
  image: z.string().min(1),
});
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

export const ProjectStatus = z.enum(['draft', 'published', 'closed']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/** An instructor-authored project that students fork, build, and submit. */
export const Project = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  title: z.string(),
  description: z.string().default(''),
  /** Tier a fork is provisioned at: tier-2 default, tier-3 opt-in (ADR-20). */
  runtimeTier: RuntimeTier,
  status: ProjectStatus,
  /** Submission deadline; the project auto-closes once it passes. */
  deadline: z.string().datetime().nullable().default(null),
  maxScore: z.number().int().positive(),
});
export type Project = z.infer<typeof Project>;

/**
 * One technology slot in a project. A project is a container of components —
 * ByteXL's "add individual workspaces to it" step (e.g. a React front end and a
 * Spring Boot backend are two components of one project). A student forks each
 * component into its own workspace and submits per component, so a multi-service
 * app is N independent workspaces wired by the student (§1.4), not one stack.
 */
export const ProjectComponent = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  /** Technology label shown to students, e.g. "react", "spring-boot". */
  technology: z.string().min(1),
  /** Catalog template the fork copies. Mutually exclusive with templateWorkspaceId. */
  templateSlug: z.string().nullable().default(null),
  /** An existing workspace used as the template (fork your own, §1.3). */
  templateWorkspaceId: z.string().nullable().default(null),
  /** Ordering within the project. */
  position: z.number().int().nonnegative(),
});
export type ProjectComponent = z.infer<typeof ProjectComponent>;

/**
 * Workspace lifecycle. `stopped` is the resting state: files persist on a
 * volume while no compute runs (stop-when-idle, ADR-20). `provisioning` is a
 * transient state while the provider boots the environment. `failed` is a
 * terminal provisioning error and is deliberately distinct from `stopped`,
 * which promises the files survived.
 */
export const WorkspaceStatus = z.enum([
  'provisioning',
  'running',
  'stopped',
  'failed',
  'archived',
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

/**
 * A student's durable workspace. Durable state (files on `storageRef`) is
 * separate from running compute, so a workspace can be stopped without losing
 * work.
 */
export const ProjectWorkspace = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  templateSlug: z.string().min(1),
  runtimeTier: RuntimeTier,
  status: WorkspaceStatus,
  /** IDE URL while running; null while stopped. */
  ideUrl: z.string().nullable().default(null),
  /**
   * Public URL the workspace's service is exposed on after a "Deploy" (E5),
   * analogous to ByteXL's `bytexl.live` demo links. Null until deployed.
   */
  deployUrl: z.string().nullable().default(null),
  /** The container port the deploy exposes. Null until deployed. */
  deployPort: z.number().int().positive().nullable().default(null),
  /** Volume/snapshot ref holding the durable files. */
  storageRef: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
});
export type ProjectWorkspace = z.infer<typeof ProjectWorkspace>;

/**
 * A student's fork of one project component into their own durable workspace.
 * A project with N components yields up to N forks per student, so a
 * multi-service app is several independent workspaces (§1.4).
 */
export const ProjectFork = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  componentId: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  /** The template the fork's workspace was copied from (catalog or workspace). */
  sourceTemplateSlug: z.string().nullable().default(null),
  /** Set when the fork copied an existing workspace rather than a template. */
  sourceWorkspaceId: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type ProjectFork = z.infer<typeof ProjectFork>;

export const SubmissionStatus = z.enum(['submitted', 'evaluated']);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/** The artifacts a student submits, plus the trainer's evaluation. */
export const ProjectSubmission = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  componentId: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  /** Optional link to the student's published GitHub repo. */
  githubUrl: z.string().url().nullable().default(null),
  /** Optional link to a hosted demo. */
  demoUrl: z.string().url().nullable().default(null),
  status: SubmissionStatus,
  score: z.number().nonnegative().nullable().default(null),
  feedback: z.string().nullable().default(null),
  submittedAt: z.string().datetime(),
  evaluatedAt: z.string().datetime().nullable().default(null),
});
export type ProjectSubmission = z.infer<typeof ProjectSubmission>;

/** The body a student posts to submit a project. */
export const ProjectSubmissionInput = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  githubUrl: z.string().url().nullable().default(null),
  demoUrl: z.string().url().nullable().default(null),
});
export type ProjectSubmissionInput = z.infer<typeof ProjectSubmissionInput>;
