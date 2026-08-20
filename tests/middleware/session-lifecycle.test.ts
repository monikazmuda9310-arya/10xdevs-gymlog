// THE THREE COOKIE STATES, AND BOTH DIRECTIONS OF THE REDIRECT.
//
// US-04's third criterion: signing out ends access, and returning to a protected route requires
// authenticating again **before any data is shown**. The redirect is the cheap half of that and the
// half every plausible-looking test asserts; the claim is the data read. `cookie-identity.test.ts`
// proves the middleware binds the RIGHT identity — this file proves it binds NONE when it should
// not, which is a different failure with a different cause.
//
// **The `setAll` → next-request-`getAll` round trip in `src/lib/supabase.ts:14-25` has never been
// executed by anything in this repository.** Assertion 2 is the first thing to run it: the cookies
// `signOut()` writes onto the recording `AstroCookies` double are applied to the live jar and sent
// back as the next request's `Cookie` header.
//
// **PRECISION ABOUT WHAT SIGNING OUT CAN AND CANNOT DO**, in the words `account-boundary.test.ts:449`
// already uses: an access token is a stateless JWT and stays cryptographically valid until it
// expires — `signOut` cannot recall one. What it ends is the SESSION, and what a browser then holds
// is a jar with the session cookie removed. So the claim asserted below is at the session level: the
// jar that survives a sign-out obtains no data. Anything stronger would be false.
//
// **MARK is `t2c-`**, shared with `cookie-identity.test.ts` and unique to this project (re-derive the
// repository's marks with `grep -rn "const MARK" tests/integration/` rather than trusting a list).
// **NO `LIKE` SWEEP ANYWHERE IN THIS PROJECT** — every account is per-run and is removed through
// `delete_own_account()` on a client that owns it. `rls-owner-a/b@` and every `s09i-` address are
// permanent shared fixtures and must never be passed to anything in this file.
//
// **TWO accounts, and the second exists for one reason.** Assertion 2 deliberately ends its
// account's session, and `signOut()`'s default scope is `global` — it revokes every refresh token
// the account holds, not just the one in the cookie. An assertion that inherited that account would
// be measuring the leftovers of another assertion rather than the middleware. This is the reason
// `account-boundary.test.ts:65-68` gives for its third account, applied here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { APIContext, AstroCookies } from "astro";

import type { Database } from "@/db/database.types";
import { listWorkouts } from "@/lib/services/workouts";
import { onRequest } from "@/middleware";
import { POST as signoutRoute } from "@/pages/api/auth/signout";

import { middlewareContext, type WrittenCookie } from "./_shared/context";
import { applyCookieWrites, cookieHeaderFrom, mintSessionCookies, type MintedSession } from "./_shared/session";

const MARK = "t2c-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface Account {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
  session: MintedSession;
  /** This account's own workout, carrying a run-unique note nothing else can produce. */
  note: string;
}

let url: string;
let key: string;
let password: string;

/** Assertions 1, 3, 4 and 5. Its session must still be live when they run. */
let account: Account;
/** Assertion 2 alone, because that assertion ends this account's session globally. */
let signedOut: Account;

