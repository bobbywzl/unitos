// UI strings of what the documents say, on the graph (SPEC.md §13): the
// node card (node-card.tsx), Find across the project (graph-find.tsx), the
// last Stitch answer's proposed links, and the graph's own load. Count
// phrases: {s} is the English plural suffix. zh glossary: dict/common.ts —
// document 文档 · link 链接 · note 笔记 · part 部分 · contents 目录 ·
// passage 片段 · stitch 缝合 · pick 选取 · gist 要旨 · reader 阅读器.

const en = {
  // The node card (node-card.tsx)
  cardOpen: "Open in reader",
  cardOpenTitle: "Open this document in the reader",
  cardPick: "Pick for Stitch",
  cardPicked: "Picked for Stitch",
  cardNotes: "{n} note{s}",
  cardContents: "Contents",
  // The Documents list's parts line past PARTS_CAP parts (VIEW4-06, P4).
  partsMoreOne: "1 more part",
  partsMore: "{n} more parts",
  cardLinks: "Links",
  cardNotesHead: "Notes",
  cardWithin: "Within this document",
  cardInPart: "in {part}",
  cardNoSummary: "No summary yet. Stitch writes one the first time it reads this document.",
  cardAiLine: "Written by AI from the document. Check it against the text.",
  cardMore: "+ {n} more",
  cardPartTitle: "Open the reader at this part",
  cardNeighbourTitle: "Show this document's card",
  cardLoading: "Loading…",
  cardKeys: "← → walk the links · Enter opens · Esc closes",
  cardWalkNone: "This document has no links to walk.",
  cardWalkStart: "→ walks the links; ← comes back the same way.",
  cardBack: "Back to the card",
  cardGenerated: "A generated document: Stitch wrote it from the project's documents.",
  cardGeneratedFrom: "A generated document: Stitch wrote it from the command “{command}”.",
  generatedNodeLabel: "Generated document: {label}",
  // The hover card and the key (graph-view.tsx), option A: a click selects.
  cardHintSelect: "Click to read its card · ⇧-click to pick for Stitch",
  gesturesSelect:
    "Click a node to read its card, click it again to open it · ⇧-click to pick it for Stitch · ← → walk the links · drag to move · scroll to pan · pinch or Ctrl+scroll to zoom",
  // Option B: a click opens; the card pins from a right-click or a long press.
  cardHintOpen: "Click to open · right-click or long press for its card · ⇧-click to pick for Stitch",
  gesturesOpen:
    "Click a node to open it · right-click or long press for its card · ⇧-click to pick it for Stitch · drag to move · scroll to pan · pinch or Ctrl+scroll to zoom",

  // The last Stitch answer on the graph
  fromLastAnswer: "From the last Stitch answer",

  // Find across the project (graph-find.tsx)
  findLabel: "Find across the project",
  findPlaceholder: "Find a word across the documents…",
  findClear: "Clear the find",
  findSummary: "Found in {n} of {total} document{ts} · {p} passage{ps}",
  findNone: "No passage has these words.",
  findLoading: "Finding…",
  findFailed: "Find did not answer. Try again.",
  findPick: "Pick these {n} documents",
  findPickOne: "Pick this document",
  findAsk: "Ask Stitch",
  findAskWithPicks: "Ask Stitch about these {n} and your {m} other pick{ms}",
  findAskTitle: "Adds these documents to the pick and puts a question in the Stitch box",
  findAskTemplate: "What do these documents say about {q}?",
  findMore: "+ {n} more",
  findPassageTitle: "Open the reader at this passage",
  findHits: "{n} passage{s} hold the words",

  // The graph's own load (graph-data.tsx)
  loadFailed: "The graph did not load.",
  loadRetry: "Try again",
  staleNotice: "The graph did not refresh. It shows the project as of {time}.",
};

const zh: Record<keyof typeof en, string> = {
  cardOpen: "在阅读器中打开",
  cardOpenTitle: "在阅读器中打开这个文档",
  cardPick: "为缝合选取",
  cardPicked: "已为缝合选取",
  cardNotes: "{n} 条笔记",
  cardContents: "目录",
  partsMoreOne: "还有 1 个部分",
  partsMore: "还有 {n} 个部分",
  cardLinks: "链接",
  cardNotesHead: "笔记",
  cardWithin: "本文档内",
  cardInPart: "位于“{part}”",
  cardNoSummary: "还没有摘要。缝合第一次阅读这个文档时会写一份。",
  cardAiLine: "由 AI 根据文档写成。请对照原文核对。",
  cardMore: "还有 {n} 项",
  cardPartTitle: "在阅读器中打开这一部分",
  cardNeighbourTitle: "显示这个文档的卡片",
  cardWalkNone: "这个文档没有可沿着走的链接。",
  cardWalkStart: "→ 沿链接走；← 原路返回。",
  cardBack: "返回卡片",
  cardGenerated: "生成文档：缝合根据项目的文档写成。",
  cardGeneratedFrom: "生成文档：缝合根据指令“{command}”写成。",
  generatedNodeLabel: "生成文档：{label}",
  cardLoading: "正在载入…",
  cardKeys: "← → 沿链接走 · Enter 打开 · Esc 关闭",
  cardHintSelect: "点击查看卡片 · ⇧-点击为缝合选取",
  gesturesSelect:
    "点击节点查看卡片，再点一次打开 · ⇧-点击为缝合选取 · ← → 沿链接走 · 拖动可移动 · 滚动可平移 · 双指捏合或 Ctrl+滚动可缩放",
  cardHintOpen: "点击打开 · 右键或长按查看卡片 · ⇧-点击为缝合选取",
  gesturesOpen:
    "点击节点打开 · 右键或长按查看卡片 · ⇧-点击为缝合选取 · 拖动可移动 · 滚动可平移 · 双指捏合或 Ctrl+滚动可缩放",
  fromLastAnswer: "来自上一次缝合回答",
  findLabel: "在项目中查找",
  findPlaceholder: "在所有文档中查找词语…",
  findClear: "清除查找",
  findSummary: "在 {total} 个文档中的 {n} 个找到 · {p} 个片段",
  findNone: "没有片段包含这些词。",
  findLoading: "正在查找…",
  findFailed: "查找没有返回结果。请重试。",
  findPick: "选取这 {n} 个文档",
  findPickOne: "选取这个文档",
  findAsk: "问缝合",
  findAskWithPicks: "就这 {n} 个和你另选的 {m} 个问缝合",
  findAskTitle: "把这些文档加入选取，并在缝合框中写好问题",
  findAskTemplate: "这些文档对“{q}”说了什么？",
  findMore: "还有 {n} 个",
  findPassageTitle: "在阅读器中打开这个片段",
  findHits: "{n} 个片段包含这些词",
  loadFailed: "图谱没有载入。",
  loadRetry: "重试",
  staleNotice: "图谱没有刷新，显示的是 {time} 时的项目。",
};

export const graphView = { en, zh } as const;
