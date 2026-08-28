import {
  Document as DocxDocument,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// Export notebook → Markdown or .docx. Footnotes resolve to
// `documentTitle, block <blockId>` citations (SPEC.md §8 Phase 7).

type ExportSection = {
  title: string;
  depth: number;
  notes: { content: string; citations: { documentTitle: string; blockId: string }[] }[];
};

async function loadExport(notebookId: string) {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      sections: {
        where: { hidden: false },
        orderBy: { order: "asc" },
        include: {
          notes: {
            where: { status: "ACCEPTED" },
            orderBy: { order: "asc" },
            include: { sources: { include: { document: { select: { title: true } } } } },
          },
        },
      },
    },
  });
  if (!notebook) return null;

  const toExport = (s: (typeof notebook.sections)[number], depth: number): ExportSection => ({
    title: s.title,
    depth,
    notes: s.notes.map((n) => ({
      content: n.content,
      citations: n.sources.map((src) => ({
        documentTitle: src.document.title,
        blockId: src.blockId,
      })),
    })),
  });

  const top = notebook.sections.filter((s) => s.parentId === null);
  const sections: ExportSection[] = [];
  for (const s of top) {
    sections.push(toExport(s, 0));
    for (const c of notebook.sections.filter((x) => x.parentId === s.id)) {
      sections.push(toExport(c, 1));
    }
  }
  return { title: notebook.title, sections };
}

function toMarkdown(data: { title: string; sections: ExportSection[] }): string {
  const lines: string[] = [`# ${data.title}`, ""];
  const footnotes: string[] = [];
  let n = 0;
  for (const section of data.sections) {
    lines.push(`${section.depth === 0 ? "##" : "###"} ${section.title}`, "");
    for (const note of section.notes) {
      const refs = note.citations.map((c) => {
        n++;
        footnotes.push(`[^${n}]: ${c.documentTitle}, block ${c.blockId}`);
        return `[^${n}]`;
      });
      lines.push(`${note.content}${refs.length > 0 ? " " + refs.join(" ") : ""}`, "");
    }
  }
  if (footnotes.length > 0) lines.push("---", "", ...footnotes, "");
  return lines.join("\n");
}

async function toDocx(data: { title: string; sections: ExportSection[] }): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: data.title, heading: HeadingLevel.TITLE })];
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  let n = 0;
  for (const section of data.sections) {
    children.push(
      new Paragraph({
        text: section.title,
        heading: section.depth === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      }),
    );
    for (const note of section.notes) {
      const noteLines = note.content.split("\n").filter((l) => l.trim().length > 0);
      noteLines.forEach((line, i) => {
        const runs: (TextRun | FootnoteReferenceRun)[] = [new TextRun(line)];
        if (i === noteLines.length - 1) {
          for (const citation of note.citations) {
            n++;
            footnotes[n] = {
              children: [new Paragraph(`${citation.documentTitle}, block ${citation.blockId}`)],
            };
            runs.push(new FootnoteReferenceRun(n));
          }
        }
        children.push(new Paragraph({ children: runs }));
      });
    }
  }
  const doc = new DocxDocument({ footnotes, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function slug(title: string): string {
  return title.replace(/[^\w\d]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "corpus";
}

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  // Export is a read: any member downloads, viewers included.
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const format = new URL(req.url).searchParams.get("format") ?? "md";
  if (format !== "md" && format !== "docx") {
    return NextResponse.json({ error: t("api.exportFormatInvalid") }, { status: 400 });
  }
  const data = await loadExport(notebookId);
  if (!data) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });

  if (format === "md") {
    return new NextResponse(toMarkdown(data), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug(data.title)}.md"`,
      },
    });
  }
  const buffer = await toDocx(data);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${slug(data.title)}.docx"`,
    },
  });
}
