/**
 * Read-only marker enforcement for lab files.
 *
 * Instructors designate files that a student must not edit (for example, a
 * provided test harness). We track the expected content hash and reject a
 * submission whose marker files changed. Hashing the content — rather than
 * trusting a mutable flag — means tampering is detected even if the student
 * rewrites the file.
 */

import { createHash } from 'node:crypto';

export interface MarkerFile {
  path: string;
  content: string;
}

export interface MarkerManifest {
  /** path -> sha256 of the read-only content. */
  [path: string]: string;
}

export interface ReadOnlyViolation {
  path: string;
  reason: 'modified' | 'deleted';
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Build a manifest from the canonical read-only files at publish time. */
export function buildManifest(files: MarkerFile[]): MarkerManifest {
  const manifest: MarkerManifest = {};
  for (const f of files) manifest[f.path] = sha256(f.content);
  return manifest;
}

/**
 * Compare a submission's files against the manifest. Returns every violation;
 * an empty array means all read-only regions are intact.
 */
export function checkReadOnly(
  manifest: MarkerManifest,
  submitted: MarkerFile[],
): ReadOnlyViolation[] {
  const byPath = new Map(submitted.map((f) => [f.path, f]));
  const violations: ReadOnlyViolation[] = [];
  for (const [path, expected] of Object.entries(manifest)) {
    const file = byPath.get(path);
    if (!file) {
      violations.push({ path, reason: 'deleted' });
      continue;
    }
    if (sha256(file.content) !== expected) {
      violations.push({ path, reason: 'modified' });
    }
  }
  return violations;
}
