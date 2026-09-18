"use client";

import { createContext, useContext } from "react";

// The document open in the reader, for controls that live in the tray and
// need it: the voice command (SPEC.md §6) reads the open document. Null on
// the notes full page, where no document is open.
const OpenDocumentContext = createContext<string | null>(null);

export function OpenDocumentProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return <OpenDocumentContext.Provider value={value}>{children}</OpenDocumentContext.Provider>;
}

export function useOpenDocument(): string | null {
  return useContext(OpenDocumentContext);
}
