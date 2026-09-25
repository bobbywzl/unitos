// UI strings of the Unitos layer on the page editor (SPEC.md §29): the
// reader's toolbar, cards, and marks over a blank document. zh glossary:
// dict/common.ts.

const en = {
  leftOut: "Images and equations in the selection are left out",
  selectWordsFirst: "Select the words first",
};

const zh: Record<keyof typeof en, string> = {
  leftOut: "选中内容中的图片和公式不计入",
  selectWordsFirst: "先选中文字",
};

export const docsLayer = { en, zh } as const;
