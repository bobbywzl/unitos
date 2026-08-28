"use client";

import { createContext, useContext } from "react";
import type { NotebookRole, Person } from "@/lib/person";

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
};

export const SOLO_COLLAB: CollabState = {
  authOn: false,
  role: "owner",
  canEdit: true,
  shared: false,
  myId: "",
  people: {},
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
