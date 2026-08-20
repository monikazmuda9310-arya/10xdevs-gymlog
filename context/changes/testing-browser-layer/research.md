---
date: 2026-08-16
researcher: Monika Zmuda
git_commit: 23f682456e94bca95bdd6794879796d01bc4efba
branch: main
repository: gymlog
topic: "Test-plan rollout Phase 2 — Browser layer (risks #2, #3, #4), and the blocking credential question"
tags: [research, codebase, testing, e2e, cloudflare, astro-env, rls, middleware, supabase-ssr]
status: complete
last_updated: 2026-08-16
last_updated_by: Monika Zmuda
---

# Research: Browser layer (test-plan Phase 2) — risks #2, #3, #4

**Date**: 2026-08-16
**Researcher**: Monika Zmuda
**Git Commit**: `23f6824`
**Branch**: `main`
**Repository**: `gymlog`

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` ("Browser layer") — risks #2, #3 and #4
from §2. Verify rather than accept the response guidance. **Answer first the blocking question:
nothing in this repository points a running HTTP server at `gymlog-test`, and the only mechanism
that makes a test process structurally incapable of reaching production is the env allowlist in
`vitest.integration.config.ts`.**

---

## Summary — the verdict, up front

**The blocking question is resolved, and the answer is worse than the plan assumed in one place and
better in another.**

1. **`astro dev` cannot be aimed at `gymlog-test` by any per-process mechanism.** This is now
   mechanical rather than folklore. `@astrojs/cloudflare` does
   `Object.assign(process.env, parseEnv(readFileSync(".dev.vars")))` in `astro:config:done`
   (`index.js:292-303`), and Vite's `loadEnv` applies `process.env` **last**, after every `.env*`
   file (`config.js:9417-9418`). So `.dev.vars` beats `.env`, beats `.env.<mode>`, and beats a shell
   variable. In dev, Astro then **inlines** that value into the `astro:env/server` virtual module
   (`vite-plugin-env.js:86-88, 151-155`), so the workerd env is not even consulted. There is no flag,
   no mode, no second file. AGENTS.md § Cloudflare traps is correct and can now cite a line.

2. **A previously unrecorded fact makes this worse: `npm run build` copies the production
   credentials into the build output.** `@cloudflare/vite-plugin` emits `dist/server/.dev.vars` from
   the root `.dev.vars` (`index.mjs:83194-83201`). That file exists on this machine right now
   (118 bytes, written 2026-08-15 21:14). **So the built worker is aimed at production too, by
   default, via a file no test author would think to look at.** This belongs in AGENTS.md.

3. **But the built worker is the opening, and it is proven, not inferred.** At build time Astro
   emits a **runtime** lookup rather than an inlined value. From the committed build output,
   `dist/server/chunks/server_Cs1d2reD.mjs:146-165`:
   `const getEnv = (key) => { return getEnv$1(key); }` and
   `let SUPABASE_URL = _internalGetSecret("SUPABASE_URL");`. `getEnv$1` is replaced at boot by
   `setGetEnv(createGetEnv(globalEnv))` where `globalEnv` is `env` from `cloudflare:workers`
   (`@astrojs/cloudflare/dist/utils/handler.js:11,15`). **The credential is not baked in; the served
   worker reads it from the workerd env on every request.** That is a different, controllable
   credential path from `astro dev`, and `AGENTS.md`'s "do not add a `wrangler dev` step — it is
   legacy" does **not** cover it (see §3 below).

4. **The honest recommendation is NOT to open with a browser.** The genuinely structural option —
   the one that reproduces `vitest.integration.config.ts`'s *subtractive* guarantee rather than
   out-prioritising a file — is a **fourth Vitest project** that loads Astro's Vite pipeline with
   `vite.envDir` pointed at a credential-free directory, and drives `src/middleware.ts` and
   `src/lib/supabase.ts` with **real Supabase auth cookies from a real sign-in against
   `gymlog-test`**. That closes the actual gap behind risks **#2 and #3** — which is the cookie and
   `locals.user` path, not the browser — with production not merely unaimed-at but **absent from the
   process and unreachable from disk**. Risk **#4** (hydration) genuinely needs a browser and is the
   only part that should carry the browser cost; it should be sequenced second and gated on one
   measurement.

Full ranking, with the structural/convention label demanded, is in §4.

---

## Part I — The blocking question

### 1. How a running server decides which Supabase project it talks to

Read in order; every claim below is from the installed source.

#### 1a. Where the value is consumed

`src/lib/supabase.ts:1-27` is the only consumer. It imports from the virtual module and returns
`null` when either value is missing:

```ts
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { /* cookie adapters */ });
}
```

Both fields are declared `context: "server", access: "secret", optional: true`
(`astro.config.mjs:17-22`). `access: "secret"` is the load-bearing word — it is what makes the value
a **runtime** lookup rather than a build-time inline. `optional: true` plus Astro's
`validateSecrets: false` default (`astro/dist/core/config/schemas/base.js:64`) means **a build with
no credentials at all succeeds silently**.

#### 1b. What `astro dev` does — the poisoned path

Three steps, in this order:

**Step 1** — the adapter overwrites `process.env` from `.dev.vars`, unconditionally.
`node_modules/@astrojs/cloudflare/dist/index.js:292-303`, inside `astro:config:done`:

```js
const devVarsPath = new URL(".dev.vars", config.root);
if (existsSync(devVarsPath)) {
  try {
    const data = readFileSync(devVarsPath, "utf-8");
    const parsed = parseEnv(data);
    Object.assign(process.env, parsed);
  } catch {
    logger.error(`Unable to parse .dev.vars, variables will not be available to your application.`);
  }
}
```

Note `Object.assign` — this is an **overwrite**, not a default. The path is
`new URL(".dev.vars", config.root)`, hardcoded: there is no `.dev.vars.<env>` variant on this line.

**Step 2** — Astro loads env through Vite's `loadEnv`, which applies `process.env` **last**.
`astro/dist/env/env-loader.js:38-46` calls `loadEnv(mode, config.vite.envDir ?? fileURLToPath(config.root), "")`.
Vite's implementation, `node_modules/vite/dist/node/chunks/config.js:9417-9418`:

```js
for (const [key, value$1] of Object.entries(parsed)) if (prefixes.some(...)) env$1[key] = value$1;
for (const key in process.env) if (prefixes.some(...)) env$1[key] = process.env[key];
```

The file-derived values go in first; `process.env` overwrites them. So the precedence is
**`.dev.vars` > shell variable > `.env.<mode>.local` > `.env.<mode>` > `.env.local` > `.env`** —
because `.dev.vars` reached `process.env` in step 1 and `process.env` wins in step 2.

**Step 3** — in dev, the value is **inlined into the virtual module**, so the workerd env is never
read. `astro/dist/env/vite-plugin-env.js:84-88` and `:151-155`:

```js
const { client, server } = getTemplates({
  schema, validatedVariables,
  // In dev, we inline process.env to avoid freezing it
  loadedEnv: isBuild ? null : loadedEnv,
});
...
if (loadedEnv) {
  server = server.replace("// @@GET_ENV@@", `return (${JSON.stringify(loadedEnv)})[key];`);
} else {
  server = server.replace("// @@GET_ENV@@", "return _getEnv(key);");
}
```

`isBuild` is set from the Vite command (`:20-22`), so `astro dev` takes the first branch.

**Consequence.** Under `astro dev` the running app talks to whatever `.dev.vars` names, and
`.dev.vars` names production (AGENTS.md § Cloudflare traps; the file is 114 bytes and is denied to
agent file tools by `.claude/settings.json:43`, so it was not read here). Changing it for one process
is impossible: a shell override is clobbered in step 1, a `--mode` and a `.env.test` are clobbered in
step 2, and even deleting `.dev.vars` only falls back to `.env` — which is production as well.
**`astro dev` is unusable for this phase and no amount of flags fixes it.**

#### 1c. What the build does — the opening

At build, `loadedEnv` is `null`, so the emitted module is `return _getEnv(key)`. `_getEnv` starts as
`(key) => process.env[key]` (`astro/dist/env/runtime.js:4`) and is replaced at worker boot by
`@astrojs/cloudflare/dist/utils/handler.js:11,15`:

```js
import { env as globalEnv } from "cloudflare:workers";
import { setGetEnv } from "astro/env/setup";
import { createGetEnv } from "../utils/env.js";
setGetEnv(createGetEnv(globalEnv));
```

**Verified against the committed build output rather than inferred** —
`dist/server/chunks/server_Cs1d2reD.mjs:146-165`:

```js
const getEnv = (key) => {
  return getEnv$1(key);
};
const _internalGetSecret = (key) => { const rawVariable = getEnv(key); ... };
...
  SUPABASE_URL = _internalGetSecret("SUPABASE_URL");   // re-read inside setOnSetGetEnv
  SUPABASE_KEY = _internalGetSecret("SUPABASE_KEY");