const created: Account[] = [];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. This check must never skip its way to green.`);
  }
  return value;
}

/** A brand-new account for this run alone, its real session cookies, and one workout to look for. */
async function throwawayAccount(label: string): Promise<Account> {
  const email = `${MARK}${label}-${RUN_ID}@gymlog-test.dev`;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(`could not create ${email}: ${error.message}`);
  }
  if (!data.session) {
    throw new Error(
      `${email} was created without a session. Email confirmation has been switched on for ` +
        `gymlog-test, which breaks every suite that bootstraps an account without an inbox.`,
    );
  }

  const note = `${MARK}${label}-note-${RUN_ID}`;
  const workout = await client
    .from("workouts")
    .insert({ user_id: data.session.user.id, performed_on: TODAY, note })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`workout for ${email}: ${workout.error.code} ${workout.error.message}`);
  }

  const created_: Account = {
    client,
    userId: data.session.user.id,
    email,
    session: await mintSessionCookies(email, password),
    note,
  };
  if (created_.session.userId !== created_.userId) {
    throw new Error(`the minted cookie names ${created_.session.userId} but the account is ${created_.userId}`);
  }
  created.push(created_);
  return created_;
}

/** Drive the real middleware for one request and hand back what it derived. */
async function derive(requestUrl: string, cookieHeader?: string) {
  const harness = middlewareContext({ url: requestUrl, cookieHeader });
  const response = await onRequest(harness.context, harness.next);
  return { harness, response: response as Response };
}

interface ReadOutcome {
  /** Every note the read returned. Empty when it was refused. */
  notes: (string | null)[];
  /** The Postgres error, when the read was REFUSED outright rather than filtered to nothing. */
  refusal: { code: string; message: string } | null;
}

/**
 * Read this account's workouts through whatever client the middleware put on `locals`.
 *
 * **The user id is passed in explicitly and is the SAME in every call**, so the only thing that
 * differs between "the data is reachable" and "the data is not" is the cookie that produced the
 * client. `listWorkouts` is the read `/workouts` itself performs, not a query invented for this
 * suite.
 *
 * **A refusal is caught rather than thrown, because the two outcomes are both interesting and they
 * are not the same claim.** A signed-out caller is `anon`, and `anon` holds no `select` grant on
 * `workouts` at all (§ the table template in `context/foundation/access-control.md` — revoke, then
 * grant to `authenticated` only), so the read does not come back empty: it is refused at the GRANT
 * layer, one step before RLS would have filtered it. Measured, not assumed — assertion 2 pins the
 * SQLSTATE, so the day somebody widens that grant and turns a refusal into a filtered zero, this
 * suite says which of the two guarantees moved.
 */
async function readWorkoutNotes(locals: App.Locals, userId: string): Promise<ReadOutcome> {
  if (!locals.supabase) {
    throw new Error("locals.supabase is null — credentials are absent, which is a different failure");
  }
  try {
    const workouts = await listWorkouts(locals.supabase, userId);
    return { notes: workouts.map((workout) => workout.note), refusal: null };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return { notes: [], refusal: { code: code ?? "", message: message ?? String(error) } };
  }
}

/**
 * The slice of `APIContext` `POST /api/auth/signout` reads: the derived locals, a request whose
 * `Cookie` header names what is there to clear, somewhere to write the clears, and a redirect.
 *
 * **`cookies` must be the HARNESS's own recording double, not a fresh one.** A second double would
 * collect writes nothing else can see, and every assertion below reads them back through
 * `harness.cookiesWritten` — so the test would report a jar cleared while the real response carried
 * no `Set-Cookie` at all. `request` carries the live `Cookie` header for the same reason the route
 * needs it: `clearSessionCookies` clears the names that are actually present rather than guessing
 * how many chunks the payload was split into.
 */
function signoutContext(
  locals: App.Locals,
  redirectedTo: string[],
  jar: { cookies: AstroCookies; cookieHeader: string },
): APIContext {
  return {
    locals,
    params: {},
    cookies: jar.cookies,
    request: new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: { cookie: jar.cookieHeader },
    }),
    redirect(path: string) {
      redirectedTo.push(path);
      return new Response(null, { status: 302, headers: { Location: path } });
    },
  } as unknown as APIContext;
}

/**
 * What `supabase.auth.signOut()` is made to do.
 *
 * `"real"` doubles nothing and is what assertion 2 uses — so the success path and the two failure
 * paths below differ in **exactly one value**, and a comparison between them is a comparison of the
 * route rather than of two differently-built harnesses.
 */
type SignOutOutcome = "real" | { error: { message: string } | null } | "throw";

/**
 * The same `locals` the middleware derived, with `auth.signOut` — and nothing else — replaced.
 *
 * **Everything that decides the outcome stays real**: the client still closes over the harness's
 * `AstroCookies`, `clearSessionCookies` still reads the real request header, and the route is the
 * real route. What is doubled is one library call, because the failure under test is one this
 * project cannot provoke from outside — GoTrue answering `500` is not something a test may arrange.
 *
 * **Two outcomes, because the library has two.** `signOut()` resolves `{ error }` for an ordinary
 * auth failure and **re-throws** anything that is not an `AuthError` — the behaviour
 * `src/pages/api/account/index.ts:58-62` had to handle explicitly in its own copy of this call. A
 * route written as `if (error)` alone handles the first and lets the second escape as a generic
 * HTML 500, which the sign-out form cannot show.
 */
function withSignOutOutcome(locals: App.Locals, outcome: SignOutOutcome): App.Locals {
  const real = locals.supabase;
  if (!real) {
    throw new Error("locals.supabase is null — credentials are absent, which is a different failure");
  }
  // Nothing doubled at all: assertion 2's path, kept in this function so every caller below shares
  // one code path and differs only in this argument.
  if (outcome === "real") {
    return locals;
  }

  const supabase = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "auth") {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return new Proxy(target.auth, {
        get(auth, authProp, authReceiver) {
          if (authProp !== "signOut") {
            return Reflect.get(auth, authProp, authReceiver) as unknown;
          }
          return () =>
            outcome === "throw"
              ? Promise.reject(new TypeError("simulated non-AuthError failure inside signOut"))
              : Promise.resolve(outcome);
        },
      });
    },
  });

  return { ...locals, supabase };
}

/**
 * Drive the real sign-out route with a chosen `signOut` outcome, then replay what it wrote onto a
 * COPY of the live jar and ask what that jar can still reach.
 *
 * **The copy is not a detail.** `account.session.jar` is shared by assertions 1, 3, 4 and 5;
 * clearing it in place would leave three later assertions failing for a reason unrelated to the
 * code. And the writes are replayed ON TOP OF the live jar rather than alone — with the writes
 * alone, a route that cleared nothing produces an empty header, the next request has no session,
 * and the assertion passes for exactly the wrong reason (`_shared/session.ts` § applyCookieWrites).
 */
async function signOutWith(subject: Account, outcome: SignOutOutcome) {
  const before = await derive("http://localhost/api/auth/signout", subject.session.cookieHeader);
  expect(before.harness.context.locals.user?.id).toBe(subject.userId);

  const redirectedTo: string[] = [];
  const response = await signoutRoute(
    signoutContext(withSignOutOutcome(before.harness.context.locals, outcome), redirectedTo, {
      cookies: before.harness.context.cookies,
      cookieHeader: subject.session.cookieHeader,
    }),
  );

  const cleared: WrittenCookie[] = before.harness.cookiesWritten;
  const surviving = applyCookieWrites(new Map(subject.session.jar), cleared);
  const after = await derive("http://localhost/workouts", cookieHeaderFrom(surviving));

  return { response, redirectedTo, cleared, after };
}

beforeAll(async () => {
  url = required("SUPABASE_TEST_URL");
  key = required("SUPABASE_TEST_KEY");
  password = required("GYMLOG_TEST_PASSWORD");

  account = await throwawayAccount("session");
  signedOut = await throwawayAccount("signout");
});

afterAll(async () => {
  // **Teardown signs in FRESH rather than reusing the account's own client.** Assertion 2 revokes
  // every refresh token `signedOut` holds, so the client that created it is no longer a client this
  // suite may rely on. Signing in again is the shape that works for both accounts, and it doubles as
  // proof the account was still there to be removed.
  for (const subject of created) {
    const owner = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await owner.auth.signInWithPassword({ email: subject.email, password });
    if (signInError) {
      throw new Error(`could not sign ${subject.email} back in to remove it: ${signInError.message}`);
    }
    const { error } = await owner.rpc("delete_own_account");
    if (error) {
      throw new Error(`could not remove ${subject.email}: ${error.code} ${error.message}`);
    }
  }

  // **Proven from outside, not assumed.** Nothing here can read `auth.users`, and a leaked per-run
  // account is invisible until somebody counts addresses in the dashboard months later — this
  // project has no `LIKE` sweep to clean one up with, deliberately.
  for (const subject of created) {
    const probe = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await probe.auth.signInWithPassword({ email: subject.email, password });
    if (data.session) {
      throw new Error(`${subject.email} still signs in after teardown — the account was not removed.`);
    }
  }
});

describe("the three cookie states", () => {
  it("1. a live cookie reaches the page, and the account's own training is reachable through it", async () => {
    // **The positive control the other two states are measured against.** Without it, "no data" says
    // nothing about whether data was ever obtainable through this path at all — a broken read and a
    // refused read produce the same empty list.
    const live = await derive("http://localhost/workouts", account.session.cookieHeader);

    expect(live.harness.context.locals.user?.id).toBe(account.userId);
    expect(live.harness.redirectedTo).toEqual([]);
    expect(live.harness.reachedNext).toEqual(["/workouts"]);
    expect(live.response).toBe(live.harness.nextResponse);

    const reachable = await readWorkoutNotes(live.harness.context.locals, account.userId);
    expect(reachable.refusal).toBeNull();
    expect(reachable.notes).toContain(account.note);
  });

  it("2. after signing out, the surviving jar is redirected AND obtains no training", async () => {
    // `/api/auth/signout` is in neither route array, so the middleware derives and hands on. The
    // client it builds closes over the harness's recording `AstroCookies`, which is how the
    // `setAll` the route triggers is observable at all. `"real"` doubles nothing — this assertion
    // drives the genuine library call, and assertions 6 and 7 reuse this exact path with only that
    // argument changed.
    const { response, redirectedTo, cleared, after } = await signOutWith(signedOut, "real");
    expect(response.status).toBe(302);
    expect(redirectedTo).toEqual(["/auth/signin"]);

    // **THE CLAIM, AND FIRST BECAUSE IT IS THE CLAIM.** The redirect is what a screen shows; this
    // is whether the training was still reachable. Same read, same user id, same service — only the
    // cookie differs from assertion 1.
    //
    // **The order was measured, not chosen** (`lessons.md` § "A mutation that fails for the WRONG
    // REASON has not confirmed the guard"). With `signout.ts` made to skip `supabase.auth.signOut()`
    // this test went red three different ways depending on where this read sat: on the cookie name
    // when that check led, then on `locals.user` when the redirect block led — both true, both
    // weaker, and both leaving the read UNEXECUTED. US-04's criterion is about data, so the data
    // read has to be the line the mutation lands on.
    const gone = await readWorkoutNotes(after.harness.context.locals, signedOut.userId);
    expect(gone.notes).not.toContain(signedOut.note);
    expect(gone.notes).toEqual([]);
    // And refused a step EARLIER than RLS: `anon` has no `select` grant on `workouts`, so the read
    // never reaches a policy. `42501` is `insufficient_privilege`. Pinned rather than left as "it
    // came back empty", because those are two different guarantees and only one of them is what
    // actually happened here.
    expect(gone.refusal?.code).toBe("42501");

    // The cheap half, kept because a redirect is what the person actually experiences.
    expect(after.harness.context.locals.user).toBeNull();
    expect(after.response.status).toBe(302);
    expect(after.response.headers.get("Location")).toBe("/auth/signin");
    expect(after.harness.redirectedTo).toEqual(["/auth/signin"]);
    expect(after.harness.reachedNext).toEqual([]);

    // Last, and diagnostic rather than load-bearing: it names the write the round trip is made of,
    // so a reader who has just seen the read fail knows whether anything was cleared at all.
    expect(cleared.map(({ name }) => name)).toContain(signedOut.session.storageKey);
  });

  it("3. no cookie at all is redirected from a workout id, and never reaches the page", async () => {
    // **Prefix semantics, asserted rather than assumed.** `PROTECTED_ROUTES` carries the single
    // entry `/workouts` (`middleware.ts:7`) and the check is `startsWith`, so `/workouts/<id>` — the
    // deepest training data in the product — is behind authentication because of that one string.
    const deep = `http://localhost/workouts/${crypto.randomUUID()}`;
    const anonymous = await derive(deep);

    expect(anonymous.harness.context.locals.user).toBeNull();
    expect(anonymous.response.status).toBe(302);
    expect(anonymous.response.headers.get("Location")).toBe("/auth/signin");
    // "Redirected" and "rendered, then redirected" are different facts about the system, and only
    // this tells them apart: a page that ran and was then thrown away has already read the data.
    expect(anonymous.harness.reachedNext).toEqual([]);
  });
});

