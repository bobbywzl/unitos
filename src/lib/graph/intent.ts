// The intent of a Stitch command (SPEC.md §22, STITCH_INDEX): which reading
// path it needs. A rule on the command's words, like commandKind: it runs
// before any pass and costs nothing.
//   followup — a command about the last answers, answerable from the blocks
//              they cited (the back selection; refersBack and not asksMore)
//   links    — draw links, or find the contradictions
//   page     — write or gather a page
//   holistic — no topic narrower than the project or than whole documents:
//              an overview, what each document argues, what changed between
//              two versions, what is still open, what the texts share
//   meta     — about the reader's replies or the links in the graph, which
//              Stitch cannot read (one sentence)
//   fact     — everything else: a question with a topic the index can find,
//              in one document or across them
// The targeted path (the index, then the select pass over the candidates'
// text) serves fact; holistic, links and page keep the skeleton read; a
// followup keeps the back selection.

import { asksMore, refersBack } from "@/lib/prompts/stitch";
import type { StitchCommandKind } from "@/lib/types";

export type StitchIntent = "fact" | "holistic" | "links" | "page" | "followup" | "meta";

// A command shaped as a question: a question word first, or a question mark
// at the end, and no imperative to draw, connect, link, list or find.
const QUESTION_HEAD = /^(?:why|what|which|how|does|do|did|is|are|was|were|when|where|who|whom|whose|can|could|has|have|should)\b/i;
const IMPERATIVE_LINK = /\b(?:draw|connect|link|list|find|propose|add|make)\b|画出|找出|列出|连接/i;
// A question that asks which claims or passages disagree wants the links
// drawn ("Which dates contradict each other?", "有哪些说法与其他文档不符？");
// one that asks whether some other document disagrees with a point wants
// an answer ("Does any other document disagree with the claim that pity
// preserves what should perish?": the question word is "does").
const WHICH = /^(?:which|what)\b|哪些|哪个|什么/i;
// The reader's replies, the replies on a link, the links in the graph. "The
// reply to Kant" and "the replies of Nietzsche's critics" are a text's
// replies, not a link's (ANS10-05).
const META = /\b(?:what did i reply|my repl(?:y|ies)\b|the repl(?:y|ies) (?:on|under) (?:(?:the|this|that|a|each|every|those|these) )?links?\b|already in the graph)\b|我的回复|链接的回复|已经在图/i;
// Holistic wording (ANS10-01): no topic narrower than the project. Two
// kinds. HOLISTIC is holistic on its own: an overview, the big picture,
// what is still open, what the texts share, what changed. THEMES — main
// threads, main themes, recurring themes — is holistic unless a topic
// follows it: "the main themes of pessimism" is a fact question, "the main
// threads of these documents" is not (THEMES_TOPIC).
const HOLISTIC =
  /\b(?:overview|big picture|common (?:threads?|ground)|what does each document argue|one line per document|(?:still|left|remains?|remaining) open|unanswered|what (?:has |have )?changed|changed (?:since|between|from)|from (?:the )?(?:first|v1|version 1) to|fit the sections|how do the documents differ|summar(?:y|ise|ize) (?:the|all|every|each) documents?|what do (?:all )?(?:these|those|the|the \w+|all the|all these) (?:texts|documents|papers|sources|books|essays) (?:share|have in common))\b|概述|总览|主要线索|主线|共同点|改了什么|有什么变化|还有什么没|没有解决|尚未解决|没有回答|未解决|尚未|反复出现的主题|大致的情况|整体情况/i;
const THEMES = /\b(?:main|recurring|central|major) (?:threads?|themes?|lines?|ideas?)\b/i;
const THEMES_TOPIC = /^\s+(?:of|in|about|on|regarding|concerning)\s+(?!(?:the |these |those |all |my |our |this |each |every |its )?(?:\w+ )?(?:documents?|texts?|sources?|papers?|library|project|collection|essays?|books?|readings?)\b)\S/i;
const EVERY_DOC = /\b(?:each|every|all(?: the| of the)?) documents?\b|各文档|每个文档|所有文档|全部文档/i;
const TOPIC = /\b(?:about|on|regarding|concerning|of)\s+\S|关于|对.{1,12}的/i;

/** True when the command's words are holistic (HOLISTIC, or THEMES with
    no topic after it): what makes commandIntent say holistic before the
    kind does, and what shares a cut's budget by document (lib/graph/stitch.ts
    overEvery). */
export function holisticWords(command: string): boolean {
  const c = command.trim();
  if (HOLISTIC.test(c)) return true;
  const m = THEMES.exec(c);
  return m !== null && !THEMES_TOPIC.test(c.slice(m.index + m[0].length));
}

/** The command's intent. `kind` is commandKind(command); `continued` is
    true when the command follows earlier turns of the conversation. */
export function commandIntent(command: string, continued: boolean, kind?: StitchCommandKind): StitchIntent {
  const c = command.trim();
  if (META.test(c)) return "meta";
  if (continued && refersBack(c) && !asksMore(c)) return "followup";
  const question = QUESTION_HEAD.test(c) || /[?？]\s*$/.test(c);
  if (kind === "links") {
    // "Does any other document disagree with the second point?" is a
    // question that names a disagreement, not a command to draw links.
    if (question && !IMPERATIVE_LINK.test(c) && !WHICH.test(c)) return "fact";
    return "links";
  }
  if (kind === "page") return "page";
  if (holisticWords(c)) return "holistic";
  if (EVERY_DOC.test(c) && !TOPIC.test(c.replace(EVERY_DOC, ""))) return "holistic";
  return "fact";
}