let SUPABASE_URL = _internalGetSecret("SUPABASE_URL");
let SUPABASE_KEY = _internalGetSecret("SUPABASE_KEY");
```

No URL and no key appear as literals. **The built worker resolves both from the workerd env at
runtime.** Whoever supplies that env decides the project.

#### 1d. What feeds the workerd env — and the finding that must be written down

Wrangler resolves it in `getVarsForDev`, `node_modules/wrangler/wrangler-dist/cli.js:255334-255388`.
Two properties matter and both are counter-intuitive:

```js
function getVarsForDev(configPath, envFiles, vars, env7, silent = false, secrets) {
  const result = {};
  for (const [key, value] of Object.entries(vars)) result[key] = toVarBinding(value);
  const configDir = path.resolve(configPath ? path.dirname(configPath) : ".");
  ...
    const devVarsPath = path.resolve(configDir, ".dev.vars");
    const loaded = loadDotDevDotVars(devVarsPath, env7);
  ...
  } else if (loadedSecrets !== void 0) {
    for (const [key, value] of Object.entries(loadedSecrets)) {
      result[key] = { type: "secret_text", value };   // ← overwrites config `vars` and `--var`
    }
  }
```

- **`.dev.vars` overwrites config `vars`, and therefore overwrites `--var`.** A
  `wrangler dev --var SUPABASE_URL:<test>` is silently beaten by the file. This kills the most
  obvious-looking option.
- **The `.dev.vars` lookup is relative to the CONFIG FILE's directory, not the cwd.**
- **`--env <name>` REPLACES `.dev.vars` rather than merging** — `cli.js:255413`:
  ```js
  function loadDotDevDotVars(envPath, env7) {
    return env7 !== void 0 && tryLoadDotDevDotVars(`${envPath}.${env7}`) || tryLoadDotDevDotVars(envPath);
  }
  ```
  A short-circuit `||`: `.dev.vars.<name>` if it exists, otherwise `.dev.vars`. `CLOUDFLARE_ENV` is
  read as an equivalent of `--env` (`@cloudflare/vite-plugin/dist/index.mjs:64696`;
  wrangler `cli.js` env factory at `:42095`), and an unknown environment name produces
  `No environment found in configuration with name "<x>"` unless `wrangler.jsonc` carries a matching
  `env.<x>` block (`@cloudflare/vite-plugin/dist/index.mjs:42522-42529`).

**And the finding that is not in any document today:**
`@cloudflare/vite-plugin/dist/index.mjs:83194-83201` emits `.dev.vars` **into the build output**:

```js
if (inputWorkerConfig.configPath) {
  const localDevVars = getLocalDevVarsForPreview(inputWorkerConfig, ctx.resolvedPluginConfig.cloudflareEnv);
  if (localDevVars) this.emitFile({ type: "asset", fileName: ".dev.vars", source: localDevVars });
}
```

with the plugin's own comment naming the consumer — *"so that wrangler reads it back unchanged when
it parses `dist/<env>/.dev.vars` at preview time"* (`:68968-68969`). `dist/server/.dev.vars` exists
on this machine (118 bytes, 2026-08-15 21:14, alongside `entry.mjs` and `wrangler.json`). It was not
opened; its existence and provenance are established from `ls` and from the plugin source.

> **So `npm run build` writes production credentials to disk under `dist/`, and `astro preview`
> reads them from there.** `dist/` is gitignored (`.gitignore:2`) so nothing leaks to the repository,
> and `.assetsignore` keeps it off the CDN (`index.mjs:83203`) — but a browser harness pointed at the
> build output inherits production **by default and in silence**. This is the exact failure shape
> this project fears: plausible behaviour, no error, wrong database.

#### 1e. Where the value enters, in one table

| Command | Where `SUPABASE_URL` comes from | Can one process change it? |
| --- | --- | --- |
| `astro dev` (`npm run dev`) | **inlined** at module-load from Vite `loadEnv`, which `.dev.vars` has already overwritten via `process.env` | **No.** Nothing beats step 1's `Object.assign` |
| `astro build` | not resolved at all; emits `_getEnv(key)` | n/a — no credential is baked in |
| built worker (deployed, `astro preview`, `wrangler dev`) | **workerd env at request time**, fed by wrangler config `vars` → overwritten by `.dev.vars` in the **config file's directory** (`dist/server/` for the build output), with `.dev.vars.<env>` replacing it under `--env`/`CLOUDFLARE_ENV` | **Yes** — three ways, of differing honesty; see §4 |

### 2. What `vitest.integration.config.ts`'s allowlist actually does, and whether it is reproducible

`vitest.integration.config.ts:9-24`, quoted whole because the property is in the shape, not the list:

```ts
try {
  process.loadEnvFile();
} catch {
  /* no .env — CI's environment is the source there */
}