// A SIGN-OUT THE PROVIDER REFUSES — the one operation in `src/` that used to report success without
// looking (`signout.ts:8`, `await supabase.auth.signOut()` with the result discarded).
//
// **Why the discard mattered.** `@supabase/auth-js`'s `_signOut` has two early returns ahead of
// `_removeSession()` — one for a session error, one for any `admin.signOut()` failure that is not
// 404/401/403 — and `_removeSession()` is the ONLY thing that drives the `setAll` in
// `src/lib/supabase.ts:20-24`. On either early return the cookie survives. The route redirected to
// `/auth/signin` regardless, `middleware.ts:38-40` saw a live `locals.user` on an `AUTH_ROUTE`, and
// the user landed back on `/dashboard` — a UI glitch in appearance, an unended session on a shared
// machine in fact.
//
// **Retrying with `{ scope: "local" }` would not have helped**: `admin.signOut(accessToken, scope)`
// is called BEFORE the `scope !== 'others'` branch, so it makes the same network call and dies at
// the same early return. Read from the installed library on 2026-08-20, not inferred.
//
// **These two assertions are the whole reason this seam has a test at all**, and neither could be
// written anywhere else: an integration suite hands a handler a hand-built `locals` whose client and
// user id agree by construction, so it cannot ask what a surviving cookie still reaches.
describe("a sign-out the provider refuses", () => {
  it("6. { error } still ends the session on this device, and the destination says so", async () => {
    const failed = await signOutWith(account, { error: { message: "simulated GoTrue 500" } });

    // **THE CLAIM, AND FIRST BECAUSE IT IS THE CLAIM** (`lessons.md` § "The assertion carrying the
    // claim goes FIRST"). US-04's third criterion is about DATA — returning must require
    // authenticating again — so the load-bearing line is the read, not the redirect. Written in
    // narrative order, a route that cleared nothing would redden on the cookie name or on
    // `locals.user` first and leave this read unexecuted, which is how assertion 2 was measured.
    const gone = await readWorkoutNotes(failed.after.harness.context.locals, account.userId);
    expect(gone.notes).not.toContain(account.note);
    expect(gone.notes).toEqual([]);
    // Refused at the GRANT layer, one step before RLS would have filtered — the same distinction
    // assertion 2 pins, and for the same reason: "came back empty" and "was refused" are two
    // different guarantees.
    expect(gone.refusal?.code).toBe("42501");

    // **No session survives, so `AUTH_ROUTES` has nothing to bounce.** This is what makes the
    // message reachable at all: with the cookie left live, `middleware.ts:38-40` would redirect the
    // next request to `/dashboard` and the sentence would never be seen by anybody.
    expect(failed.after.harness.context.locals.user).toBeNull();

    // **The DESTINATION is the signal, because the status is not.** A redirect-shaped endpoint
    // answers `302` whether it worked or not, which is exactly why "a failed operation answers
    // non-2xx" would have scored this defect as passing (`test-plan.md` §2, corrected 2026-08-20).
    expect(failed.response.status).toBe(302);
    expect(failed.redirectedTo).toEqual(["/auth/signin?error=sign_out_failed"]);

    // **POSITIVE CONTROL, in the same test.** Without it, an implementation that appends the code
    // unconditionally satisfies every line above. It asserts the destination ALONE on purpose: the
    // doubled success never reaches `_removeSession`, so it clears nothing — proving the clearing
    // is assertion 2's job, with the real library call.
    const succeeded = await signOutWith(account, { error: null });
    expect(succeeded.redirectedTo).toEqual(["/auth/signin"]);

    // **The one thing the jar simulation cannot see, asserted directly.** `applyCookieWrites` drops
    // a cookie on `value === ""` OR `maxAge === 0` and models no `path` at all — so a clear written
    // with the wrong path would satisfy every assertion above while a real browser kept the cookie.
    // `@supabase/ssr` removes with `{ ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 }`, and
    // `DEFAULT_COOKIE_OPTIONS.path` is `"/"` (read from
    // `node_modules/@supabase/ssr/dist/main/utils/constants.js`, 2026-08-20).
    const clear = failed.cleared.find(({ name }) => name === account.session.storageKey);
    expect(clear).toBeDefined();
    expect(clear?.value).toBe("");
    expect(clear?.options).toMatchObject({ path: "/", maxAge: 0 });
  });

  it("7. a signOut that THROWS is treated identically, not left to escape as a 500", async () => {
    // **Two failure shapes, because the library has two.** `signOut()` resolves `{ error }` for an
    // ordinary auth failure and re-throws anything that is not an `AuthError` — stated at
    // `src/pages/api/account/index.ts:58-62`, where the same call is handled correctly. A route
    // written as `if (error)` alone passes assertion 6 and lets this one escape: Astro answers a
    // generic HTML 500 for a form POST, so the user sees a browser error page instead of a sign-in
    // screen, and the cookie is never cleared.
    const failed = await signOutWith(account, "throw");

    // Same claim, same order, same reason as assertion 6.
    const gone = await readWorkoutNotes(failed.after.harness.context.locals, account.userId);
    expect(gone.notes).not.toContain(account.note);
    expect(gone.notes).toEqual([]);
    expect(gone.refusal?.code).toBe("42501");

    expect(failed.after.harness.context.locals.user).toBeNull();
    expect(failed.response.status).toBe(302);
    expect(failed.redirectedTo).toEqual(["/auth/signin?error=sign_out_failed"]);

    // Shares assertion 6's `{ error: null }` control by construction — both shapes reach the same
    // branch, so one demonstration that the code is not appended unconditionally covers both.
    expect(failed.cleared.map(({ name }) => name)).toContain(account.session.storageKey);
  });
});

