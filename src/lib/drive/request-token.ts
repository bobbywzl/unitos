import { authEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { driveAccess } from "@/lib/drive/config";
import { mintDriveAccessToken } from "@/lib/drive/link";
import { type DriveAccess, driveGrant } from "@/lib/drive/types";

// The Drive token a request spends (SPEC.md §14): the bearer token the client
// sent (a per-visit grant, or one minted for a linked account), else one
// minted here from the linked account's refresh token. What the token reaches
// — the stored grant, or the configured access a per-visit grant asked for —
// picks the message when Drive refuses a file. "" = no token to spend.
export async function requestDriveToken(
  req: Request,
  user: { id: string } | null,
): Promise<{ token: string; grant: DriveAccess }> {
  const authHeader = req.headers.get("authorization") ?? "";
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  let grant: DriveAccess = driveAccess();
  if (authEnabled() && user) {
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { driveRefreshToken: true, driveScope: true },
    });
    if (row?.driveRefreshToken) {
      // A linked account's token — on the request or minted here — reaches
      // what the stored grant reaches.
      grant = driveGrant(row.driveScope);
      if (!token) {
        // No per-visit grant on the request: mint from the linked account. A
        // revoked grant clears itself on the token route; here it just fails
        // the mint.
        const minted = await mintDriveAccessToken(row.driveRefreshToken);
        if (minted !== null && minted !== "revoked") token = minted.token;
      }
    }
  }
  return { token, grant };
}