// The suite's guarantee is that it is INCAPABLE of reaching production, not merely disinclined to.
// `.env` holds production's URL, key and database password plus an account-wide access token, and
// loadEnvFile above has just pulled all of them into this process. Strip everything the check is
// not entitled to, so the local blast radius matches CI's — where only these three are supplied.
const ALLOWED = new Set(["SUPABASE_TEST_URL", "SUPABASE_TEST_KEY", "GYMLOG_TEST_PASSWORD"]);
for (const key of Object.keys(process.env)) {
  if (/^(SUPABASE|GYMLOG)_/.test(key) && !ALLOWED.has(key)) {
    Reflect.deleteProperty(process.env, key);
  }
}
```

**The property that makes it structural is that it is SUBTRACTIVE.** It does not supply the right
value and hope it wins a precedence contest; it **deletes the wrong value from the process**, after
deliberately loading it, so that no code path downstream can name production even by accident. A
test that tried would read `undefined`. Two corollaries the plan should hold onto:

- The guarantee is about **capability**, not intent. `Reflect.deleteProperty` cannot be
  out-prioritised by a later file read — unless something re-reads the file. That is precisely what
  `@astrojs/cloudflare` does at `index.js:297`, which is why the same trick **cannot** be applied to
  `astro dev`: the adapter puts the value back from disk after any strip.
- It is enforced by the **config file the runner loads**, not by a wrapper script, so
  `npm run test:integration` cannot be invoked in a way that skips it. Reproducing the guarantee
  means putting it in the config a runner cannot start without.

**Can it be reproduced for a server process?** Assessed one mechanism at a time:

| Mechanism | Verdict |
| --- | --- |
| `SUPABASE_URL=… npm run dev` (process env) | **No.** Clobbered by `Object.assign` at `index.js:297` before Vite reads env |
| `.env.test` + `astro dev --mode test` | **No.** `.env.<mode>` is beaten by `process.env`, which holds `.dev.vars` (`config.js:9417-9418`) |
| A `vite` `define` | **No.** The value is not a bare identifier at the call site; it is an `export let` in a virtual module |
| `astro dev` with `.dev.vars` renamed away | **No.** Falls back to `.env` — also production. And it is a file mutation, not a per-process property; a killed process leaves the machine broken (same class as the `finally` lesson in `lessons.md`) |
| `wrangler dev --var SUPABASE_URL:…` | **No.** `.dev.vars` overwrites config `vars` (`cli.js:255380-255384`) |
| `.dev.vars.test` + `CLOUDFLARE_ENV=test`/`--env test` on the **built** worker | **Yes, but additive** — the right file wins only if the flag is passed. Forgetting it is silent and looks identical |
| Built worker + **no `.dev.vars` reachable** + credentials from the launching process env | **Yes, and subtractive** — the same shape as the vitest allowlist. Needs two wrangler env gates verified (below) |
| A fourth Vitest project with `vite.envDir` pointed at a credential-free directory | **Yes, and subtractive, and inside a config a runner cannot skip.** Strongest available. Does not need an HTTP server at all |

The last two are the only ones that reproduce the *property* rather than the *outcome*. Both are
developed in §4.

Wrangler's fallback when no `.dev.vars` is found (`cli.js:255351-255360`) is what makes the
process-env route possible:

```js
if (loadedSecrets === void 0 && getCloudflareLoadDevVarsFromDotEnv()) {
  const resolvedEnvFilePaths = (envFiles ?? getDefaultEnvFiles(env7)).map((p) => path.resolve(configDir, p));
  loadedSecrets = loadDotEnv(resolvedEnvFilePaths, {
    includeProcessEnv: !!secrets || getCloudflareIncludeProcessEnvFromEnv(),
    silent,
  });
}
```

gated by `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV` and `CLOUDFLARE_INCLUDE_PROCESS_ENV`
(`cli.js:52362-52368`), with `loadDotEnv` doing `Object.assign(expandedEnv, process.env)` when
`includeProcessEnv` is set (`cli.js:255307-255312`). **This was read, not run.** Per
`lessons.md` § "The ORDER database-internal actions fire in is a fact about the catalogue — and
reading the catalogue is still not measuring", it must be measured before any design rests on it.

### 3. Does the build / preview / wrangler path offer something `astro dev` does not — and is it foreclosed?

**Yes it does, and no it is not foreclosed.** The AGENTS.md sentence is:

> `astro dev` already runs the real workerd runtime (adapter v13 bundles `@cloudflare/vite-plugin`).
> Do not add a `wrangler dev` step — it is legacy for this stack, and `platformProxy` was removed.
> — `AGENTS.md:517-519`

Read in place, this bullet is about **the development loop**: its subject is "you do not need a
second runtime to develop against workerd". It is correct about that. It says nothing about running
the **built output** as a test harness, and the two are materially different, because §1c proves the
credential resolution differs between them — dev inlines, build defers to the runtime env. **The
sentence should be narrowed rather than obeyed as a blanket prohibition**, and the narrowing should
say why (dev inlines its secrets; the build does not).

Concretely, the three post-build paths:

- **`astro preview`** — `@astrojs/cloudflare/dist/entrypoints/preview.js:20-46` requires
  `.wrangler/deploy/config.json` (present) and runs `vite preview` with the Cloudflare plugin. The
  worker config it serves is `dist/server/wrangler.json`, so `configDir` is `dist/server/` and the
  `.dev.vars` it reads is the **emitted** one. Whatever the build put there is what preview serves.
- **`wrangler dev --config dist/server/wrangler.json`** — same `configDir` rule, same file. Adds
  `--env` and the process-env fallback described above. This is the path with the most control.
- **`wrangler deploy --env <name>`** — a separately named Worker with its own Cloudflare-held
  secrets. Note the redirected-config guard at `index.mjs:42498-42517`: a build records a
  `targetEnvironment` and wrangler refuses a mismatched `--env` with *"Perhaps you need to re-run the
  custom build of the project"*. That guard catches a **mismatch**; it does not catch **forgetting**,
  because a build with no environment records none.

### 4. The honest options, ranked

Every option is labelled **STRUCTURAL** (production is unreachable — the value is absent from the
process and from every file the process reads) or **CONVENTION** (production is merely unaimed-at —
a forgotten flag re-aims it silently).

---

#### Option A — a fourth Vitest project driving the middleware and cookies in-process — **STRUCTURAL** — recommended, and it covers risks #2 and #3

**What it is.** `vitest.middleware.config.ts` (name illustrative), built with `getViteConfig` the way
`vitest.render.config.ts` is, so `astro:middleware` and `astro:env/server` resolve — but with two
changes that carry the guarantee:

1. the same subtractive strip as `vitest.integration.config.ts:19-24`, then an explicit
   `process.env.SUPABASE_URL = process.env.SUPABASE_TEST_URL` (and key) **after** the strip;
2. `vite: { envDir: <a directory containing no .env> }`, which is read at
   `astro/dist/env/env-loader.js:39` as `config.vite.envDir ?? fileURLToPath(config.root)`. With no
   `.env*` on that path, `loadEnv` has nothing to parse and **only** the seeded `process.env` values
   survive.

Production's URL is then neither in the process nor reachable from disk by that runner. This is the
vitest allowlist's property, extended one step to close the `.env`-on-disk hole.

**What it tests, and why it is the right layer for #2 and #3.** The gap those two risks name is
**not** the browser — it is everything between an inbound HTTP request and `locals.user`, which
today executes **zero times in the entire gate** (see Part II §6). This project can drive it
directly: sign in against `gymlog-test` with `@supabase/supabase-js`, take the real session, build a
real `Cookie` header, call the exported `onRequest` from `src/middleware.ts` with a real `Request`
and an `AstroCookies` double, and assert on `locals.user.id`, on the redirect, and then on a
persisted read-back as the row's owner. That covers a genuine cookie, a **stale** cookie, a
**cleared** cookie, both middleware directions, and `createClient`'s `getAll`/`setAll` adapters.

**Cost.** One config, one suite, no new dependency, no HTTP server, no browser.
**Must be measured first**: that `astro:middleware` resolves outside the container under
`getViteConfig` with `configFile: false`. If it does not, this option collapses and B moves up.

---

#### Option B — a browser against the built worker, credentials from the launching process env — **STRUCTURAL, conditional on one measurement** — for risk #4 only

**What it is.** `npm run build`; **delete `dist/server/.dev.vars`**; launch
`wrangler dev --config dist/server/wrangler.json` from a launcher that applies the same subtractive
strip and then sets `SUPABASE_URL`/`SUPABASE_KEY` from the test pair, with
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=true` and `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`; point
Playwright at it.

