import { NextResponse } from "next/server";
import type { z } from "zod";
import { serverT } from "@/lib/i18n/server";

type Parsed<T> = { data: T; error: null } | { data: null; error: NextResponse };

// Parse and Zod-validate a JSON request body. Every API route body goes through this.
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  const t = await serverT();
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return {
      data: null,
      error: NextResponse.json({ error: t("api.bodyNotJson") }, { status: 400 }),
    };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      data: null,
      error: NextResponse.json(
        { error: t("api.validationFailed"), issues: result.error.issues },
        { status: 400 },
      ),
    };
  }
  return { data: result.data, error: null };
}
