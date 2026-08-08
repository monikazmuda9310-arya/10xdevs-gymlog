---
bootstrapped_at: 2026-08-08T19:31:44Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: gymlog
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

# Bootstrap verification — gymlog

## Hand-off

Verbatim from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: gymlog
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

> ## Why this stack
>
> A solo builder shipping a training-log MVP in three weeks of after-hours work, with sign-in as
> a hard requirement and a guardrail that no account may ever reach another's data. That
> combination is what picks the stack: auth, a relational store with per-row ownership, and a
> public URL all have to come out of the box, because three weeks does not survive hand-rolling
> an auth layer. `10x-astro-starter` is the vetted default for a JavaScript web product and
> clears all four agent-friendly gates — typed end to end, convention-based, well represented in
> training data, and currently documented. Its scaffolding confidence is first-class rather than
> verified, which is acceptable here since the starter installs by clone. Deployment targets
> Cloudflare Pages, the starter's own default; CI runs on GitHub Actions with auto-deploy on
> merge, so a green pipeline and a live URL stay coupled. Only the auth feature flag is set —
> payments, realtime, background jobs, and AI are all ruled out by the PRD's non-goals. The
> starter's own warning about configuring row-level authorization early is treated as a
> first-slice obligation, not a follow-up.

## Pre-scaffold verification

| Signal      | Value                                                          | Severity | Notes                                                                                       |
| ----------- | -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| npm package | not run                                                          | n/a      | `cmd_template` starts with `git clone`; no npm-distributed CLI to resolve                    |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17        | fresh    | ~3 months; from `card.docs_url`. `gh api` unavailable (not authenticated) — fell back to the unauthenticated public GitHub API |

