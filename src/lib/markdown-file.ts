// A Markdown upload (SPEC.md §2): the file input's accept list and the file
// test the document bar, the upload assistant, and the documents route
// share. Client-safe: no parser imports.

export const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd|txt)$/i;

// The file input's accept list: the same formats. A plain .txt file reads
// as markdown too: its paragraphs are paragraphs.
export const MARKDOWN_ACCEPT = "text/markdown,text/x-markdown,.md,.markdown,.mdown,.mkd,.txt";

const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"]);

export function isMarkdownFile(file: { type: string; name: string }): boolean {
  return MARKDOWN_MIME_TYPES.has(file.type) || MARKDOWN_EXTENSIONS.test(file.name);
}
