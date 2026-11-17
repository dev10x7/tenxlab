---
name: help-centre
description: This skill should be used when the user asks to "build a help centre", "generate a help site", "create student help pages", "create instructor help pages", "make help guides with screenshots", "add a help section to the app", "regenerate the help screenshots", "capture screenshots for the docs", or wants role-scoped, screenshot-backed documentation pages inside a running web app. Covers both the Next.js pages and the headless-browser screenshot pipeline that feeds them.
---

# Help Centre (role guides with real screenshots)

## Purpose

Build a role-scoped in-app help centre: one guide page per role (e.g. student
and instructor), where every guide is a numbered walkthrough of a **real**
screen and carries a **real screenshot** of the running app. The same content
drives the pages, the hub, and the tests, so a guide can never point at a
missing screenshot or a route that does not exist.

This skill ships three scripts and a config template. The scripts are
project-agnostic; the config adapts them to any Next.js app.

## When to use

Use this skill when the user wants help/documentation pages that live **inside**
the product and are backed by screenshots of the actual UI — not a static docs
site. It fits an app that already runs (locally or in Docker) and has demo users
per role.

Do **not** use it for: an external documentation site (Docusaurus, MkDocs),
API reference generation, or prose-only help with no screenshots.

## The three scripts

All three read one config file (`help.config.mjs`) copied to the project root.
The guide `id` is the shared key: it is the screenshot filename suffix
(`<role>-<id>.png`), the anchor id on the page, and the test key.

| Script | Does | Reads | Writes |
|---|---|---|---|
| `scripts/scaffold-help.mjs` | Generates the guide data module, components, and pages | `help.config.mjs` | `<src>/lib/help.ts`, `<src>/components/{HelpGuide,RoleHelpPage}.tsx`, `<src>/app/help/**` |
| `scripts/capture-screenshots.mjs` | Logs in per role, screenshots each route | `help.config.mjs` | `<outDir>/<role>-<id>.png` |
| `scripts/verify-help.mjs` | Checks every guide has steps, a valid route, and a screenshot on disk | `help.config.mjs` | exit code (CI gate) |

`scaffold-help.mjs` skips files that already exist unless `--force` is passed,
so it is safe to re-run. `verify-help.mjs` accepts `--http` to also probe each
route and `--strict` to fail on any non-2xx.

## Workflow

1. **Copy the config template** to the project root and edit it:

   ```bash
   cp .agents/skills/help-centre/assets/templates/help.config.mjs help.config.mjs
   ```

   Fill in: `baseUrl`, `outDir` (the web app's served static directory, e.g.
   `apps/web/public/help`), the login selectors (`loginPath`,
   `emailSelector`, `passwordSelector`, `submitSelector`, `successPath`), one
   `users` entry per role, and one `roles` entry listing each role's guides
   (`id`, `icon`, `title`, `summary`, `route`, `steps`).

2. **Generate the pages** (writes data + components + routes):

   ```bash
   node .agents/skills/help-centre/scripts/scaffold-help.mjs
   ```

   Set `SRC_DIR` to override the default source root (`apps/web/src`).

3. **Ensure the stack is running**, then **capture screenshots**:

   ```bash
   docker compose up -d --build          # or the project's equivalent
   node .agents/skills/help-centre/scripts/capture-screenshots.mjs
   ```

   Requires `playwright-core` and a Chromium binary. Set `CHROME_PATH` if it is
   not at `/usr/bin/chromium`; set `BASE_URL` to point at a non-default host.

4. **Verify** (and use as a CI gate):

   ```bash
   node .agents/skills/help-centre/scripts/verify-help.mjs --http
   ```

5. **Wire the static assets into the container.** If the app is served by
   `next start` from a Docker image, the Dockerfile must copy the public
   directory into the runner stage, or every screenshot 404s in production:

   ```dockerfile
   COPY apps/web/public ./apps/web/public
   ```

6. **Add a nav entry** per role so the help centre is reachable. A small helper
   keeps the sidebar and any top-bar shortcut in sync:

   ```ts
   export function helpHref(role: string | undefined): string {
     return role === 'instructor' || role === 'admin'
       ? '/help/instructor'
       : '/help/student';
   }
   ```

## Adapting to another app

The scripts assume a login form (email + password) and one demo user per role.
Adjust these config keys for other auth shapes:

- **Different field names** — change `emailSelector` / `passwordSelector`.
- **No login form** (token/cookie auth) — set `successPath` to any URL and make
  `beforeCapture` set the session cookie via `page.context().addCookies`; or
  drive sign-in entirely inside a custom `beforeCapture`.
- **Empty screenshots** — provide a `beforeCapture({ baseUrl })` hook that POSTs
  seed data to the API before capturing (see the template's commented example).
- **Non-Next.js app** — the capture and verify scripts are framework-agnostic;
  only `scaffold-help.mjs` emits Next.js files. For another framework, skip the
  scaffold step and render the generated `lib/help.ts` data with the app's own
  components.

## Gotchas

- **Keep `id`s stable.** Renaming an id renames its screenshot and breaks the
  anchor; re-run capture and verify after any change.
- **Re-run capture after every UI change.** Screenshots are checked-in
  artifacts, not generated at build time, so they go stale silently otherwise.
- **`public/` must ship in the image.** The most common failure is screenshots
  present locally but 404 inside the container because the Dockerfile omits the
  public directory.
- **Lazy images report `naturalWidth === 0`** until scrolled into view. When
  asserting images loaded in a headless test, scroll the page first.
- **Prefer a catch-all proxy for API calls a help-adjacent page makes.** A page
  that fetches `/api/<feature>/*` needs a matching Next.js route under
  `app/api/<feature>/[...path]/route.ts`, or it errors at runtime.

## Additional Resources

### Assets

- **`assets/templates/help.config.mjs`** — the config template; copy to the
  project root and edit.

### Scripts

- **`scripts/scaffold-help.mjs`** — generate the data module, components, pages.
- **`scripts/capture-screenshots.mjs`** — headless login + per-route capture.
- **`scripts/verify-help.mjs`** — config/disk/HTTP verification gate.
