// The context layers (SPEC.md §2, lib/assistant/context.ts), checked on the
// requests themselves: the app's own builders and its own Claude client
// send to a local server that keeps each request and answers as the
// Messages API does. No key, no database.
// Run: npx tsx scripts/qa/context-layers-check.ts
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { ModelMessage } from "ai";
import { z } from "zod";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
}

type Captured = { headers: IncomingMessage["headers"]; body: Record<string, unknown> };
const captured: Captured[] = [];
// The next request that carries a per-message effort is refused once.
let refuseTurnEffort = false;

type WireBlock = { type: string; text?: string; cache_control?: { type: string; ttl?: string } };
type WireMessage = { role: string; content: WireBlock[] | string; output_config?: { effort?: string } };
const systemOf = (c: Captured) => (c.body.system ?? []) as WireBlock[];
const messagesOf = (c: Captured) => (c.body.messages ?? []) as WireMessage[];
const topEffort = (c: Captured) => (c.body.output_config as { effort?: string } | undefined)?.effort;
const turnEffort = (c: Captured) => messagesOf(c).find((m) => m.role === "system" && m.output_config)?.output_config?.effort;
const betas = (c: Captured) => String(c.headers["anthropic-beta"] ?? "");

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const entry = { headers: req.headers, body };
    captured.push(entry);
    if (refuseTurnEffort && turnEffort(entry)) {
      refuseTurnEffort = false;
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages.3.output_config: Extra inputs are not permitted" } }));
      return;
    }
    if (body.stream === true) {
      // The Messages API's stream, as the sidebar assistant reads it.
      const events: [string, unknown][] = [
        ["message_start", { type: "message_start", message: { id: "msg_check", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 0, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Rents rose." } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } }],
        ["message_stop", { type: "message_stop" }],
      ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_check",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: '{"reply":"ok"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 120,
          output_tokens: 8,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 5000,
          cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 4000 },
        },
      }),
    );
  });
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.ANTHROPIC_API_KEY = "sk-ant-check";
  delete process.env.AI_GATEWAY_URL;

  // Imported after the environment is set: the client reads it on first use.
  const { claudeOptions, steadyRequest } = await import("../../src/lib/claude");
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { callForJson } = await import("../../src/lib/derive/json-call");
  const { documentLayer, materialLayer, markConversation, rulesLayer, stableLayer } = await import("../../src/lib/assistant/context");
  const { documentPrefix } = await import("../../src/lib/derive/context");
  const { actMaterial, actPrompt, actRules, textSelectionBlock } = await import("../../src/lib/prompts/act");
  const { synthesisActions, synthesisAskPrompt } = await import("../../src/lib/prompts/synthesis");
  const { corpusLayers, corpusPickedLayers, documentMaterial, documentReadsWhole } = await import("../../src/lib/digest/render");
  const { computeCostUsd, sdkTokens } = await import("../../src/lib/usage");
  const { generateText, streamText } = await import("ai");
  const { streamTextTo } = await import("../../src/lib/derive/text-stream");
  const { httpFailure } = await import("../../src/lib/derive/json-call");
  type DigestParts = import("../../src/lib/digest/types").DigestParts;

  const SONNET = "claude-sonnet-5-5";
  // The client as lib/claude.ts builds it, without the model table's read.
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })(SONNET);
  const schema = z.object({ reply: z.string() });

  // One document, as two routes load it: the selection chat's blocks carry
  // more columns than the sidebar's, and both render the same layer.
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: rents rose eleven percent in the year, the fastest climb since records began.`);
  const actBlocks = paragraphs.map((text, i) => ({ id: `b${i + 1}`, type: "PARAGRAPH" as const, text, html: null, startTime: null, endTime: null, speaker: null, cell: null, page: null }));
  const pageBlocks = paragraphs.map((text, i) => ({ id: `b${i + 1}`, type: "PARAGRAPH" as const, text, startTime: null, endTime: null, cell: null, page: null }));
  const title = "The Rent Is Too High";

  const notes = [{ id: "n1", sectionTitle: "Housing", content: "Rents outpace wages since 2019." }];
  const actCtx = {
    profile: { background: "", purpose: "", application: "" },
    lang: "en" as const,
    selectionBlock: textSelectionBlock("b3", "rents rose eleven percent"),
    toolBlock: "",
    hasSelection: true,
    sections: [{ id: "s1", title: "Housing", parentTitle: null }],
    otherDocuments: [{ id: "d2", title: "Wages 2024" }],
    notes,
    history: [],
    command: "Why did rents rise?",
  };
  type Turn = { role: "user" | "assistant"; content: string };
  const actMessages = (command: string, withNotes = notes, history: Turn[] = []): ModelMessage[] => [
    documentLayer(title, actBlocks, null, null),
    rulesLayer(actRules(actCtx)),
    materialLayer(actMaterial({ ...actCtx, notes: withNotes })),
    { role: "user", content: actPrompt({ ...actCtx, command, history }) },
  ];
  const send = (messages: ModelMessage[], effort: "low" | "medium" | "high" | "max") =>
    callForJson({ model, messages, maxOutputTokens: 1024, schema, label: "check", providerOptions: claudeOptions(effort, SONNET) });

  // 1. The selection chat at low effort.
  const first = await send(actMessages("Why did rents rise?"), "low");
  check("the call answers", first.ok, first.ok ? "" : first.error);
  const a = captured[captured.length - 1];
  check("three system layers", systemOf(a).length === 3, String(systemOf(a).length));
  check("the rules layer follows the document and is kept as long", systemOf(a)[1].cache_control?.ttl === "1h" && (systemOf(a)[1].text ?? "").includes("Rules:") && (systemOf(a)[1].text ?? "").includes("Action types"), JSON.stringify(systemOf(a)[1].cache_control));
  check("the document layer is the document prefix", systemOf(a)[0].text === documentPrefix(title, pageBlocks, null, null));
  check("the document layer is kept for an hour", systemOf(a)[0].cache_control?.ttl === "1h", JSON.stringify(systemOf(a)[0].cache_control));
  check("the material layer is marked for five minutes", systemOf(a)[2].cache_control?.type === "ephemeral" && systemOf(a)[2].cache_control?.ttl === "5m", JSON.stringify(systemOf(a)[2].cache_control));
  check("the material layer holds the notes", (systemOf(a)[2].text ?? "").includes("[note n1]") && (systemOf(a)[2].text ?? "").includes("d2 — Wages 2024"));
  const userText = messagesOf(a).find((m) => m.role === "user");
  const userWords = typeof userText?.content === "string" ? userText.content : (userText?.content ?? []).map((b) => b.text ?? "").join("");
  check("the message holds the selection and the command, never the notes or the rules", userWords.includes("rents rose eleven percent") && userWords.includes("Command: Why did rents rise?") && !userWords.includes("[note n1]") && !userWords.includes("Rules:") && !userWords.includes("Action types"));
  check("the message is what is new: under 1,000 characters", userWords.length < 1000, String(userWords.length));
  check("the top of the request names the model's default effort", topEffort(a) === "high", String(topEffort(a)));
  check("the turn's effort rides in a message of its own", turnEffort(a) === "low", String(turnEffort(a)));
  const effortMessage = messagesOf(a)[messagesOf(a).length - 1];
  check("that message is the last one and holds no words", effortMessage.role === "system" && Array.isArray(effortMessage.content) && effortMessage.content.length === 0, JSON.stringify(effortMessage));
  check("the per-message effort's beta is sent", betas(a).includes("mid-conversation-output-config-2026-07-01"), betas(a));
  if (process.env.SHOW_REQUEST) console.log(JSON.stringify({ beta: betas(a), body: { ...a.body, system: systemOf(a).map((block) => ({ ...block, text: `${(block.text ?? "").slice(0, 60)}…` })), messages: messagesOf(a).map((m) => ({ ...m, content: typeof m.content === "string" ? `${m.content.slice(0, 60)}…` : m.content.map((block) => ({ ...block, text: `${(block.text ?? "").slice(0, 60)}…` })) })) } }, null, 1));

  // 2. The next message: another question, another effort. Everything the
  // cache matches on is the same.
  await send(actMessages("Where does it give the number?"), "max");
  const b = captured[captured.length - 1];
  const prefixOf = (c: Captured) => JSON.stringify({ ...c.body, messages: undefined });
  check("another effort, the same request up to the messages", prefixOf(a) === prefixOf(b));
  check("the turn's effort is the new one", turnEffort(b) === "max", String(turnEffort(b)));

  // 3. The model's default effort needs no message and no beta.
  await send(actMessages("Why?"), "high");
  const c = captured[captured.length - 1];
  check("the default effort: no effort message", turnEffort(c) === undefined && topEffort(c) === "high");
  check("the default effort: the same request up to the messages", prefixOf(a) === prefixOf(c));
  check("the default effort: no beta", !betas(c).includes("mid-conversation"), betas(c));

  // 4. A new note costs the material layer, never the document.
  await send(actMessages("Why?", [...notes, { id: "n2", sectionTitle: "Housing", content: "A new note." }]), "high");
  const d = captured[captured.length - 1];
  check("a new note: the document layer is byte for byte the same", systemOf(d)[0].text === systemOf(a)[0].text && JSON.stringify(systemOf(d)[0]) === JSON.stringify(systemOf(a)[0]));
  check("a new note: the rules layer is the same", JSON.stringify(systemOf(d)[1]) === JSON.stringify(systemOf(a)[1]));
  check("a new note: the material layer changed", systemOf(d)[2].text !== systemOf(a)[2].text);

  // 4a. A later message of the conversation: the same layers, the turns in the message.
  await send(actMessages("And wages?", notes, [{ role: "user", content: "Why did rents rise?" }, { role: "assistant", content: "Supply fell [block b3]." }]), "high");
  const later = captured[captured.length - 1];
  check("a later message: every layer is byte for byte the first message's", JSON.stringify(systemOf(later)) === JSON.stringify(systemOf(a)));
  const laterUser = messagesOf(later).find((m) => m.role === "user");
  const laterWords = typeof laterUser?.content === "string" ? laterUser.content : (laterUser?.content ?? []).map((block) => block.text ?? "").join("");
  check("a later message: the conversation so far is in the message", laterWords.includes("Conversation so far") && laterWords.includes("Supply fell [block b3]."));

  // 5. The sidebar at This page: the same document layer, then its material,
  // then the conversation, marked at its last turn.
  const parts: DigestParts = {
    corpusId: "p1",
    corpusTitle: "Housing",
    sections: ["Housing"],
    notes: [{ id: "n1", section: "Housing", hidden: false, status: "ACCEPTED", kind: "note", color: null, content: "Rents outpace wages since 2019.", sources: [] }],
    looseAnnotations: [],
    documents: [
      {
        id: "d1", title, sourceUrl: "https://example.com/rent", video: null, chars: 0, text: paragraphs.map((p, i) => `[block b${i + 1}] (PARAGRAPH)\n${p}`).join("\n\n"),
        glossary: [{ term: "rent", definition: "what a tenant pays" }], annotations: [], distillations: [], extractions: [], summaries: [], salience: [], links: [], edits: [],
      },
    ],
  };
  const material = documentMaterial(parts, "d1");
  check("This page: the document reads whole", documentReadsWhole(parts, "d1"));
  check("This page: the material names the document and holds its layers and notes, never its text", material !== null && material.includes("[document d1]") && material.includes("Glossary: rent") && material.includes("[note n1]") && !material.includes("[block b1]"));
  const turns: ModelMessage[] = [
    { role: "user", content: "What is this about?" },
    { role: "assistant", content: "Rents rose eleven percent [block b1]." },
  ];
  markConversation(turns);
  const pageActs = { sections: [{ id: "s1", title: "Housing", parentTitle: null }], otherDocuments: [], edits: "blocks" as const };
  const askRules = synthesisActions(pageActs);
  const ask1 = synthesisAskPrompt({ profile: actCtx.profile, lang: "en", scopeLabel: "this page", question: "and wages?", continued: true, actions: true, caretBlockId: "b4" });
  const ask2 = synthesisAskPrompt({ profile: actCtx.profile, lang: "en", scopeLabel: "this page", question: "What is this about?", actions: true });
  check("the sidebar's rules layer holds the action types and the rules for actions, never the question, the caret, or the reader", askRules.includes("Rules for actions:") && askRules.includes("Action types") && !askRules.includes("and wages?") && !askRules.includes("caret stands") && !askRules.includes("Reader context"));
  check("the sidebar's rules layer is the same with the web on or off, and for every question", askRules === synthesisActions({ ...pageActs }));
  check("the sidebar's message holds the question, the caret, and the rules of the answer, never the action types", ask1.includes("Question: and wages?") && ask1.includes("[block b4]") && ask1.includes("Stop at the answer") && !ask1.includes("Rules for actions:") && !ask1.includes("Action types") && !ask2.includes("Action types"));
  check("the sidebar's message names the rules layer", ask2.includes("The action types and the rules for actions stand after the document"));
  check("Project scope: no actions, and the message says where a change runs", synthesisAskPrompt({ profile: actCtx.profile, lang: "en", scopeLabel: "this project", question: "x" }).includes("changes run from the This page scope"));
  await send([documentLayer(title, pageBlocks, null, null), rulesLayer(askRules), materialLayer(material ?? ""), ...turns, { role: "user", content: ask1 }], "medium");
  const e = captured[captured.length - 1];
  check("This page reads the selection chat's document entry", JSON.stringify(systemOf(e)[0]) === JSON.stringify(systemOf(a)[0]));
  const lastTurn = messagesOf(e)[1];
  const lastBlock = Array.isArray(lastTurn.content) ? lastTurn.content[lastTurn.content.length - 1] : null;
  check("the conversation is marked at its last turn", lastTurn.role === "assistant" && lastBlock?.cache_control?.type === "ephemeral", JSON.stringify(lastTurn));
  const ask = messagesOf(e)[2];
  const askBlock = Array.isArray(ask.content) ? ask.content[ask.content.length - 1] : null;
  check("the message itself is never marked", ask.role === "user" && !askBlock?.cache_control);
  const markers = [...systemOf(e), ...messagesOf(e).flatMap((m) => (Array.isArray(m.content) ? m.content : []))].filter((block) => block.cache_control);
  check("four markers, the hour's two first", markers.length === 4 && markers[0].cache_control?.ttl === "1h" && markers[1].cache_control?.ttl === "1h" && markers.slice(2).every((m) => m.cache_control?.ttl !== "1h"), JSON.stringify(markers.map((m) => m.cache_control)));

  // 6. Project scope: the documents apart from what the reader made.
  const whole = corpusLayers(parts);
  check("Project: the documents layer holds the text and no note", whole.documents.includes("[block b40]") && !whole.documents.includes("[note n1]") && !whole.documents.includes("Sections:"));
  check("Project: the material layer holds the notes, the sections, and the layers, never the text", whole.material.includes("[note n1]") && whole.material.includes("Sections: Housing") && whole.material.includes("Glossary: rent") && !whole.material.includes("[block b1]"));
  const noted = corpusLayers({ ...parts, notes: [...parts.notes, { ...parts.notes[0], id: "n2", content: "Another." }] });
  check("Project: a new note leaves the documents layer as it was", noted.documents === whole.documents && noted.material !== whole.material);
  const picked = corpusPickedLayers(parts, new Map([["d1", { blockIds: new Set(["b2"]), gist: "Rents rose." }]]));
  const pickedAgain = corpusPickedLayers(parts, new Map([["d1", { blockIds: new Set(["b9"]), gist: "Rents rose." }]]));
  check("Project, picked: what the reader made is the same for every message", picked.material === pickedAgain.material && picked.picked !== pickedAgain.picked);
  check("Project, picked: the picked blocks come after it", picked.picked.includes("[block b2]") && !picked.material.includes("[block b2]"));
  check("a stable layer is kept for an hour", JSON.stringify(stableLayer("x").providerOptions).includes('"1h"'));

  // 7. What the steady request leaves alone.
  const unmarked: ModelMessage[] = [{ role: "system", content: "x" }, { role: "user", content: "y" }];
  check("no cache layer: the request is sent as built", !steadyRequest(SONNET, claudeOptions("low", SONNET), unmarked).steady);
  check("a model without per-message effort: sent as built", !steadyRequest("claude-opus-4-8", claudeOptions("low", "claude-opus-4-8"), actMessages("x")).steady);
  check("Claude Opus 5.5 stands at medium", steadyRequest("claude-opus-5-5", claudeOptions("medium", "claude-opus-5-5"), actMessages("x")).steady === false && steadyRequest("claude-opus-5-5", claudeOptions("high", "claude-opus-5-5"), actMessages("x")).steady === true);

  // 8. The usage record prices the hour's write at its own price.
  const result = await generateText({ model, messages: actMessages("Why?"), maxOutputTokens: 64, providerOptions: claudeOptions("high", SONNET), allowSystemInMessages: true });
  const tokens = sdkTokens(result.usage, result.providerMetadata);
  check("the hour's write is read from the provider's usage", tokens.cacheWrite1hTokens === 4000 && tokens.cacheWriteTokens === 5000, JSON.stringify(tokens));
  const cost = computeCostUsd(SONNET, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 2_000_000, cacheWrite1hTokens: 1_000_000 });
  // 1M read at $0.10, 1M written for five minutes at $2.50, 1M for an hour at $4.
  check("Sonnet 5.5: a read $0.10, a five-minute write $2.50, an hour's write $4.00 per 1M", Math.abs(cost - 6.6) < 1e-9, String(cost));

  // 8a. The sidebar's stream sends the same steady request, and a refused
  // one fails with the status the route reads before any words came.
  const sidebar: ModelMessage[] = [documentLayer(title, pageBlocks, null, null), materialLayer(material ?? ""), { role: "user", content: "Question: why?" }];
  const t = ((key: string) => key) as never;
  const streamed = steadyRequest(SONNET, claudeOptions("low", SONNET), sidebar);
  const stream = (request: typeof streamed) =>
    streamText({ model, messages: request.messages, providerOptions: request.providerOptions, headers: request.headers, maxOutputTokens: 64, allowSystemInMessages: true, onError: () => {} });
  let words = "";
  const text = await streamTextTo(stream(streamed), (chunk) => (words += chunk), { t });
  const f = captured[captured.length - 1];
  check("the stream answers", text === "Rents rose." && words.trim() === "Rents rose.", text);
  check("the stream's request is steady too", f.body.stream === true && topEffort(f) === "high" && turnEffort(f) === "low" && JSON.stringify(systemOf(f)[0]) === JSON.stringify(systemOf(a)[0]));
  refuseTurnEffort = true;
  const status = await streamTextTo(stream(streamed), () => {}, { t }).then(
    () => null,
    (err: unknown) => httpFailure(err)?.status ?? -1,
  );
  check("a refused stream fails with HTTP 400 before any words", status === 400, String(status));

  // 9. Last: an API that refuses the per-message effort. The call runs again
  // as it was built and answers; later calls no longer send it.
  refuseTurnEffort = true;
  const before = captured.length;
  const refused = await send(actMessages("Why did rents rise?"), "low");
  check("a refused per-message effort: the call still answers", refused.ok, refused.ok ? "" : refused.error);
  check("it was sent twice", captured.length === before + 2, String(captured.length - before));
  const rerun = captured[captured.length - 1];
  check("the second time the effort is at the top, with no effort message", topEffort(rerun) === "low" && turnEffort(rerun) === undefined);
  await send(actMessages("Again?"), "low");
  const after = captured[captured.length - 1];
  check("later calls name their effort at the top", captured.length === before + 3 && topEffort(after) === "low" && turnEffort(after) === undefined);
  check("the layers are still marked", systemOf(after)[0].cache_control?.ttl === "1h");

  server.close();
  if (failed > 0) {
    console.log(`${failed} failed`);
    process.exit(1);
  }
  console.log("all passed");
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