**Why it is structural rather than conventional.** If the launcher is bypassed, the variables are
**absent**, not wrong. `src/lib/supabase.ts:9-11` then returns `null`, `src/middleware.ts:28-30` sets
`locals.user = null`, and every protected route redirects to `/auth/signin`. For a *human* that
failure is famously silent (AGENTS.md § Cloudflare traps); **for a browser suite it is a red test on
the first step**. The wrong outcome is "no credentials", never "production credentials" — provided
`dist/server/.dev.vars` is genuinely gone, which the launcher must assert rather than assume.

**Conditions, all of which must be measured before this is planned on:**

1. the two `CLOUDFLARE_*` gates behave as the source reads (§2 above) — read, not run;
2. deleting `dist/server/.dev.vars` does not break the preview/dev config load;
3. the launcher's absence-assert on that file is proven **by breaking it** (`lessons.md` § "A hook
   that never fires and a hook that passes are the SAME observation").

**Residual hazard to write down:** an ordinary `npm run build` re-creates
`dist/server/.dev.vars` with production credentials. The harness must delete it **after every
build**, and the assert must run **immediately before launch**, not once at setup.

---

#### Option C — `astro preview` / `wrangler dev` with `.dev.vars.test` + `CLOUDFLARE_ENV=test` — **CONVENTION** — not recommended

Works mechanically: `loadDotDevDotVars` prefers `.dev.vars.test` and the build would emit it into
`dist/server/.dev.vars`. Needs an `env.test` block in `wrangler.jsonc` or wrangler errors on the
unknown name.

**Rejected because the failure mode is silent and identical.** Forget `CLOUDFLARE_ENV=test` on the
build and the output carries production, the server starts, pages render, sign-in works, and the
suite writes into the owner's real training log. Nothing on screen or in the logs distinguishes the
two runs. It also introduces a second credential file on the developer's machine, which is one more
thing that can be stale.

---

#### Option D — a second deployed Worker (`wrangler deploy --env test`) — **STRUCTURAL at the credential level** — fallback

Secrets live in Cloudflare, set once with `wrangler secret put --env test`, and no file on disk
decides anything. Genuinely isolated.

**Costs that make it a fallback, not the answer:** a public URL with an open signup form on the test
project; a deploy inside the test loop; CI would need a Cloudflare API token, which cuts against the
repository's deliberate "migrations and deploys are applied by hand" stance; and `npx wrangler deploy`
is in the `ask` list of `.claude/settings.json:50`. Also the `targetEnvironment` guard catches a
mismatched `--env` but not an omitted one.

---

#### Option E — re-scope Phase 2 away from a real browser — **available, and partially the right answer**

Even if A and B both land, **risk #4's "unusable at a phone width" half has no automated home** and
should be stated as a named gap rather than implied as covered. And if Option A's measurement fails
*and* Option B's conditions fail, the honest re-scope is:

- **#2 and #3** → integration-level, with the cookie path named as an explicit uncovered edge in the
  suite that comes closest, in the same words the repository already uses to refuse an assertion
  (`lessons.md` § "An assertion you keep because it cannot fail YET…").
- **#4** → keep the render checks, and keep the human walkthrough that
  `tests/integration/workout-page-access.test.ts:12` already points at, but **write down that the
  hydration risk is unguarded** rather than letting a green gate imply otherwise.

