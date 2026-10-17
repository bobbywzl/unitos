import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { checkGrammar } from "@/lib/grammar-check";
import { featureConfigured } from "@/lib/feature-models";
import { grammarRequestSchema } from "@/lib/grammar";
import { serverT } from "@/lib/i18n/server";
import { premiumActive } from "@/lib/tiers";
import { parseBody } from "@/lib/validate";

export const maxDuration = 60;

// The grammar check (SPEC.md §29, typing): the page editor and the note
// editor send the English paragraphs the reader wrote, a few at a time, and
// get back each paragraph's issues — the exact wrong words, the replacement,
// and why — with every issue whose words are not in the paragraph dropped.
// Nothing is stored and nothing changes the text: the reader accepts an
// issue on its card. A signed-in account on Unitos Premium or Ultra (an
// expired trial gets a 403); no model configured is a 503; a failed call is
// a 422.
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  if (!premiumActive(user)) return NextResponse.json({ error: t("api.grammarNeedsPremium") }, { status: 403 });
  const { data, error } = await parseBody(req, grammarRequestSchema);
  if (error) return error;
  if (!(await featureConfigured("grammar"))) {
    return NextResponse.json({ error: t("api.grammarNeedsKey") }, { status: 503 });
  }
  const answer = await checkGrammar(data.paragraphs, user.id, req.signal);
  if (!answer) return NextResponse.json({ error: t("api.grammarFailed") }, { status: 422 });
  return NextResponse.json(answer);
}
