import { removeRunAccount } from "./_shared/account";

/**
 * Remove the run's single `t2e-` account, whether the specs passed or failed.
 *
 * It runs unconditionally, including on runs that never signed anybody up — `removeRunAccount()`
 * answers "nothing to remove" for those rather than failing, which costs one refused sign-in and
 * keeps the teardown from having to be told what the specs did. A teardown with a knob is a teardown
 * that can be left off.
 */
export default async function globalTeardown(): Promise<void> {
  // The teardown's only output IS its report: a cleanup that ran silently and a cleanup that never
  // ran are the same observation, so the line is the evidence.
  // eslint-disable-next-line no-console -- see above
  console.log(`e2e teardown: ${await removeRunAccount()}`);
}
