/*
 * A tiny XML reader/escaper, just enough for XFDF (elements, attributes, text,
 * CDATA, comments, entities). It is hand-rolled rather than DOMParser so the
 * XFDF codec runs — and is unit-tested — in plain Node as well as the browser.
 */

export type XmlNode = {
  /** Local element name (any namespace prefix is dropped). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated character data directly inside this element. */
  text: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : +body.slice(1);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** Escape text for an XML attribute value or text node. Characters illegal in
 * XML 1.0 are dropped. */
export function escapeXml(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** Parse an XML document and return its root element. Throws on malformed
 * input (unclosed or mismatched tags, no root). */
export function parseXml(source: string): XmlNode {
  let i = 0;
  const n = source.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const fail = (msg: string): never => {
    throw new Error(`Invalid XML: ${msg}`);
  };

  while (i < n) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next === -1 ? n : next;
      const text = source.slice(i, end);
      const top = stack[stack.length - 1];
      if (top) top.text += decodeEntities(text);
      i = end;
      continue;
    }

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) fail("unterminated comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end === -1) fail("unterminated CDATA");
      const top = stack[stack.length - 1];
      if (top) top.text += source.slice(i + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end === -1) fail("unterminated processing instruction");
      i = end + 2;
    } else if (source.startsWith("<!", i)) {
      // DOCTYPE and friends: skip (no internal-subset support, by design —
      // XFDF never needs it and entity declarations would be an attack surface).
      const end = source.indexOf(">", i + 2);
      if (end === -1) fail("unterminated declaration");
      i = end + 1;
    } else if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i + 2);
      if (end === -1) fail("unterminated closing tag");
      const name = localName(source.slice(i + 2, end).trim());
      const open = stack.pop();
      if (!open || open.name !== name) fail(`unexpected </${name}>`);
      i = end + 1;
    } else {
      // Opening / self-closing tag; attribute values may contain ">".
      let j = i + 1;
      let quote = "";
      while (j < n) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) fail("unterminated tag");
      const selfClosing = source[j - 1] === "/";
      const inner = source.slice(i + 1, selfClosing ? j - 1 : j);
      const nameMatch = /^\s*([^\s/>]+)/.exec(inner);
      if (!nameMatch) fail("empty tag name");
      const node: XmlNode = { name: localName(nameMatch![1]), attrs: {}, children: [], text: "" };
      const attrSource = inner.slice(nameMatch![0].length);
      for (const [key, value] of readAttributes(attrSource)) {
        if (!key.startsWith("xmlns")) node.attrs[localName(key)] = decodeEntities(value);
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else if (root) fail("more than one root element");
      else root = node;
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length) fail(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) fail("no root element");
  return root!;
}

/** Linear scan of ` name="value" name='value'` pairs (no regex backtracking, so
 * a hostile tag can't stall the tab). Malformed fragments are skipped. */
function readAttributes(src: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  const n = src.length;
  const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";
  while (i < n) {
    while (i < n && isSpace(src[i])) i++;
    const keyStart = i;
    while (i < n && src[i] !== "=" && !isSpace(src[i])) i++;
    const key = src.slice(keyStart, i);
    while (i < n && isSpace(src[i])) i++;
    if (src[i] !== "=") {
      if (i === keyStart) i++; // no progress: skip the stray character
      continue;
    }
    i++;
    while (i < n && isSpace(src[i])) i++;
    const quote = src[i];
    if (quote !== '"' && quote !== "'") continue;
    const end = src.indexOf(quote, i + 1);
    if (end === -1) break;
    if (key) out.push([key, src.slice(i + 1, end)]);
    i = end + 1;
  }
  return out;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

export function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}
