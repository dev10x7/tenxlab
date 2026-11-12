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
 * run": each entry is a template a student can actually start from, and the set
 * is small enough to keep the picker useful. `pistonRuntime` matches Piston's
 * runtime alias; `cmLanguage` matches a CodeMirror 6 language package.
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
