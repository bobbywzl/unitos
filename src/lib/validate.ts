import { NextResponse } from "next/server";
import type { z } from "zod";

type Parsed<T> = { data: T; error: null } | { data: null; error: NextResponse };

// Parse and Zod-validate a JSON request body. Every API route body goes through this.
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { data: null, error: NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 }) };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      data: null,
      error: NextResponse.json({ error: "Validation failed", issues: result.error.issues }, { status: 400 }),
    };
  }
  return { data: result.data, error: null };
}