Additional observation, not part of the standard signal set: the registry card records
`stars: 50000` for this starter, while the repository itself reports **92**. The card's figure
appears to be Astro's own star count rather than the starter's. This does not change the
selection — the "popular in training data" gate rests on Astro / React / TypeScript / Supabase,
not on this repository's popularity — but the card's number should not be cited as evidence.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone into a temp directory, drop the starter's git history, move files up)
**Exit code**: 0
**Files moved**: 20 top-level entries (`.env.example`, `.github`, `.gitignore`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`, and `CLAUDE.md` → sidelined)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (absent in cwd before the scaffold)
**.bootstrap-scaffold cleanup**: deleted (an initial `rmdir` reported the directory busy on Windows while the shell still held it; the directory was verified empty and then removed)

Notes:

- `.bootstrap-scaffold/.git/` was deleted before the move-up, so none of the starter's upstream
  history is present in this project.
- The scaffold carried no `context/` and no `.claude/`, so the conflict matrix had nothing to
  drop and nothing to sideline in those trees. The existing `context/` chain artifacts
  (`prd.md`, `shape-notes.md`, `tech-stack.md`) are untouched.
- `CLAUDE.md` is the only conflict. The existing file — the E2E testing rules delivered with the
  course packages — won; the starter's version sits beside it as `CLAUDE.md.scaffold` and needs
  a merge decision (see Next steps).
- 773 packages installed. Two deprecation warnings during install:
  `@babel/plugin-proposal-private-methods@7.18.6` and `node-domexception@1.0.0`.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 1 CRITICAL, 13 HIGH, 7 MODERATE, 2 LOW (23 total across 774 audited packages)
**Direct vs transitive**: 0 critical / 1 high / 2 moderate / 0 low are direct dependencies; the
remaining 20 are transitive. **Every finding has a fix available** — none is a dead end.

#### CRITICAL findings

- **tar** (transitive) — two advisories: node-tar applies a PAX size override to intermediary
  GNU long-name/long-link headers, producing a parser interpretation differential that allows
  file smuggling; and a process crash via PAX numeric path type confusion. Reaches the project
  through `supabase`. Fix available.

#### HIGH findings

- **astro** (**direct**) — reflected XSS via an unescaped slot name, and a Host-header SSRF in
  the prerendered error page fetch. Fix available. This is the one finding sitting on a direct
  dependency and the one worth addressing first.
- **brace-expansion** (transitive) — DoS via exponential-time expansion of consecutive
  non-expanding `{}` groups. Fix available.
- **devalue** (transitive) — DoS via sparse array deserialization. Fix available.
- **fast-uri** (transitive) — host confusion via a literal backslash authority delimiter, and
  via a backslash authority introducer. Fix available.
- **js-yaml** (transitive) — quadratic-complexity DoS in merge-key handling via repeated
  aliases. Fix available.
- **miniflare** (transitive) — inherits `sharp` and `undici` advisories. Fix available.
- **nanoid** (transitive) — non-secure generators can loop indefinitely with a negative size;
  custom generators can loop indefinitely when size is zero. Fix available.
- **postcss** (transitive) — path traversal in previous-source-map auto-loading leading to
  arbitrary `.map` file disclosure, plus an incomplete fix of GHSA-6g55-p6wh-862q. Fix available.
- **sharp** (transitive) — inherited libvips vulnerabilities: CVE-2026-33327, CVE-2026-33328,
  CVE-2026-35590, CVE-2026-35591. Fix available.
- **svgo** (transitive) — the `removeScripts` plugin leaves some executable scripts intact. Fix
  available.
- **undici** (transitive) — TLS certificate validation bypass via dropped `requestTls` in the
  SOCKS5 ProxyAgent, and HTTP header injection via `Set-Cookie` percent-decoding. Fix available.
- **vite** (transitive) — `server.fs.deny` bypass on Windows alternate paths, and an NTLMv2 hash
  disclosure via UNC path handling on Windows (through `launch-editor`). Fix available.
  Development-server-only exposure, but this project is developed on Windows.
- **ws** (transitive) — uninitialized memory disclosure, and memory-exhaustion DoS from tiny
  fragments and data chunks. Fix available.

#### MODERATE findings

- **supabase** (**direct**) — via `tar`. Fix available.
- **wrangler** (**direct**) — via `esbuild`. Fix available.
- **@astrojs/language-server** (transitive) — via `volar-service-yaml`. Fix available.
- **@cloudflare/vite-plugin** (transitive) — via `miniflare`. Fix available.
- **volar-service-yaml** (transitive) — via `yaml-language-server`. Fix available.
- **yaml** (transitive) — stack overflow via deeply nested YAML collections. Fix available.
- **yaml-language-server** (transitive) — via `yaml`. Fix available.

#### LOW / INFO findings

- **@babel/core** (transitive) — arbitrary file read via a `sourceMappingURL` comment. Fix
  available.
- **esbuild** (transitive) — arbitrary file read when running the development server on Windows.
  Fix available.

No auto-fix was applied during the bootstrap step itself. Per the bootstrap contract, that step
informs; the remediation decision is the project owner's. What follows records the remediation
that was then decided and carried out.

### Remediation performed

**`npm audit fix` (non-breaking only): 23 advisories → 4.** This cleared the CRITICAL `tar`
finding and eleven of the thirteen HIGH ones. Remaining after the fix: 2 HIGH, 1 MODERATE, 1 LOW.

**Astro 7 upgrade: attempted, reverted.** All four remaining advisories resolve only via
`astro@7.x`, which is a major bump. Bootstrap time is the cheapest possible moment for such an
upgrade — no application code depends on Astro 6 behaviour yet — and the ecosystem had already
moved: `@astrojs/cloudflare@14.2.0` peers on `astro ^7.0.0` and on `wrangler ^4.83.0` (this
project ships 4.90), and `@astrojs/react@6` supports React 19. The upgrade installed cleanly and
reported **0 vulnerabilities**, and both `astro sync` and `npm run lint` passed.

`npm run build` did not. It fails during "Building server entrypoints" with:

```
Could not find the prerender entry point in the build output. This is likely a bug in Astro.
  at getPrerenderEntryFileName (astro/dist/core/build/static-build.js:210:9)
```

Reproduced on both `astro@7.2.0` + `@astrojs/cloudflare@14.2.0` and `astro@7.1.6` +
`@astrojs/cloudflare@14.1.7`, with the starter's `astro.config.mjs` unmodified
(`output: "server"`, Cloudflare adapter, React and sitemap integrations). Two versions failing
identically points at a systematic incompatibility between Astro 7's static-build path and the
Cloudflare adapter rather than a single-release regression, so the attempt was time-boxed and
abandoned there.

**Decision: stay on Astro 6 with the four remaining advisories.** Their real exposure for this
project:

| Advisory                                | Severity | Exposure here                                                                                             |
| --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `astro` — reflected XSS via unescaped slot name; Host-header SSRF in prerendered error page | HIGH | Genuine and the one to watch. Mitigation until the upgrade lands: avoid dynamic slot names, and treat the error page as untrusted-input surface. |
| `sharp` — inherited libvips CVEs        | HIGH     | Reached only through Astro's image optimization. This product handles no user-supplied images (images are an explicit non-goal of the PRD), so the code path is not exercised. |
| `@astrojs/cloudflare` — depends on vulnerable `astro` | MODERATE | Same root cause as the `astro` entry; resolves with it.                                                    |
| `esbuild` — arbitrary file read in the dev server on Windows | LOW | Development-only, and this project is developed on Windows, so it is not purely theoretical — but it requires a local attacker able to reach the dev server. |

Revisit the Astro 7 upgrade once the adapter incompatibility is fixed upstream. The rollback
point is the `bootstrap:` commit; the upgrade command that installed cleanly was
`npm install astro@^7.2.0 @astrojs/cloudflare@^14.2.0 @astrojs/react@^6.0.2 @astrojs/check@latest @astrojs/sitemap@latest`.

### Post-remediation verification

`npx astro sync`, `npm run lint`, and `npm run build` all exit 0 on the reverted Astro 6 tree.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is
scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history. The starter's history was
  deliberately dropped, so this project has no commits yet.
- Review `CLAUDE.md.scaffold` against the existing `CLAUDE.md` and decide what to keep. The
  existing file carries the project's E2E testing rules; the starter's version carries
  stack-specific guidance. These are complementary, not competing — a merge is more likely right
  than picking one.
- Address audit findings per this project's risk tolerance. Every finding has a fix available;
  the direct-dependency ones (`astro` HIGH, `supabase` and `wrangler` MODERATE) are the ones
  worth resolving before the first slice, since a version bump on a direct dependency is
  cheapest before any application code depends on its current behaviour.
- Configure row-level authorization before the first data-touching slice. The starter's own
  documentation flags this as the place auth gaps creep in, and this project's PRD makes
  cross-account isolation a hard guardrail rather than a nice-to-have.