describe("the redirect runs in both directions", () => {
  it("4. a signed-in visitor is sent away from the auth forms, and left on confirm-email", async () => {
    // Testing only the direction that keeps people out leaves `AUTH_ROUTES` unguarded, and its
    // failure mode is a loop: signup with confirmation on returns no session, and a visitor bounced
    // off the page explaining what to do next has nowhere to go.
    for (const path of ["/auth/signin", "/auth/signup"]) {
      const bounced = await derive(`http://localhost${path}`, account.session.cookieHeader);
      expect(bounced.harness.context.locals.user?.id).toBe(account.userId);
      expect(bounced.response.status).toBe(302);
      expect(bounced.response.headers.get("Location")).toBe("/dashboard");
      expect(bounced.harness.redirectedTo).toEqual(["/dashboard"]);
      expect(bounced.harness.reachedNext).toEqual([]);
    }

    // **`/auth/confirm-email` is deliberately in NEITHER array** (`middleware.ts:9-15`). Tidying it
    // into `AUTH_ROUTES` reads as consistency and is the regression this line exists to catch.
    const allowed = await derive("http://localhost/auth/confirm-email", account.session.cookieHeader);
    expect(allowed.harness.redirectedTo).toEqual([]);
    expect(allowed.harness.reachedNext).toEqual(["/auth/confirm-email"]);
    expect(allowed.response).toBe(allowed.harness.nextResponse);
  });
});

