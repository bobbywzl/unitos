// Auto thinking (SPEC.md §7): how hard the assistant thinks about a
// message, decided from the message itself when the reader leaves the
// choice to the assistant. A lookup, a one-block edit, or a confirmation
// runs at low effort; a question of meaning or a change to a part runs at
// the deep effort every answer used before the choice existed; a change
// across the document, a comparison across passages, a count or an absence
// over the whole material, or a message with several asks runs at the
// highest effort. The signals are words and shape, never a model call, so
// the choice costs nothing and the reader can see why in the usage log.
// Client-safe: no imports.

export type Depth = "low" | "medium" | "high" | "max";

export type DepthInput = {
  message: string;
  // The turns before this one.
  turns?: number;
  // Images and files attached to this message.
  attachments?: number;
  // Project scope reads every document; This page reads one.
  scope?: "document" | "notebook";
};

export type DepthChoice = { depth: Depth; signals: string[] };

const words = (text: string): number => {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  return text.replace(/[一-鿿]/g, " ").split(/\s+/).filter(Boolean).length + cjk;
};

// A confirmation of a proposed change, or a one-word reply.
const CONFIRMATION = /^\s*(yes|yes please|ok|okay|sure|go ahead|do it|ok do it|apply it|implement|implement it|confirm|please do|yes do it|好|好的|可以|同意|执行|就这样)[.!。！]?\s*$/i;

// A lookup: where, who, when, which, what is, how many of one thing.
const LOOKUP = /^\s*(where|who|when|which|what is|what's|what does|what did|how much|how long|找|在哪|谁|哪一?[个段句]|什么是|多少|何时)\b/i;

// A change to one place: highlight, bold, rename, delete the paragraph…
const ONE_PLACE = /\b(highlight|bold|italici[sz]e|underline|rename|delete the (paragraph|line|sentence|block)|remove the (paragraph|line|sentence|block)|move the (paragraph|line|sentence)|split|join|change ["“'])|高亮|加粗|删除这|改名|重命名|把["“]/i;

// A change across the document, or a reading across the material.
const WHOLE = /\b(whole|entire|throughout|across the|everywhere|document-wide|reorgani[sz]e|restructure|reorder|organi[sz]e|group by|put in order|proofread|translate the (whole|document|essay|article)|make the whole|rewrite the (whole|essay|document|article)|contradict|inconsisten|compare|contrast|versus|vs\.?|differ|relationship between|synthesi[sz]e|summari[sz]e the (whole|document|lecture|meeting|interview|essay|article|paper)|study guide|action items|new document|a document)\b|整篇|全文|所有|每个|每一|全部|重新组织|重排|对比|比较|矛盾|总结整|新文档|学习指南/i;

// "Every", "all", "each": across the document unless the message names a
// bounded part (the two paragraphs, this section, the list).
const EVERY = /\b(every|all the|all of|each)\b|所有|每个|每一|全部/i;
const BOUNDED = /\b(the|this|that|these|those|its|my) (\w+ )?(paragraph|paragraphs|sentence|sentences|line|lines|section|heading|list|table|block|quote|note|part)\b|\bunder ["“]|这[一两三]?[段句行节]|那[一两三]?[段句行节]/i;

// A question of meaning: why, how, explain, what does it mean, evaluate, argue.
const MEANING = /\b(why|how (does|do|did|would|could|can|is|are)|explain|what does .* mean|mean by|evaluate|assess|argue|argument|implication|interpret|significan|trade-?off|should i|should we|is (it|this|that|the .{1,40}) (true|real|right|sound|fair|justified|correct|worth)|does (it|this|that|the .{1,40}) (hold|work|follow|matter)|can i (trust|rely)|does the (document|paper|memo|article|author) (say|claim|show)|in what way)\b|为什么|怎么|如何|解释|意味着|评价|论证|含义|应该|是否|靠谱|站得住/i;

// Several asks in one message.
const SEVERAL = /(\band then\b|;|\bthen\b.*\band\b|\n\s*[-*]\s|\n\s*\d+[.)]\s|，然后|；)/i;

/** The depth a message calls for, and the signals that decided it. */
export function chooseDepth(input: DepthInput): DepthChoice {
  const message = input.message.trim();
  const n = words(message);
  const signals: string[] = [];
  const has = (rx: RegExp, name: string): boolean => {
    const hit = rx.test(message);
    if (hit) signals.push(name);
    return hit;
  };
  if (CONFIRMATION.test(message)) return { depth: "low", signals: ["confirmation"] };
  const whole = has(WHOLE, "across the document") || (EVERY.test(message) && !BOUNDED.test(message) && (signals.push("across the document"), true));
  const several = has(SEVERAL, "several asks");
  const meaning = has(MEANING, "a question of meaning");
  const onePlace = has(ONE_PLACE, "one place");
  const lookup = has(LOOKUP, "a lookup");
  if ((input.attachments ?? 0) > 0) signals.push("attachments");
  if (n > 60) signals.push("long message");
  if (input.scope === "notebook") signals.push("project scope");

  // The highest effort: the whole material, or several asks, or a long
  // message with attachments, or a question of meaning over the project.
  const constraints = /:\s*\S|\bkeep\b|\bwithout\b|\bno [a-z]+,/i.test(message);
  if (whole && (several || meaning || constraints || n > 25 || input.scope === "notebook")) return { depth: "max", signals };
  if (several && (meaning || n > 40)) return { depth: "max", signals };
  if ((input.attachments ?? 0) > 0 && (meaning || n > 40)) return { depth: "max", signals };
  // The deep effort: a question of meaning, a change across the document,
  // several asks, or a long message.
  if (meaning || whole || several || n > 40 || (input.attachments ?? 0) > 0) return { depth: "high", signals };
  // Low: a lookup or a one-place change, short.
  if ((lookup || onePlace) && n <= 25) return { depth: "low", signals };
  // A short question that is no lookup ("Is the margin recovery real?",
  // "What two habits does the author recommend?") asks for a reading.
  if (/^\s*(is|are|does|do|did|can|could|should|would|will|what|which|how)\b/i.test(message) || /[?？]\s*$/.test(message)) {
    signals.push("a question");
    return { depth: "medium", signals };
  }
  if (n <= 8) {
    signals.push("short");
    return { depth: "low", signals };
  }
  return { depth: "medium", signals };
}