**Recommended sequencing: A first (structural, cheap, closes the real gap behind #2 and #3), then B
gated on its measurement (for #4 alone), with C rejected and D held in reserve.** Under no
circumstance C, and under no circumstance anything aimed at `astro dev`.

---

## Part II — the test-layer questions

### 5. The session/cookie shape, and what a stale or cleared cookie produces

**Cookie plumbing** — `src/lib/supabase.ts:12-26`. `@supabase/ssr`'s `createServerClient` is given
two adapters and nothing else:

```ts
cookies: {
  getAll() {
    return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
      name, value: value ?? "",
    }));
  },
  setAll(cookiesToSet) {
    cookiesToSet.forEach(({ name, value, options }) => { cookies.set(name, value, options); });
  },
},
```

`getAll` reads the inbound `Cookie` header; `setAll` writes onto the **current response** via
`AstroCookies`. That second half is why `DELETE /api/account` signs out in the same request
(`src/pages/api/account/index.ts:21-26`) — the cookie-clearing headers have to ride a response that
exists.

**Both directions of route protection** — `src/middleware.ts:7,15,32-40`:

```ts
const PROTECTED_ROUTES = ["/dashboard", "/exercises", "/workouts", "/records", "/settings"];
const AUTH_ROUTES = ["/auth/signin", "/auth/signup"];
...
if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
  if (!context.locals.user) { return context.redirect("/auth/signin"); }
}
if (context.locals.user && AUTH_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
  return context.redirect("/dashboard");
}
```

It is a **prefix match**, so `/workouts` covers `/workouts/<id>` from one array entry
(`middleware.ts:5-6`). `/auth/confirm-email` is deliberately in neither list (`:9-14`).

**Where `locals.user` is resolved** — `middleware.ts:23-30`:

```ts
if (supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  context.locals.user = user ?? null;
} else {
  context.locals.user = null;
}
```

`getUser()`, not `getSession()` — the former validates against the auth server rather than trusting
the cookie's payload.

**What a stale or cleared cookie actually produces.** Three distinct outcomes, and the plan should
test all three because they are not interchangeable:

| Cookie state | `getUser()` | `locals.user` | Protected route | Data |
| --- | --- | --- | --- | --- |
| absent / cleared | no user | `null` | 302 → `/auth/signin` | never queried |
| present but expired / revoked | error → no user | `null` | 302 → `/auth/signin` | never queried |
| present and valid | the user | the user | renders | RLS-scoped to that user |

The failure worth catching is the **second row silently behaving like the third**. Asserting the
redirect alone cannot see it — which is exactly what risk #3's guidance says, and the guidance is
**correct as written**.

**Sign-out** — `src/pages/api/auth/signout.ts:3-12`. It calls `supabase.auth.signOut()` (which
writes cleared cookies through `setAll`) and then redirects to `/auth/signin`, not `/`, with the
comment *"returning must require authenticating again (US-04's third criterion)"*.

### 6. Which layer answers 404 — and precisely what the existing suites do not cover

**Answer: the application, never RLS.** RLS produces zero rows; the handler manufactures the 404.
Three distinct sites:

1. **Before any query** — `src/pages/api/_shared/mutation-route.ts:42-58`:

```ts
export function resolve(context: APIContext, notFound: WorkoutMessageCode): Resolved | Response {
  const { supabase, user } = context.locals;
  if (!supabase) { return fail(500, "not_configured"); }
  if (!user) { return fail(401, "unauthenticated"); }
  const id = context.params.id ?? "";
  if (!UUID_PATTERN.test(id)) { return fail(404, notFound); }
  return { supabase, userId: user.id, id };
}
```

Note what `resolve()` does **not** do: it never checks ownership. It takes `user.id` from
`context.locals` **as given** and hands it on as the filter value. Everything downstream is only as
correct as `locals.user` — which is set by the middleware, which no test executes.

2. **In the service** — `src/lib/services/workouts.ts`, header at `:222-226` and e.g. `updateSet`
   at `:279-291`, which uses the array form (not `.single()`) so zero rows is not an error:
   `return data.length > 0 ? data[0] : null;`. Every mutation carries `.eq("user_id", userId)` **and**
   `.select()`.

3. **In the route** — e.g. `src/pages/api/workouts/[id]/index.ts:55`:
   `return (await deleteWorkout(supabase, userId, id)) ? noContent() : fail(404, "workout_not_found");`

The **page** path does the same thing independently: `src/pages/workouts/[id].astro:11-38` repeats
the `UUID_PATTERN` check (duplicated, not shared with `resolve()`), calls `getWorkout`, and sets
`Astro.response.status = 404` itself when nothing came back.

**What proves A's row survived untouched**: a re-read **as A**, of the columns the attacker tried to
change. The pattern to copy is `tests/integration/workout-mutations-rls.test.ts:149-157` and
`:176-188` — status assertion *and* persisted state, in the same test.

**The thirteen-suites challenge — verified, and the count is wrong.** There are **15** test files in
`tests/integration/` plus one helper (`fixture-preferences.ts`), not thirteen. More important, the
**substance of the challenge is confirmed**: every suite authenticates with
`createClient` from `@supabase/supabase-js` + `signInWithPassword`, then hands the handler a
**hand-built `locals`** — e.g. `workout-mutations-rls.test.ts:73-83`:

```ts
locals: { supabase: client ?? owner.client, user: { id: owner.userId } },
```

An exhaustive grep across `tests/` for `@supabase/ssr`, `createServerClient`, `cookie`/`Cookie` and
`middleware` returns **only comments** — `account-boundary.test.ts:446-447` and
`account-deletion.test.ts:157,362`. **Zero lines of test code touch a cookie or the SSR client.**

Therefore the code that executes **zero times in the entire gate** is:

- `src/lib/supabase.ts:8-27` in full, including the `null`-on-missing-secrets branch;
- both cookie adapters (`:14-19`, `:20-25`) — chunked cookies, malformed headers, refresh-on-read;
- `src/middleware.ts:18` (the only production call site of `createClient`);
- `src/middleware.ts:23-30` — **the step that binds an identity to a request**. The suites assert the
  invariant this is supposed to produce, by passing a client and an id that already agree **by
  construction**. A middleware bug putting the *wrong* user on `locals.user` is invisible to all 15;
- `src/middleware.ts:32-40` — both redirect directions, and the `/workouts` prefix semantics;
- `context.locals.supabase = supabase` (`:21`), the single-client-per-request contract.

Partial exception worth naming so it is not double-counted:
`profile-mutations-rls.test.ts:145-166` deliberately feeds a **mismatched** pair
(`{ supabase: ownerA.client, user: { id: crypto.randomUUID() } }`) and proves RLS confines the write
anyway. That covers one handler's trust in `locals.user.id`; it does not cover the middleware's
derivation of it.

The render suites do not close this either — they call Astro's container with fake `locals`
(`tests/render/dashboard-tonnage.test.ts:164`, `settings-island.test.ts:55,209`) and run without the
adapter, so no middleware executes.

**Verdict on risk #2's guidance: CORRECT in substance, wrong in the count.** Change "thirteen" to
"fifteen", or better, to "every integration suite" — a count invites the same class of correction as
the `0.45359237` incident in `lessons.md`.

### 7. Islands, hydration, and the accessible names a test would need

**Every island in the repository hydrates `client:load`** — `grep "client:"` over `src/**/*.astro`
returns 8 hits, all `client:load`. There is **no `data-testid` anywhere in `src/`**; the only `data-*`
hooks are `data-initial-focus` (confirm-dialog) and `data-slot="button"` (shadcn). Everything is
reachable by role/label/text, as the repository requires.

**Sign up — `/auth/signup`** (`src/pages/auth/signup.astro`, island `SignUpForm.tsx` mounted at
`signup.astro:18` as `<SignUpForm serverError={error} client:load />`):

| Control | Accessible name | Role | Source |
| --- | --- | --- | --- |
| heading | `Sign up` | heading | `signup.astro:16` |
| email | `Email` (placeholder `you@example.com`) | textbox | `SignUpForm.tsx:82` |
| password | `Password` (placeholder `Min. 8 characters`) | textbox | `SignUpForm.tsx:95` |
| confirm | `Confirm password` | textbox | `SignUpForm.tsx:119` |
| submit | `Create account` → pending `Creating account...` | button | `SignUpForm.tsx:141-143` |

⚠️ Both password-visibility toggles carry the identical `aria-label` `Show password`
(`PasswordToggle.tsx:14`), so on `/auth/signup` that name resolves to **two** elements — scope or use
`.first()`.

**Sign in — `/auth/signin`** (island `SignInForm.tsx` at `signin.astro:36`): `Sign in` heading,
`Email`, `Password`, submit `Sign in` → `Signing in...` (`SignInForm.tsx:54,67,89-91`). Deletion
notice at `signin.astro:28-33` is `role="status"`.

**Create a workout — `/workouts`** (island `NewWorkoutForm.tsx` at `index.astro:55`,
`defaultDate` prop only):

- heading `Log a new workout` (`NewWorkoutForm.tsx:68`)
- `Date` — `getByLabel("Date")`, unambiguous on this page (`:72-74`)
- `Note (optional)` (`:91-93`)
- submit `Start workout` → pending `Creating…` (U+2026) (`:116-127`)
- **success signal is a navigation**: `window.location.href = /workouts/<id>` (`:52`) — wait on the
  URL, there is no message.

**`/workouts/[id]`** — two islands, both `client:load`: `WorkoutHeader.tsx` (`[id].astro:85`) and
`WorkoutDetail.tsx` (`[id].astro:98`).

- add an exercise: `ExercisePicker.tsx` — search box labelled `Search exercises` (`:32-34`, `sr-only`),
  each exercise is a `button` whose computed name **concatenates** name + badges + muscle group
  (`:65-88`), so match with `exact: false` or a regex.
- log a set: `AddSetForm.tsx` — `Reps` (spinbutton, `:97-99`), `Weight (kg)` / `Weight (lb)` — the
  unit is **in the label** (`:118-120`) — `RPE` (`:140-142`), and the submit is **icon-only** with
  `aria-label="Add set"` (`:158-169`).
- ⚠️ the labels **repeat per entry** (ids are `reps-<entryId>`), so a second exercise makes
  `getByLabel("Reps")` ambiguous. With CSS banned the scoping route is
  `getByRole("listitem").filter({ hasText: <exercise name> })`.

**The estimate — the assert target for risk #4** — `WorkoutDetail.tsx:545-562`:

```jsx
<span className="text-sm text-purple-200">
  ≈ <strong>{roundForDisplay(estimate.oneRepMax)}</strong> {unit} 1RM
</span>
```

DOM text is `≈ 120.5 kg 1RM` (`≈` is U+2248; one decimal via `Math.round(v*10)/10`,
`set-display.ts:119-121`). The three non-numeric alternatives occupy the same slot:
`bodyweight — no load to estimate from`, `assisted — no estimate`,
`outside 1–12 reps — no estimate`. **So a test that wants a number must log 1–12 reps at a positive
weight** — which is also exactly the domain boundary AGENTS.md protects. Per-entry line:
`Best estimated 1RM here: 120.5 kg` (`:351-358`).

**Waiting, without `waitForTimeout`.** Success on "add set" has **no message** and the button's
accessible name does not change (the `aria-label` is static) — so wait on the **new set row / its
`1RM` span**, or on the RPE field being cleared (`AddSetForm.tsx:75-77`). The record badge is
`Personal record` or `Personal record — beat 115 kg` (`WorkoutDetail.tsx:515-537`). The confirm
dialog is `role="alertdialog"` and shows `Checking which records depend on this…` while the impact
preflight runs (`RecordImpactDialog.tsx:86-91`) — wait for that to go before clicking confirm.

**Sign out — a trap for risk #3.** The control is rendered in exactly two places:
`src/components/Topbar.astro:16-20` and `src/pages/dashboard.astro:307-314`. `Topbar.astro` is
imported only by `Welcome.astro`, which is used only by `src/pages/index.astro` — the public landing
page. **`/workouts` and `/workouts/[id]` carry no sign-out control at all.** A sign-out test must
navigate to `/dashboard` (or `/`) first, then
`getByRole("button", { name: "Sign out" })`, then expect `/auth/signin`.

**One finding outside the question, worth flagging.** `WorkoutDetail` receives
`catalogue={catalogue}` — the whole exercise catalogue, ~38 seeded rows plus the account's own — as
an **island prop** (`[id].astro:92-99`). AGENTS.md § Conventions says a large collection is rendered
by Astro and slotted, never passed as a prop, and only the 418-entry timezone `<select>` is guarded
(`tests/render/settings-island.test.ts`). This does not affect how a test drives the page, but it is
either a real instance of the rule or a case the rule intends to exempt, and the rule does not say
which.

### 8. Account lifecycle — `delete_own_account()` verified, not assumed

`supabase/migrations/20260815140000_delete_own_account.sql:89-137`:

```sql
create function public.delete_own_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  removed integer;
begin
  if caller is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'delete_own_account() requires an authenticated caller', ...;
  end if;

  delete from public.workouts where user_id = caller;
  delete from public.exercises where user_id = caller;

  delete from auth.users where id = caller;
  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception using errcode = 'no_data_found', message = 'no account matched the caller', ...;
  end if;
end;
$$;
```

with `revoke all on function public.delete_own_account() from public, anon, authenticated;` then
`grant execute … to authenticated;` (`:133-136`).

**What it removes**: `workouts` (cascading to entries and sets), the caller's own `exercises`,
`auth.users` — and by cascade from `auth.users`, `profiles`
(`20260810063450_…:12`) and the three log tables (`20260811005248_…:28,53,80`).

**What it does not remove**: `auth.audit_log_entries`. Verified negatively — the string appears in
**no migration and no source file**, only in `AGENTS.md:584`, `README.md` and the account-deletion
change folder. The address survives in the provider's audit log with no link back.

**Null `auth.uid()` raises** rather than matching zero rows. Note the trap the suite already records
(`account-deletion.test.ts:310-323`): errcode `42501` alone does **not** distinguish "no EXECUTE
grant" from "null uid inside the function", so the assertion checks the **message**
(`expect(error?.message).toContain("permission denied for function")`).

**Can a browser suite rely on it for cleanup? Yes — with three conditions.** The mechanism needs no
cookie: `tests/integration/account-deletion.test.ts:185-191` does exactly this in teardown —

```ts
for (const account of created) {
  await account.client.rpc("delete_own_account");
}
```

with a plain `createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })`
that has signed in; supabase-js attaches the bearer token itself. Conditions:

1. **the account must live in `gymlog-test`** — which is the whole of the blocking question. An
   account created through `astro dev` lands in **production** and this cannot clean it up;
2. **the harness must know the password.** Reuse `GYMLOG_TEST_PASSWORD` or the account is
   unrecoverable — `auth.admin.deleteUser` needs `service_role`, which is forbidden here;
3. **a red run leaks accounts.** `account-deletion.test.ts:18-24` names this: when the function is
   broken, teardown is broken too, "so a red run leaks accounts exactly when it fails, which is the
   opposite of the usual failure mode." Per-run addresses must therefore carry a greppable mark.

**Signup returns a session on `gymlog-test`** (confirmation off) and this is pinned in three places,
primarily `tests/integration/auth-flows.test.ts:75-81`. Two secondary guards throw with an explicit
message (`account-deletion.test.ts:90-94`, `account-boundary.test.ts:171-176`).

**Residue a later run can trip over**: `s01-signup-*` and `s01-absent-*` from `auth-flows` are
**never** deleted (no `afterAll`); each signup adds a `profiles` row via the
`on_auth_user_created` trigger until the account is removed; re-registering the same address makes a
**new** account that must be deleted again; and there is an unmeasured signup rate-limit budget that
a second concurrent runner would eat into.

### 9. Fixture discipline, and what a new browser suite must do

**Marks currently in use** (verified by grep — and two in-code comments are wrong):

`s01-signup-`, `s01-absent-`, **`s02-`**, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`,
`s05m-`, `s06-`, `s07-`, `s08-`, `s09i-`, `s09d-`.

> **Correction to land in code:** `account-boundary.test.ts:57-59` says "ten marks" and
> `account-deletion.test.ts:26-28` says "eleven marks in use". **Both omit `s02-`**, which
> `exercises-rls.test.ts:94` really uses via the literal `"s02-%"`. Anyone picking a new mark from
> those comments is working from a short list.

The collision rule is stated best at `weekly-tonnage.test.ts:11-14`: a mark must be **neither a
prefix of, nor prefixed by, an existing one**, because cleanup is `LIKE '<MARK>%'` — which is why
`s03-` already deletes two other suites' fixtures, benign only because `fileParallelism: false`
orders them.

**Permanent shared fixtures that must never be deleted or mutated**:
`rls-owner-a@gymlog-test.dev` (12 suites), `rls-owner-b@gymlog-test.dev` (9 suites),
`s09i-a@`, `s09i-b@`, `s09i-signout@gymlog-test.dev` (`account-boundary.test.ts:101-105`).

**`fileParallelism: false` (`vitest.integration.config.ts:37`) serialises files inside one Vitest
process and nothing more.** A separate runner started alongside breaks at least five things:

1. **shared `profiles` rows** — `preferences-derive` and `profile-mutations-rls` flip
   `weight_unit`/`estimation_formula` on `rls-owner-a`, while `workout-endpoints` asserts a new set is
   stamped `"kg"`. A browser test logging a set as that account inside the window reads `lb`;
2. **date-range aggregation** — `weekly-tonnage.test.ts:3-9`: the suite protects itself with a 2025
   anchor, not a mark, so **anything logged around today lands in its totals**. A browser test
   creating a workout dated today on a shared account falsifies them;
3. **seeded-catalogue counts** — `exercises-rls` and `account-deletion.test.ts:235` both assert 38;
4. **`sweep()` in `beforeAll`** — `account-boundary.test.ts:286-295`, `exercises-rls.test.ts:92-95`
   delete `LIKE '<MARK>%'` at start-up, so a colliding mark is destroyed mid-run;
5. **the CI concurrency group does not extend automatically** — `group: gymlog-test-fixtures` /
   `cancel-in-progress: false` is declared in `.github/workflows/ci.yml:18-20` only. A new workflow
   must **join that group by name** or it reintroduces the race the group exists to prevent.

**What a new browser suite must therefore do**: its own per-run account (created and deleted via
`delete_own_account()`), its own non-colliding mark, its own dates outside any shared window, no read
or write against `rls-owner-a/b` or any `s09i-` address, and — if it runs in CI — membership of
`gymlog-test-fixtures`. `account-boundary.test.ts`'s "own fixed pool + sweep in setup" is the closest
existing model; note its stated reason for a fixed pool
(`account-boundary.test.ts:67-75` — "nothing in this repository can delete an `auth.users` row") is
**now obsolete**, and `account-deletion.test.ts:14-15` says so. A new suite has the per-run option
that `account-boundary` did not.

**CI as it stands** (`.github/workflows/ci.yml`): ten steps; `npm run test:integration` receives
`SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY`, `GYMLOG_TEST_PASSWORD` and nothing else; `typecheck` and
`build` receive the production pair and no test credential. **No step holds a database credential and
there is no browser step.**

---

## Risk-by-risk verdict on the response guidance

| Risk | Guidance | Verdict |
| --- | --- | --- |
| **#2** | "After a real sign-in as B, a request naming A's identifier returns no data, and A's row reads back untouched as A"; challenge "thirteen integration suites already prove this — they prove it at the client-library layer, not through a cookie"; avoid asserting the status code only | **CORRECT in substance, wrong in the count (15 files, not 13).** The challenge is verified exactly: zero test lines touch `@supabase/ssr`, a cookie, or `src/middleware.ts`. **But "e2e" is the wrong cheapest layer** — the uncovered code is `middleware.ts:18-30` and `lib/supabase.ts:12-26`, all of which is drivable in-process (Option A). A browser adds a cookie **jar**, not a cookie. |
| **#3** | "Signing out ends access: returning to a protected route requires authenticating again before any data is shown"; challenge "a redirect happened is not the session stopped working"; avoid asserting the destination URL without attempting a data read | **CORRECT and well aimed.** Grounded at `middleware.ts:32-40` and `signout.ts:3-12`. Add the third state the guidance does not name: **stale/expired** cookie, distinct from cleared, and the row that must not silently behave like a valid one (§5 table). **Add a locator warning**: there is no sign-out control on `/workouts` at all. Same layer note as #2 — Option A reaches it. |
| **#4** | "A person completes the full flow — sign up, create a workout, log a set, see its estimate — in a real browser"; challenge "the HTML rendered is not it can be used"; avoid asserting an element is present instead of the effect of interacting with it | **CORRECT, and the only risk that genuinely needs a browser** (every island is `client:load`; a hydration failure is invisible to all three existing runners). Two corrections: the estimate only renders as a **number** for 1–12 reps at positive weight (`WorkoutDetail.tsx:545-562`), so the flow must be specified at that boundary; and **"unusable at a phone width" from the §2 risk text has no home in the response row** — it should be named as an explicit gap rather than assumed covered by the flow. |

**Hot-spot evidence check.** The named directories (`src/`, `src/lib/services/`, `supabase/`,
`tests/`) are likelihood evidence and were treated as such. One is actively misleading for this
phase: **`src/lib/services/` — 53 changes/30d — is the churn hot spot but is the layer these three
risks do NOT live in.** The code behind #2 and #3 is `src/middleware.ts` and `src/lib/supabase.ts`,
two files that are small, stable, and touched rarely — and that is *why* they are untested, not
evidence that they are safe. Churn-weighted likelihood points away from the real gap here.

**Speculative-risk check.** Nothing in #2/#3/#4 was found speculative. The reverse turned up: risk #4
is understated, because the browser-invisible half (a control unusable at a phone width) has no
proposed layer at all, and `#2`'s "abuse scenario" framing is *narrower* than the true gap — the
uncovered step is identity **derivation**, which is an availability and correctness risk as much as
an abuse one.

---

## Corrections to backport

**To `context/foundation/test-plan.md`:**

1. **§2 Risk Response Guidance, row #2** — "Thirteen integration suites" → fifteen, or drop the
   number. A bare count invites the same wrong "correction" the `0.45359237` bullet in `AGENTS.md`
   warns about.
2. **§2 rows #2 and #3, "Likely cheapest layer"** — `e2e` → `integration (in-process middleware +
   real cookie)`, with e2e reserved for #4. The evidence is §6: the uncovered code is reachable
   without a browser.
3. **§2 row #4** — add the phone-width half as an explicit uncovered gap, and pin the estimate
   assertion to the 1–12-rep/positive-weight boundary.
4. **§3 Phase 2's opening paragraph** — it is confirmed, and should be strengthened with the two
   mechanical facts: `.dev.vars` wins because the adapter `Object.assign`s it over `process.env`
   (`@astrojs/cloudflare/dist/index.js:292-303`) and Vite applies `process.env` last
   (`vite/.../config.js:9417-9418`); and **the build output is aimed at production too**, via an
   emitted `dist/server/.dev.vars`.
5. **§5 Quality Gates, "e2e on the critical flow | CI on PR"** — add that any such job must join
   `gymlog-test-fixtures` (already implied by the closing sentence of §5, but the browser row is the
   one that will forget).
6. **§6.4** — the sentence "Do not drive it over HTTP against the dev server" is **correct**; add the
   file:line so the next reader does not have to re-derive it.

**To `AGENTS.md` (§ Cloudflare traps) — new, not currently recorded anywhere:**

7. **`npm run build` writes the production Supabase credentials to `dist/server/.dev.vars`**, and
   `astro preview` / `wrangler dev` on the build output read them from there rather than from the
   repository root. Emitted by `@cloudflare/vite-plugin` (`index.mjs:83194-83201`). `dist/` is
   gitignored and `.assetsignore` keeps it off the CDN, so nothing leaks — but any harness pointed at
   the build output inherits production silently.
8. **Narrow the "`wrangler dev` is legacy" sentence** (`AGENTS.md:517-519`) to the dev loop, which is
   what it means. It does not, and should not, foreclose running the **built** worker under wrangler
   as a test harness — the credential resolution genuinely differs (dev inlines; the build defers to
   the runtime env, proven at `dist/server/chunks/server_Cs1d2reD.mjs:146-165`).

**To the integration suites (code comments):**

9. `account-boundary.test.ts:57-59` ("ten marks") and `account-deletion.test.ts:26-28` ("eleven marks
   in use") both **omit `s02-`**, which `exercises-rls.test.ts:94` uses.
10. `account-boundary.test.ts:67-75` justifies its permanent account pool with "nothing in this
    repository can delete an `auth.users` row", which `delete_own_account()` made false on the same
    day. `account-deletion.test.ts:14-15` already notes this; the claim should be corrected where it
    lives.

---

## Code References

**The credential chain**

- `astro.config.mjs:17-22` — both fields `access: "secret"`, `optional: true`
- `src/lib/supabase.ts:9-11` — `null` when either is absent (the documented silent-failure mode)
- `node_modules/@astrojs/cloudflare/dist/index.js:292-303` — `Object.assign(process.env, .dev.vars)`
- `node_modules/vite/dist/node/chunks/config.js:9417-9418` — `process.env` applied last in `loadEnv`
- `node_modules/astro/dist/env/vite-plugin-env.js:86-88,151-155` — inline in dev, `_getEnv` at build
- `node_modules/astro/dist/env/env-loader.js:38-46` — `loadEnv(mode, vite.envDir ?? root, "")`
- `node_modules/astro/dist/env/runtime.js:4-9` — `_getEnv` default and `setGetEnv`
- `node_modules/@astrojs/cloudflare/dist/utils/handler.js:11,15` — `setGetEnv(createGetEnv(globalEnv))`
- `dist/server/chunks/server_Cs1d2reD.mjs:146-165` — **empirical**: the built worker reads at runtime
- `node_modules/@cloudflare/vite-plugin/dist/index.mjs:83194-83201` — emits `dist/server/.dev.vars`
- `node_modules/wrangler/wrangler-dist/cli.js:255334-255388` — `.dev.vars` overwrites `vars`/`--var`
- `node_modules/wrangler/wrangler-dist/cli.js:255413` — `.dev.vars.<env>` **replaces** `.dev.vars`
- `node_modules/wrangler/wrangler-dist/cli.js:255351-255360, 52362-52368` — the process-env fallback
- `vitest.integration.config.ts:9-24` — the subtractive allowlist

**The session and boundary path**

- `src/middleware.ts:7,15,18,21,23-30,32-40`
- `src/lib/supabase.ts:12-26` — `getAll` / `setAll`
- `src/pages/api/auth/signout.ts:3-12`
- `src/pages/api/_shared/mutation-route.ts:17-18,35-37,42-58`
- `src/lib/services/workouts.ts:222-226,279-291`
- `src/pages/workouts/[id].astro:11-38`
- `tests/integration/workout-mutations-rls.test.ts:58-83,149-157,176-188`
- `tests/integration/profile-mutations-rls.test.ts:145-166`

**The browser surface**

- `src/pages/auth/{signin,signup}.astro`, `src/components/auth/{SignInForm,SignUpForm,PasswordToggle}.tsx`
- `src/components/workouts/{NewWorkoutForm,WorkoutHeader,WorkoutDetail,ExercisePicker,AddSetForm,EditSetForm}.tsx`
- `src/components/workouts/WorkoutDetail.tsx:545-562` — the estimate span
- `src/components/Topbar.astro:16-20`, `src/pages/dashboard.astro:307-314` — the only sign-out controls

**Lifecycle and fixtures**

- `supabase/migrations/20260815140000_delete_own_account.sql:89-137`
- `src/pages/api/account/index.ts:21-26,31-80`
- `src/lib/services/accounts.ts:24-26`
- `tests/integration/account-deletion.test.ts:11-24,85-96,185-191,310-323`
- `tests/integration/auth-flows.test.ts:75-81`
- `tests/integration/weekly-tonnage.test.ts:3-14`
- `.github/workflows/ci.yml:9-20,47-51`

## Architecture Insights

- **The repository already has the right instinct in the wrong shape.** `vitest.integration.config.ts`
  is subtractive; every option that "looks like it would work" for a server process is additive.
  Additive wins a precedence contest and loses silently when a flag is forgotten; subtractive fails
  loudly as an absent value. **This is the single criterion the plan should judge every option by.**
- **Dev and build resolve secrets by different mechanisms, and nothing in the documentation says so.**
  That one asymmetry is what turns the blocking question from "impossible" into "possible with a
  measurement", and it is exactly the kind of fact the repository normally writes down.
- **The gap behind risks #2 and #3 is smaller and closer than "e2e" implies.** Six or seven concrete
  lines of `src/middleware.ts` and `src/lib/supabase.ts` are unexecuted by every runner. A browser
  would cover them, but so would a suite that costs a config file — and the cheaper one is the rule
  the test plan opens with (§1 #1).
- **Absence of a credential is a loud failure for a test and a silent one for a human.** The
  `null`-returning `createClient` is documented as a trap; inside a browser suite it is a feature,
  because "cannot sign in" is a red test on the first step. Worth stating explicitly wherever the
  harness is built.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` § "The ORDER database-internal actions fire in is a fact about the
  catalogue — and reading the catalogue is still not measuring" — directly governs Options A and B:
  both rest on source reading and must be measured before any design is justified by them.
- `lessons.md` § "A hook that never fires and a hook that passes are the SAME observation" — the
  absence-assert on `dist/server/.dev.vars` must be proven by breaking it.
- `lessons.md` § "A `finally` that restores shared state does not survive a killed process" — why
  renaming `.dev.vars` for the duration of a run is not an option: a killed process leaves the
  machine broken.
- `lessons.md` § "'A user cannot do X yet' is not 'X is untested'" — applied here in reverse and it
  held: the suites were opened before concluding the cookie path is uncovered, and it is.
- `context/changes/account-deletion/` — `delete_own_account()`'s design and the measurement that
  disproved the `RESTRICT`-blocks-the-cascade assumption.
- `context/changes/cross-account-isolation/` — the trigger that closed the `exercise_id` hole, and
  the retired assertion 9 whose guarantee outlived it.

## Open Questions

1. **Does `astro:middleware` resolve under `getViteConfig` with `configFile: false`, outside Astro's
   container?** Option A depends entirely on this. `tests/render/` proves `astro:env/server` and the
   container work; the middleware module is untested from that direction.
2. **Do `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV` and `CLOUDFLARE_INCLUDE_PROCESS_ENV` behave as the
   installed wrangler source reads?** Option B depends on it. Read, not run.
3. **Does deleting `dist/server/.dev.vars` after a build leave `wrangler dev --config
   dist/server/wrangler.json` able to start?** Unverified.
4. **What is the signup rate limit on `gymlog-test`?** Per-run accounts in a browser suite add to a
   budget `account-deletion` already spends up to seven of per run, and nothing measures it.
5. **Is `catalogue` as an island prop on `/workouts/[id]` an instance of the "large collection"
   rule or an intended exemption?** Out of scope for this phase; it should not be resolved silently
   by a test that happens to depend on the current shape.
