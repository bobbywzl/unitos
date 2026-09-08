"use client";

import { createContext, useContext } from "react";
import type { NotebookRole, Person } from "@/lib/person";
import type { TierState } from "@/lib/tiers";

// Collaboration state of the open corpus, provided by the workspace and the
// notes full page. Components read the role to hide write affordances for
// viewers, and the people map to label notes and edits with their authors.
export type CollabState = {
  authOn: boolean; // sign-in configured; false = single reader, no sharing
  role: NotebookRole;
  canEdit: boolean; // role owner or editor
  shared: boolean; // the corpus has collaborators; author labels render
  myId: string;
  people: Record<string, Person>;
  // The account's tier state (TIERS.md, accountTier in lib/tiers.ts), for
  // the tier mark in the reader header. The local reader is Ultra.
  tier: TierState;
  // The trial's end as an ISO date, on a trial or after it; else null.
  trialEndsAt: string | null;
  // Unitos Premium (SPEC.md §17): offline work syncs when back online. The
  // local reader always has it — there is no account to gate.
  premium: boolean;
  // Unitos Ultra (TIERS.md): Visualize (SPEC.md §20) and tool conversations
  // (SPEC.md §21). The local reader always has it.
  ultra: boolean;
};

export const SOLO_COLLAB: CollabState = {
  authOn: false,
  role: "owner",
  canEdit: true,
  shared: false,
  myId: "",
  people: {},
  tier: "ultra",
  trialEndsAt: null,
  premium: true,
  ultra: true,
};

const CollabContext = createContext<CollabState>(SOLO_COLLAB);

export function CollabProvider({
  value,
  children,
}: {
  value: CollabState;
  children: React.ReactNode;
}) {
  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

export function useCollab(): CollabState {
  return useContext(CollabContext);
}
