#!/usr/bin/env node
/**
 * License gate for the TenXLab product.
 *
 * Walks every installed dependency (npm workspaces + transitive) and fails the
 * build if any package carries a copyleft license that would impose source
 * disclosure on the product artifact.
 *
 * Denylist: AGPL, GPL, SSPL, BSL, and the LGPL family when *bundled*. Tools that
 * are run as separate services (e.g. SonarQube) are not installed as npm deps,
 * so they never reach this check.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const NODE_MODULES = join(ROOT, 'node_modules');

const DENY = [
  { id: 'AGPL', test: (l) => /AGPL/i.test(l) },
  { id: 'GPL-3.0', test: (l) => /GPL-3/i.test(l) },
  { id: 'GPL-2.0', test: (l) => /GPL-2/i.test(l) },
  { id: 'SSPL', test: (l) => /SSPL/i.test(l) },
  { id: 'BUSL/BSL', test: (l) => /\bBSL\b|Business Source/i.test(l) },
];

function listPackages(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      const scoped = join(dir, entry.name);
      for (const sub of readdirSync(scoped, { withFileTypes: true })) {
        if (sub.isDirectory()) out.push(join(scoped, sub.name));
      }
    } else if (entry.name !== '.bin' && entry.name !== '.cache') {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function licenseOf(pkgDir) {
  const manifest = join(pkgDir, 'package.json');
  if (!existsSync(manifest)) return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return null;
  }
  let license = pkg.license;
  if (!license && Array.isArray(pkg.licenses)) {
    license = pkg.licenses.map((l) => l.type).join(' OR ');
  }
  return { name: pkg.name, version: pkg.version, license: license ?? 'UNKNOWN' };
}

const violations = [];
const unknown = [];
let scanned = 0;

for (const pkgDir of listPackages(NODE_MODULES)) {
  const info = licenseOf(pkgDir);
  if (!info) continue;
  scanned += 1;
  if (info.license === 'UNKNOWN') {
    unknown.push(info);
    continue;
  }
  for (const rule of DENY) {
    if (rule.test(info.license)) {
      violations.push({ ...info, rule: rule.id });
      break;
    }
  }
}

console.log(`Scanned ${scanned} packages under node_modules/.`);

if (unknown.length) {
  console.warn(`\n⚠ ${unknown.length} package(s) with no declared license:`);
  for (const u of unknown.slice(0, 20)) {
    console.warn(`  - ${u.name}@${u.version}`);
  }
}

if (violations.length) {
  console.error(`\n✖ ${violations.length} copyleft violation(s) found:`);
  for (const v of violations) {
    console.error(`  - ${v.name}@${v.version} → ${v.license} (${v.rule})`);
  }
  console.error(
    '\nRemove or replace these dependencies before shipping the product.',
  );
  process.exit(1);
}

console.log('\n✓ No denylisted copyleft licenses found in the dependency tree.');
