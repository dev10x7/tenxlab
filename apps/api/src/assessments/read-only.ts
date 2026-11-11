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

export type ReadOnlyViolationReason =
  | 'modified'
  | 'deleted'
  | 'no_markers'
  | 'multiple_regions'
  | 'unbalanced'
  | 'prefix_mismatch'
  | 'readonly_before_modified'
  | 'readonly_after_modified'
  | 'marker_style_changed';

export interface ReadOnlyViolation {
  path: string;
  reason: ReadOnlyViolationReason;
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

/**
 * Marker-region enforcement (ByteXL semantics).
 *
 * ByteXL marks the one editable region of a stub with `start your solution` /
 * `end your solution` comments; everything outside is read-only. Only one
 * editable region per file is supported. The comment style depends on the
 * language: `#` (Python, shell), `//` (Java, C, C++, JS), `--` (SQL).
 *
 * We keep this separate from the whole-file `checkReadOnly` above: whole-file
 * hashing is right for a file that must not change at all, while regions are
 * right for a stub where only the marked block is the student's to edit.
 */

const MARKER_LINE =
  /^[ \t]*(?<prefix>#|\/\/|--)[ \t]*start your solution[ \t]*$/;
const END_MARKER_LINE =
  /^[ \t]*(?<prefix>#|\/\/|--)[ \t]*end your solution[ \t]*$/;

export interface SolutionRegion {
  /** The `#`, `//` or `--` comment prefix used by the markers. */
  prefix: string;
  /** Character offset of the start marker line (inclusive). */
  start: number;
  /** Character offset just past the end marker line. */
  end: number;
  /** Text strictly between the two marker lines (the editable region). */
  body: string;
}

export type RegionParse =
  | { ok: true; region: SolutionRegion }
  | { ok: false; reason: ReadOnlyViolationReason };

/**
 * Parse the single editable region from a stub. Returns the region, or the
 * reason it is invalid: `no_markers`, `unbalanced`, `multiple_regions`,
 * `prefix_mismatch`, or `marker_style_changed`.
 */
export function parseSolutionRegion(content: string): RegionParse {
  const lines = content.split('\n');
  const starts: number[] = [];
  const ends: number[] = [];
  const styles = new Set<string>();

  let offset = 0;
  const lineStarts: number[] = [];
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // account for the '\n' we split on
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const s = MARKER_LINE.exec(line);
    if (s) {
      starts.push(i);
      styles.add(s.groups?.prefix ?? '');
      continue;
    }
    const e = END_MARKER_LINE.exec(line);
    if (e) {
      ends.push(i);
      styles.add(e.groups?.prefix ?? '');
    }
  }

  if (starts.length === 0 || ends.length === 0) {
    return { ok: false, reason: 'no_markers' };
  }
  if (starts.length > 1 || ends.length > 1) {
    return { ok: false, reason: 'multiple_regions' };
  }
  const startLine = starts[0]!;
  const endLine = ends[0]!;
  if (startLine >= endLine) {
    return { ok: false, reason: 'unbalanced' };
  }
  if (styles.size > 1) {
    return { ok: false, reason: 'prefix_mismatch' };
  }
  const prefix = [...styles][0]!;

  const start = lineStarts[startLine]!;
  // Region spans the start marker line through the end marker line (exclusive
  // of its trailing newline), so prefix/suffix comparisons land on line edges.
  const end = lineStarts[endLine]! + lines[endLine]!.length;
  const body = lines.slice(startLine + 1, endLine).join('\n');

  return { ok: true, region: { prefix, start, end, body } };
}

/**
 * Enforce that a submitted stub only changed the editable region.
 *
 * Splits both the reference (published stub) and the submission at their
 * marker boundaries and requires the read-only prefix and suffix to be
 * byte-identical. The editable body may change freely.
 *
 * Returns `null` when the submission is valid, or a violation otherwise.
 */
export function checkSolutionRegion(
  path: string,
  reference: string,
  submitted: string,
): ReadOnlyViolation | null {
  const ref = parseSolutionRegion(reference);
  const sub = parseSolutionRegion(submitted);

  if (!ref.ok) {
    // A malformed reference is an authoring error, surfaced under the same
    // reason so the caller can flag the exercise rather than the student.
    return { path, reason: ref.reason };
  }
  if (!sub.ok) {
    return { path, reason: sub.reason };
  }
  if (sub.region.prefix !== ref.region.prefix) {
    return { path, reason: 'marker_style_changed' };
  }

  const refBefore = reference.slice(0, ref.region.start);
  const refAfter = reference.slice(ref.region.end);
  const subBefore = submitted.slice(0, sub.region.start);
  const subAfter = submitted.slice(sub.region.end);

  if (subBefore !== refBefore) {
    return { path, reason: 'readonly_before_modified' };
  }
  if (subAfter !== refAfter) {
    return { path, reason: 'readonly_after_modified' };
  }
  return null;
}

export interface StubReference {
  path: string;
  content: string;
}

/**
 * Check a set of submitted files against published stubs. A stub with markers
 * is region-enforced; a file without markers in the reference is treated as
 * fully read-only (whole-file hash). Returns every violation found.
 */
export function checkSubmissionRegions(
  references: StubReference[],
  submitted: MarkerFile[],
): ReadOnlyViolation[] {
  const byPath = new Map(submitted.map((f) => [f.path, f]));
  const violations: ReadOnlyViolation[] = [];

  for (const ref of references) {
    const file = byPath.get(ref.path);
    if (!file) {
      violations.push({ path: ref.path, reason: 'deleted' });
      continue;
    }
    const hasMarkers = parseSolutionRegion(ref.content).ok;
    if (hasMarkers) {
      const violation = checkSolutionRegion(ref.path, ref.content, file.content);
      if (violation) violations.push(violation);
    } else if (sha256(file.content) !== sha256(ref.content)) {
      violations.push({ path: ref.path, reason: 'modified' });
    }
  }
  return violations;
}
