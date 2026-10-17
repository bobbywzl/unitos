"use client";

import { memo } from "react";
import { Markdown } from "@/components/markdown";

// An answer's words render again only when they change: a key in a box, a
// streamed chunk of the next answer, or a card's move leaves the answers
// already on screen as they are (SPEC.md §7).
export const AnswerMarkdown = memo(Markdown);
