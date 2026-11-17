#!/usr/bin/env node
/**
 * Verify the help centre against its config.
 *
 * Checks, for every guide in help.config.mjs:
 *   - the referenced screenshot exists on disk in outDir;
 *   - the route the guide documents is non-empty and starts with "/";
 *   - (optionally) the route responds with a non-5xx status when --http is set.
 *
 * Exits non-zero on any failure, so it can gate CI.
 *
 * Usage (from the target project root):
 *
 *   node .agents/skills/help-centre/scripts/verify-help.mjs
 *   node .../verify-help.mjs --http          # also probe each route over HTTP
 *   node .../verify-help.mjs --http --strict # fail on 3xx/4xx too
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = resolve(process.env.HELP_CONFIG || 'help.config.mjs');
const HTTP = process.argv.includes('--http');
const STRICT = process.argv.includes('--strict');

const mod = await import(pathToFileURL(CONFIG_PATH).href).catch(() => {
  console.error(`Could not load help config at ${CONFIG_PATH}`);
  process.exit(1);
});
const cfg = mod.default;
const baseUrl = process.env.BASE_URL || cfg.baseUrl || 'http://localhost:3000';
const outDir = resolve(cfg.outDir || 'public/help');

const problems = [];
let guides = 0;

for (const [role, list] of Object.entries(cfg.roles || {})) {
  for (const g of list || []) {
    guides += 1;
    const label = `${role}/${g.id}`;

    if (!g.route || !g.route.startsWith('/')) {
      problems.push(`${label}: route "${g.route}" must start with "/"`);
    }
    if (!Array.isArray(g.steps) || g.steps.length === 0) {
      problems.push(`${label}: needs at least one step`);
    }

    const file = resolve(outDir, `${role}-${g.id}.png`);
    if (!existsSync(file)) {
      problems.push(`${label}: screenshot missing on disk -> ${file}`);
    } else if (statSync(file).size === 0) {
      problems.push(`${label}: screenshot is empty -> ${file}`);
    }

    if (HTTP && g.route?.startsWith('/')) {
      const url = `${baseUrl}${g.route}`;
      try {
        const res = await fetch(url, { redirect: 'manual' });
        const bad = STRICT ? res.status >= 300 : res.status >= 500;
        if (bad) problems.push(`${label}: ${res.status} from ${url}`);
      } catch (err) {
        problems.push(`${label}: request to ${url} failed (${err.message})`);
      }
    }
  }
}

console.log(`Checked ${guides} guides across ${Object.keys(cfg.roles || {}).length} roles.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every guide has steps, a valid route, and a screenshot on disk.');
