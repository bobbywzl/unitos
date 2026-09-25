"use client";

import { createContext, useCallback, useContext } from "react";
import { useT } from "@/components/lang-provider";
import { isAssistantAuthor } from "@/lib/docs/assistant-suggestions";
import { assistantPerson, personOf, type NotebookRole, type Person } from "@/lib/person";
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
  // Billing (SPEC.md §24) is on: the Ultra message offers the plan page. Off
  // (the switch, or sign-in off), the message stands alone.
  billing: boolean;
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
  billing: false,
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

/** The person an author id names: an account, or the assistant (its
    suggestions' author). Without sign-in every other author is the local
    reader, named as the history names them. */
export function useAuthor(): (id: string) => Person | undefined {
  const { authOn, people } = useCollab();
  const t = useT();
  return useCallback(
    (id: string) =>
      isAssistantAuthor(id)
        ? assistantPerson(id, t("reader.assistant"))
        : (people[id] ?? (authOn ? undefined : personOf({ id, name: t("panes.historyYou"), symbol: "", color: "", picture: "" }))),
    [authOn, people, t],
  );
}
