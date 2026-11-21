// The app's sign-in handoff (SPEC.md §33, lib/app-handoff.ts) against the
// database: a handoff redeems once, only with its verifier, only in time,
// and the email routes' tokens and the handoff's never stand in for each
// other.
//
//   npx tsx scripts/qa/app-handoff-check.ts [--keep]
//
// --keep leaves one fresh handoff and prints its token and verifier, for a
// call of /api/auth/app/finish by hand.
import { randomBytes } from "node:crypto";
import { challengeOf, createAppHandoff, redeemAppHandoff, validChallenge } from "@/lib/app-handoff";
import { confirmEmailToken } from "@/lib/auth";
import { db } from "@/lib/db";

// The handoff is off until the owner turns it on (lib/app-handoff.ts).
const EMAIL = "handoff-check@test.local";
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

async function main() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = challengeOf(verifier);
  check("a challenge is 43 base64url characters", validChallenge(challenge));
  check("a challenge of another shape is refused", !validChallenge("abc") && !validChallenge(`${challenge}=`));

  let token = await createAppHandoff(EMAIL, challenge);
  delete process.env.APP_SIGNIN;
  check("with the switch off nothing redeems", (await redeemAppHandoff(token, verifier)) === null);
  process.env.APP_SIGNIN = "on";
  check("with the switch off the handoff was not used up", (await db.emailConfirmation.count({ where: { email: EMAIL, purpose: "app" } })) === 1);
  check("a wrong verifier redeems nothing", (await redeemAppHandoff(token, randomBytes(32).toString("base64url"))) === null);
  check("the email routes refuse a handoff token", (await confirmEmailToken(token, "signup")) === null);
  check("the right verifier redeems the email", (await redeemAppHandoff(token, verifier)) === EMAIL);
  check("a handoff redeems once", (await redeemAppHandoff(token, verifier)) === null);

  token = await createAppHandoff(EMAIL, challenge);
  await db.emailConfirmation.updateMany({ where: { email: EMAIL, purpose: "app" }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("an expired handoff redeems nothing", (await redeemAppHandoff(token, verifier)) === null);

  const first = await createAppHandoff(EMAIL, challenge);
  const second = await createAppHandoff(EMAIL, challenge);
  check("a new handoff replaces the one before it", (await redeemAppHandoff(first, verifier)) === null);
  check("the new handoff redeems", (await redeemAppHandoff(second, verifier)) === EMAIL);

  if (process.argv.includes("--keep")) {
    await db.user.upsert({ where: { email: EMAIL }, update: {}, create: { email: EMAIL, name: "Handoff check" } });
    const kept = await createAppHandoff(EMAIL, challenge);
    console.log(`token=${kept}\nverifier=${verifier}`);
  } else {
    await db.emailConfirmation.deleteMany({ where: { email: EMAIL, purpose: "app" } });
  }
  console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
