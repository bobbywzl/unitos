import { SaxesParser } from "saxes";

// A light XML reader for the large parts of an Office file (SPEC.md §27): a
// worksheet of 175,000 cells parsed to a jsdom DOM took 13 s and a gigabyte
// of heap, most of it the DOM's nodes. This reader runs the parser jsdom
// runs (saxes, with jsdom's options and its doctype entities), so a part
// reads the same and a part jsdom refuses is refused here too, and builds
// small elements with the few DOM members lib/parse/office.ts's helpers
// read (localName, the element siblings, attributes, textContent). A
// caller may take an element when it closes and drop it from the tree
// (`take`): a worksheet's rows are read one at a time and never held
// together. Sheets benchmark finding.

export type XmlAttribute = { readonly name: string; readonly localName: string; readonly value: string };

export class XmlElement {
  readonly localName: string;
  readonly parent: XmlElement | null;
  readonly attributes: XmlAttribute[];
  firstElementChild: XmlElement | null = null;
  lastElementChild: XmlElement | null = null;
  nextElementSibling: XmlElement | null = null;
  previousElementSibling: XmlElement | null = null;
  // Text and elements in document order: text as strings.
  readonly nodes: (XmlElement | string)[] = [];

  constructor(localName: string, parent: XmlElement | null, attributes: XmlAttribute[]) {
    this.localName = localName;
    this.parent = parent;
    this.attributes = attributes;
  }

  get children(): XmlElement[] {
    const out: XmlElement[] = [];
    for (let c = this.firstElementChild; c; c = c.nextElementSibling) out.push(c);
    return out;
  }

  /** The attribute with this qualified name (prefix:local), as the DOM's
      getAttribute reads it in an XML document. */
  getAttribute(name: string): string | null {
    for (const a of this.attributes) if (a.name === name) return a.value;
    return null;
  }

  /** The text of every text and CDATA node inside, in order. */
  get textContent(): string {
    if (this.nodes.length === 1 && typeof this.nodes[0] === "string") return this.nodes[0];
    let out = "";
    for (const n of this.nodes) out += typeof n === "string" ? n : n.textContent;
    return out;
  }

  /** Every descendant with this local name ("*" for any namespace), in
      document order. */
  getElementsByTagNameNS(_ns: string, localName: string): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (el: XmlElement) => {
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === localName) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  append(child: XmlElement | string): void {
    if (typeof child === "string") {
      const last = this.nodes.length - 1;
      // Adjacent text joins, as the DOM's textContent reads it.
      if (last >= 0 && typeof this.nodes[last] === "string") this.nodes[last] = (this.nodes[last] as string) + child;
      else this.nodes.push(child);
      return;
    }
    this.nodes.push(child);
    child.previousElementSibling = this.lastElementChild;
    if (this.lastElementChild) this.lastElementChild.nextElementSibling = child;
    else this.firstElementChild = child;
    this.lastElementChild = child;
  }
}

export class XmlDocument {
  constructor(readonly documentElement: XmlElement) {}

  getElementsByTagNameNS(ns: string, localName: string): XmlElement[] {
    const root = this.documentElement;
    return [...(root.localName === localName ? [root] : []), ...root.getElementsByTagNameNS(ns, localName)];
  }
}

/** An XML text read to light elements, or null when it does not parse
    (where jsdom's DOMParser gives a parsererror document). take(el) runs
    when an element closes; true drops the element from the tree. */
export function parseXmlStream(text: string, take?: (el: XmlElement) => boolean): XmlDocument | null {
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: "1.0", forceXMLVersion: true });
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];
  let failed = false;
  parser.on("error", (err) => {
    failed = true;
    throw err;
  });
  parser.on("doctype", (dt) => {
    // jsdom's entity reading (lib/jsdom/browser/parser/xml.js).
    const entityMatcher = /<!ENTITY ([^ ]+) "([^"]+)">/g;
    let result: RegExpExecArray | null;
    while ((result = entityMatcher.exec(dt))) {
      const [, name, value] = result;
      if (!(name in parser.ENTITIES)) parser.ENTITIES[name] = value;
    }
  });
  parser.on("opentag", (tag) => {
    const attributes: XmlAttribute[] = [];
    for (const key of Object.keys(tag.attributes)) {
      const a = tag.attributes[key];
      attributes.push({ name: a.prefix ? `${a.prefix}:${a.local}` : a.local, localName: a.local, value: a.value });
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const el = new XmlElement(tag.local, parent, attributes);
    if (parent) parent.append(el);
    else if (!root) root = el;
    stack.push(el);
  });
  parser.on("closetag", () => {
    const el = stack.pop();
    if (!el || !take || !el.parent) return;
    if (take(el)) {
      const parent = el.parent;
      // The element taken is its parent's last child: drop it.
      parent.nodes.pop();
      const prev = el.previousElementSibling;
      if (prev) prev.nextElementSibling = null;
      else parent.firstElementChild = null;
      parent.lastElementChild = prev;
    }
  });
  // Text outside the root is not part of the tree.
  parser.on("text", (data) => {
    if (stack.length > 0) stack[stack.length - 1].append(data);
  });
  parser.on("cdata", (data) => {
    if (stack.length > 0) stack[stack.length - 1].append(data);
  });
  try {
    parser.write(text).close();
  } catch {
    return null;
  }
  if (failed || !root) return null;
  return new XmlDocument(root);
}