describe("the branch a Worker deployed without runtime secrets takes", () => {
  it("5. with credentials absent the client is null, the user is null, and every protected route redirects", async () => {
    // **Why this is a guard and not decoration.** `wrangler secret put` is a step separate from the
    // build, GitHub's repository secrets are build-time only, and a Worker missing both variables
    // builds, deploys and answers 200 while nobody can sign in (`AGENTS.md` § Cloudflare traps,
    // risk #7). It is also the behaviour the browser harness RELIES on: if its launcher is bypassed
    // the variables are absent rather than wrong, which turns a silent production write into a red
    // first step. That property is only true if this branch does what it claims.
    //
    // **What is doubled here, said plainly.** `astro:env/server` is resolved at config time and
    // inlined, so its values cannot be changed inside a running worker — the module is replaced for
    // the length of this test and the module graph under it re-imported. Real: `createClient`,
    // `onRequest`, both route arrays, the whole null branch. Doubled: two string constants. The cost
    // is that this assertion cannot notice the env SCHEMA changing shape, only the branch behaviour.
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: undefined, SUPABASE_KEY: undefined }));

    try {
      const { createClient: createUnconfigured } = await import("@/lib/supabase");
      const { onRequest: unconfiguredOnRequest } = await import("@/middleware");

      const probe = middlewareContext({
        url: "http://localhost/dashboard",
        cookieHeader: account.session.cookieHeader,
      });
      expect(createUnconfigured(probe.context.request.headers, probe.context.cookies)).toBeNull();

      const response = (await unconfiguredOnRequest(probe.context, probe.next)) as Response;

      expect(probe.context.locals.supabase).toBeNull();
      expect(probe.context.locals.user).toBeNull();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/signin");
      expect(probe.reachedNext).toEqual([]);
      // Note which cookie was sent: `account`'s LIVE, valid one — the same header assertion 1 rides
      // to the page. It bought nothing here, so the redirect is caused by the absent credential and
      // not by the visitor. That is the failure that is loud for a suite and silent for a human.
    } finally {
      vi.doUnmock("astro:env/server");
      vi.resetModules();
    }
  });
});
