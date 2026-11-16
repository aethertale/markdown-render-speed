// parse.js — dependency-free CommonMark 0.31.2 + GFM 0.29 renderer.
// Rebuilt from the specs and from marked 18.1.3's observed output; it returns
// exactly the HTML marked renders with default options (GFM on, breaks off).
// Stateless per call: nothing is kept between calls. The entry point is
// parse(); blocks are built by parseBlocks() and rendered by renderDoc().

export function parse(markdown) {
  const s = String(markdown);
  // most inputs have no CR at all: skip the full-copy replace then
  const text = s.indexOf('\r') < 0 ? s : s.replace(/\r\n?/g, '\n');
  docInLink = false;
  const state = parseBlocks(text);
  return renderDoc(state.doc, state.linkRefs);
}

// Document-level inLink: marked keeps one inLink flag for the whole
// document's inline tokenization. An inline <a ...> tag sets it (it
// stays set until an inline </a> tag clears it), and while it is set
// the GFM url autolinks (http/https/ftp, www., email, xmpp:, mailto:)
// do not form in ANY later block. It is saved/restored around a link
// label's tokenization, so an <a> inside a label does not leak.
let docInLink = false;

// ---- renderer ----

function renderDoc(doc, linkRefs) {
  const parts = [];
  for (let i = 0; i < doc.children.length; i++) parts.push(renderBlock(doc.children[i], linkRefs));
  return parts.join('');
}

function renderBlock(block, linkRefs) {
  switch (block.t) {
    case 'para': {
      return '<p>' + inlineToHtml(block.lines.join('\n'), linkRefs, false) + '</p>\n';
    }
    case 'heading': {
      // a setext heading's content has the leading whitespace of its
      // first line and the trailing whitespace of its last line stripped
      const text = block.lines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      return '<h' + block.level + '>' + inlineToHtml(text, linkRefs, false) + '</h' + block.level + '>\n';
    }
    case 'code': {
      // lines are joined with \n; a trailing \n is added only when the
      // last line is non-empty (a trailing empty line already ends the
      // join with \n, so no extra one is added)
      const content = block.lines.join('\n') + (block.lines.length > 0 && block.lines[block.lines.length - 1] !== '' ? '\n' : '');
      if (block.fenced && block.info) {
        // the info string's first word, with backslash escapes processed
        const word = unescapeStr(block.info.split(/[ \t]+/, 1)[0]);
        return '<pre><code class="language-' + escNoEnc(word) + '">' + escAll(content) + '</code></pre>\n';
      }
      return '<pre><code>' + escAll(content) + '</code></pre>\n';
    }
    case 'html': {
      return block.lines.join('\n') + (block.keepNL ? '\n' : '');
    }
    case 'quote': {
      const parts = ['<blockquote>\n'];
      for (let i = 0; i < block.children.length; i++) parts.push(renderBlock(block.children[i], linkRefs));
      parts.push('</blockquote>\n');
      return parts.join('');
    }
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const startAttr = (block.ordered && block.start !== null && block.start !== 1) ? ' start="' + block.start + '"' : '';
      const parts = ['<' + tag + startAttr + '>\n'];
      for (let i = 0; i < block.children.length; i++) parts.push(renderItem(block.children[i], block.loose, linkRefs));
      parts.push('</' + tag + '>\n');
      return parts.join('');
    }
    case 'hr': {
      return '<hr>\n';
    }
    case 'table': {
      const parts = ['<table>\n<thead>\n<tr>\n'];
      parts.push(block.header.map((cell, idx) => {
        const align = block.aligns[idx];
        const attr = align ? ' align="' + align + '"' : '';
        return '<th' + attr + '>' + inlineToHtml(cell.trim(), linkRefs, false) + '</th>';
      }).join('\n'));
      parts.push('\n</tr>\n</thead>\n');
      if (block.rows.length > 0) {
        parts.push('<tbody>');
        for (let r = 0; r < block.rows.length; r++) {
          const row = block.rows[r];
          parts.push('<tr>\n');
          parts.push(block.header.map((_, idx) => {
            const cell = idx < row.length ? row[idx] : '';
            const align = block.aligns[idx];
            const attr = align ? ' align="' + align + '"' : '';
            return '<td' + attr + '>' + inlineToHtml(cell.trim(), linkRefs, false) + '</td>';
          }).join('\n'));
          parts.push('\n</tr>');
          if (r < block.rows.length - 1) parts.push('\n');
        }
        parts.push('\n</tbody></table>\n');
      } else {
        parts.push('</table>\n');
      }
      return parts.join('');
    }
    default:
      return '';
  }
}

// The disabled checkbox HTML for a task-list item (checked or not).
function checkboxHtml(checked) {
  return checked
    ? '<input checked="" disabled="" type="checkbox"> '
    : '<input disabled="" type="checkbox"> ';
}

function renderItem(item, loose, linkRefs) {
  const parts = ['<li>'];
  const children = item.children;
  let startIdx = 0;
  // task list: first paragraph may start with [ ] / [x] / [X] + spaces + content
  if (children.length > 0 && children[0].t === 'para') {
    const para = children[0];
    const firstLine = para.lines.length > 0 ? para.lines[0] : '';
    const m = /^\[( |x|X)\][ \t]+(\S.*)$/.exec(firstLine);
    if (m) {
      const rest = m[2] + (para.lines.length > 1 ? '\n' + para.lines.slice(1).join('\n') : '');
      const inner = checkboxHtml(m[1] === 'x' || m[1] === 'X') + inlineToHtml(rest, linkRefs, false);
      if (loose) parts.push('<p>' + inner + '</p>\n');
      else parts.push(inner);
      startIdx = 1;
    }
  }
  for (let k = startIdx; k < children.length; k++) {
    const child = children[k];
    if (child.t === 'para' && !loose) {
      parts.push(inlineToHtml(child.lines.join('\n'), linkRefs, false));
    } else {
      parts.push(renderBlock(child, linkRefs));
    }
  }
  parts.push('</li>\n');
  return parts.join('');
}

// ---------------------------------------------------------------- helpers

const ASCII_PUNCT = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function isSpaceCh(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' ||
    c === '\u00a0' || c === '\u1680' || (c >= '\u2000' && c <= '\u200a') || c === '\u2028' ||
    c === '\u2029' || c === '\u202f' || c === '\u205f' || c === '\u3000' || c === '\ufeff';
}
function isPunctCh(c) {
  if (c.length !== 1) return false;
  const code = c.charCodeAt(0);
  if (code < 128) return ASCII_PUNCT.indexOf(c) >= 0;
  return PUNCT_RE.test(c);
}
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isAlnumCh(c) {
  if (c.length !== 1) return false;
  const code = c.charCodeAt(0);
  if (code < 128) return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return ALNUM_RE.test(c);
}
const ALNUM_RE = /[\p{L}\p{N}]/u;

// HTML escape replacements for the five characters marked escapes in
// text, code and attribute values.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape &, <, >, ", ' — every & is escaped.
const ESC_RE = /[&<>"']/;
function escAll(s) {
  if (!ESC_RE.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const rep = HTML_ESCAPES[s[i]];
    if (rep !== undefined) { out += s.slice(last, i) + rep; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}

// Escape <, >, ", ' and & — but leave & alone when it starts a valid
// entity reference (&name; &#123; &#x1f; with the digit limits marked uses).
function escNoEnc(s) {
  if (!ESC_RE.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let rep;
    if (c === '&') {
      if (entityAt(s, i)) continue;
      rep = '&amp;';
    } else {
      rep = HTML_ESCAPES[c];
      if (rep === undefined) continue;
    }
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

// Numeric entity digit value for a character in the given base (10 or 16),
// or -1 when the character is not a digit in that base.
function entityDigit(c, base) {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) {
    const v = code - 48;
    return v < base ? v : -1;
  }
  if (base === 16) {
    if (code >= 97 && code <= 102) return code - 87;
    if (code >= 65 && code <= 70) return code - 55;
  }
  return -1;
}

// If s has an entity reference starting at i, return {len, out} where out is
// the string to emit for it (named: the literal reference; numeric: the
// decoded character, already escaped). Otherwise return null.
function entityAt(s, i) {
  if (s[i] !== '&' || i + 1 >= s.length) return null;
  const c1 = s[i + 1];
  if (c1 === '#') {
    let j = i + 2;
    const hex = s[j] === 'x' || s[j] === 'X';
    if (hex) j++;
    const base = hex ? 16 : 10;
    const maxDigits = hex ? 6 : 7;
    let n = 0;
    let count = 0;
    while (j < s.length && count < maxDigits) {
      const v = entityDigit(s[j], base);
      if (v < 0) break;
      n = n * base + v;
      count++;
      j++;
    }
    if (count === 0 || j >= s.length || s[j] !== ';') return null;
    if (n === 0 || (n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) n = 0xfffd;
    return { len: j + 1 - i, out: escAll(String.fromCodePoint(n)) };
  }
  // named: & + word chars + ;
  let j = i + 1;
  while (j < s.length) {
    const cc = s.charCodeAt(j);
    if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 95) j++;
    else break;
  }
  if (j === i + 1 || j >= s.length || s[j] !== ';') return null;
  return { len: j + 1 - i, out: s.slice(i, j + 1) };
}

function hexVal(c) {
  return entityDigit(c, 16);
}

// marked's cleanUrl: encodeURI, null when it throws (lone surrogate).
function cleanUrl(href) {
  try {
    // encode only the characters that need it; % is left alone entirely
    // (both a valid %XX sequence and a lone % stay as-is)
    return href.replace(/[^A-Za-z0-9;,/?:@&=+$_.!~*'()#%-]/g, (ch) => encodeURIComponent(ch));
  } catch {
    return null;
  }
}

// Normalise a link label for definition lookup: collapse whitespace runs
// (including newlines) to one space, trim, lowercase (with Unicode case
// folding: ß/ẞ fold to ss).
function normLabel(s) {
  return s.replace(/[ \t\n]+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss');
}

// Unescape backslash escapes before ASCII punctuation in a raw string.
function unescapeStr(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && ASCII_PUNCT.indexOf(s[i + 1]) >= 0) {
      out += s.slice(last, i) + s[i + 1];
      i++;
      last = i + 1;
    }
  }
  return last === 0 ? s : out + s.slice(last);
}

// ---------------------------------------------------------------- inline
// Node types: 0 text, 1 delim, 2 link, 3 img, 4 code, 5 html, 6 br, 7 em/strong/del, 8 autolink.

// Render a plain-text node: escape HTML-special characters, and expand
// any valid entity reference in place (named references pass through
// unchanged; numeric ones decode to the character, already escaped).
function renderText(s) {
  if (!ESC_RE.test(s)) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      const ent = entityAt(s, i);
      if (ent) {
        out += s.slice(last, i) + ent.out;
        i += ent.len - 1;
        last = i + 1;
      } else {
        out += s.slice(last, i) + '&amp;';
        last = i + 1;
      }
      continue;
    }
    const rep = HTML_ESCAPES[c];
    if (rep !== undefined && c !== '&') {
      out += s.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? s : out + s.slice(last);
}

// Remove all <...> tags from an HTML string (used for image alt text).
function stripTags(html) {
  if (html.indexOf('<') < 0) return html;
  const parts = [];
  let last = 0;
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') { i++; continue; }
    const close = html.indexOf('>', i + 1);
    if (close < 0) break;
    parts.push(html.slice(last, i));
    i = close + 1;
    last = i;
  }
  if (last === 0) return html;
  parts.push(html.slice(last));
  return parts.join('');
}

// Scan a link label starting at text[openIdx] === '['. Returns {end, text}
// (end is the index just past the matching ']') or null.
function scanLabel(text, openIdx) {
  const n = text.length;
  let depth = 1;
  let j = openIdx + 1;
  while (j < n) {
    const c = text[j];
    if (c === '\\' && j + 1 < n && ASCII_PUNCT.indexOf(text[j + 1]) >= 0) { j += 2; continue; }
    if (c === '`') {
      let k = j;
      while (k < n && text[k] === '`') k++;
      const run = k - j;
      // a code span inside a label closes on the NEXT backtick run of
      // any length (marked's label pattern has no equal-run backref);
      // a run of >= 2 backticks immediately before ']' is literal
      // (the ``+(?=]) alternative) and wins over a later run elsewhere;
      // a single backtick before ']' opens a code span instead (cm-525)
      if (run >= 2 && k < n && text[k] === ']') { j = k; continue; }
      let m = k;
      let found = -1;
      while (m < n) {
        m = text.indexOf('`', m);
        if (m < 0) break;
        let e = m;
        while (e < n && text[e] === '`') e++;
        found = e;
        break;
      }
      if (found < 0) {
        if (run >= 2 && k < n && text[k] === ']') { j = k; continue; }
        return null;
      }
      j = found;
      continue;
    }
    if (c === '[') { depth++; j++; continue; }
    if (c === ']') {
      depth--;
      if (depth === 0) return { end: j + 1, text: text.slice(openIdx + 1, j) };
      j++;
      continue;
    }
    // an inline HTML tag or autolink inside the label is skipped whole,
    // so a ] inside it does not close the label
    if (c === '<') {
      const al = tryAngleAutolink(text, j);
      if (al) { j = al.end; continue; }
      const ht = tryHtmlTag(text, j);
      if (ht) { j = ht.end; continue; }
      j++;
      continue;
    }
    j++;
  }
  return null;
}

// Lenient label scan for shortcut references (marked's `be` pattern):
// backticks are ordinary characters, no nesting, 1-999 repetitions,
// label must not be all whitespace. Used only when the strict scan
// fails, and only for the shortcut path.
function scanLabelLenient(text, openIdx) {
  const n = text.length;
  let j = openIdx + 1;
  let count = 0;
  while (j < n && count < 999) {
    const c = text[j];
    if (c === '\\' && j + 1 < n) { j += 2; count++; continue; }
    if (c === '[') return null;
    if (c === ']') {
      const label = text.slice(openIdx + 1, j);
      if (/^\s*$/.test(label)) return null;
      return { end: j + 1, text: label };
    }
    j++;
    count++;
  }
  return null;
}

function skipWs(text, j) {
  const n = text.length;
  while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
  return j;
}

// Parse an inline link destination + optional title starting at text[i] === '('.
// Returns {end, dest, title} or null.
function parseLinkDest(text, j, n) {
  if (text[j] === '<') {
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = text[k];
      if (c === '\\' && k + 1 < n && ASCII_PUNCT.indexOf(text[k + 1]) >= 0) { k += 2; continue; }
      if (c === '\n' || c === '<') break;
      if (c === '>') { ok = true; break; }
      k++;
    }
    if (!ok) return null;
    return { dest: unescapeStr(text.slice(j + 1, k)), j: k + 1 };
  }
  let k = j;
  let depth = 0;
  let closed = false;
  while (k < n) {
    const c = text[k];
    if (c === '\\' && k + 1 < n && ASCII_PUNCT.indexOf(text[k + 1]) >= 0) { k += 2; continue; }
    if (c === '(') { depth++; k++; continue; }
    if (c === ')') {
      if (depth === 0) { closed = true; break; }
      depth--; k++; continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) break;
    k++;
  }
  if (!closed && k >= n) return null;
  return { dest: unescapeStr(text.slice(j, k)), j: k };
}

function parseLinkTitle(text, j, n, dest) {
  let title = null;
  const q = text[j];
  if (q === '"' || q === "'") {
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = text[k];
      if (c === '\\' && k + 1 < n && ASCII_PUNCT.indexOf(text[k + 1]) >= 0) { k += 2; continue; }
      if (c === q) { ok = true; break; }
      k++;
    }
    if (!ok) return null;
    title = unescapeStr(text.slice(j + 1, k));
    j = k + 1;
    j = skipWs(text, j);
    if (j >= n || text[j] !== ')') return null;
    return { end: j + 1, dest, title };
  }
  if (q === '(') {
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = text[k];
      if (c === '\\' && k + 1 < n && ASCII_PUNCT.indexOf(text[k + 1]) >= 0) { k += 2; continue; }
      if (c === '(') break;
      if (c === ')') { ok = true; break; }
      k++;
    }
    if (!ok) return null;
    title = unescapeStr(text.slice(j + 1, k));
    j = k + 1;
    j = skipWs(text, j);
    if (j >= n || text[j] !== ')') return null;
    return { end: j + 1, dest, title };
  }
  if (q === ')') return { end: j + 1, dest, title: null };
  return null;
}

function parseInlineDestTitle(text, i) {
  const n = text.length;
  let j = skipWs(text, i + 1);
  if (j >= n) return null;
  const d = parseLinkDest(text, j, n);
  if (!d) return null;
  j = skipWs(text, d.j);
  if (j >= n) return null;
  return parseLinkTitle(text, j, n, d.dest);
}

// Try to form a link or image starting at text[i] ('[' or '!' + '[').
// Returns {end, node} or null. inLink is set while parsing a label: it
// suppresses extended autolinks inside the label, but a regular link
// inside the label still forms (and, for a non-image outer link, kills
// it via nodesContainLink below).
function tryLink(text, i, linkRefs, inLink) {
  const isImg = text[i] === '!';
  const openIdx = isImg ? i + 1 : i;
  if (text[openIdx] !== '[') return null;
  let lab = scanLabel(text, openIdx);
  if (!lab) {
    // only a shortcut reference may use the lenient label (inline and
    // full references need the strict label); the '(' or '[' after a
    // lenient label is left as text
    lab = scanLabelLenient(text, openIdx);
    if (!lab) return null;
    const ref = linkRefs.get(normLabel(lab.text));
    if (!ref) return null;
    const hrefL = cleanUrl(ref.dest);
    if (hrefL === null) return null;
    const labelNodesL = inlineToNodes(lab.text, linkRefs, true);
    if (!isImg && nodesContainLink(labelNodesL)) return null;
    if (isImg) {
      return { end: lab.end, node: { t: 3, src: hrefL, title: ref.title, alt: altTextFromNodes(labelNodesL), prev: null, next: null } };
    }
    return { end: lab.end, node: { t: 2, href: hrefL, title: ref.title, html: renderNodeList(labelNodesL), prev: null, next: null } };
  }
  let dest = null;
  let title = null;
  let end;
  const after = lab.end;
  if (text[after] === '(') {
    const dt = parseInlineDestTitle(text, after);
    if (dt) { dest = dt.dest; title = dt.title; end = dt.end; }
    else {
      const ref = linkRefs.get(normLabel(lab.text));
      if (!ref) return null;
      dest = ref.dest; title = ref.title; end = after;
    }
  } else if (text[after] === '[') {
    const lab2 = scanLabel(text, after);
    if (!lab2) {
      const ref = linkRefs.get(normLabel(lab.text));
      if (!ref) return null;
      dest = ref.dest; title = ref.title; end = after;
    } else {
      const key = lab2.text === '' ? normLabel(lab.text) : normLabel(lab2.text);
      const ref = linkRefs.get(key);
      if (!ref) return null;
      dest = ref.dest; title = ref.title; end = lab2.end;
    }
  } else {
    const ref = linkRefs.get(normLabel(lab.text));
    if (!ref) return null;
    dest = ref.dest; title = ref.title; end = after;
  }
  const href = cleanUrl(dest);
  // A link's label must not contain a link (an autolink counts too);
  // an image's label may, and its alt text is the label's plain text.
  // The label is parsed with inLink so extended autolinks do not form
  // inside it (angle autolinks, code spans, emphasis and images still do).
  const labelNodes = inlineToNodes(lab.text, linkRefs, true);
  if (!isImg && nodesContainLink(labelNodes)) return null;
  if (isImg) {
    return { end, node: { t: 3, src: href, title, alt: altTextFromNodes(labelNodes), prev: null, next: null } };
  }
  return { end, node: { t: 2, href, title, html: renderNodeList(labelNodes), prev: null, next: null } };
}

// Try a code span starting at text[i] === '`'. Returns {end, node} or null.
function tryCodeSpan(text, i) {
  const n = text.length;
  let k = i;
  while (k < n && text[k] === '`') k++;
  const run = k - i;
  let m = k;
  while (m < n) {
    m = text.indexOf('`', m);
    if (m < 0) break;
    let e = m;
    while (e < n && text[e] === '`') e++;
    if (e - m === run) {
      let content = text.slice(k, m).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) {
        content = content.slice(1, -1);
      }
      return { end: e, node: { t: 4, s: content, prev: null, next: null } };
    }
    m = e;
  }
  return null;
}

function isEmailLocalCh(c) {
  const code = c.charCodeAt(0);
  if (code < 128) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      c === '.' || c === '_' || c === '+' || c === '-';
  }
  return false;
}
function isDomainCh(c) {
  const code = c.charCodeAt(0);
  if (code < 128) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '-';
  }
  return false;
}

function isGfmDomainCh(c) {
  const code = c.charCodeAt(0);
  if (code < 128) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '-' || c === '_';
  }
  return false;
}

// Returns {end, dropEnd} or null. end is the index just past the full
// domain; dropEnd is the index just past the domain with its last
// dot-group dropped (-1 when there is only one group).
function matchDomain(text, i) {
  const n = text.length;
  let j = i;
  if (j >= n || !isGfmDomainCh(text[j])) return null;
  while (j < n && isGfmDomainCh(text[j])) j++;
  let groups = 0;
  let prevEnd = -1;
  let end = -1;
  while (j < n && text[j] === '.' && j + 1 < n && isGfmDomainCh(text[j + 1])) {
    let k = j + 1;
    while (k < n && isGfmDomainCh(text[k])) k++;
    let e = k;
    while (e > j + 1 && (text[e - 1] === '-' || text[e - 1] === '_')) e--;
    if (e === j + 1) break;
    prevEnd = end;
    end = e;
    groups++;
    j = e;
  }
  if (groups < 1) return null;
  return { end, dropEnd: prevEnd };
}

// Apply the (?![\w-]) lookahead to a matched domain. Returns the end to
// use, or -1 if the email fails. When the offending char is an emphasis
// delimiter that closes a span opened earlier in this inline content,
// the full domain stands: marked extracts the emphasis span first, so
// the delimiter is not part of the email's context. hasOpenDelim(ch)
// reports whether an opener of ch is still open in this inline content.
function resolveEmailEnd(text, dom, hasOpenDelim) {
  const n = text.length;
  if (dom.end >= n) return dom.end;
  const c = text[dom.end];
  const code = c.charCodeAt(0);
  const isWord = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '_' || c === '-';
  if (!isWord) return dom.end;
  if ((c === '_' || c === '*') && hasOpenDelim) {
    // a '_' closer must not be followed by a word char (else it cannot
    // close); a '*' closer always can (it is preceded by alnum)
    let canClose = true;
    if (c === '_') {
      let k = dom.end;
      while (k < n && text[k] === '_') k++;
      if (k < n) {
        const ac = text[k];
        const acode = ac.charCodeAt(0);
        if ((acode >= 48 && acode <= 57) || (acode >= 65 && acode <= 90) || (acode >= 97 && acode <= 122)) canClose = false;
      }
    }
    if (canClose && hasOpenDelim(c)) return dom.end;
  }
  return dom.dropEnd;
}

// Match an email starting at text[i]. Returns {end, email} or null.
// The trailing-char rule lives in resolveEmailEnd (group-drop lookahead).
function matchEmail(text, i, hasOpenDelim) {
  const n = text.length;
  let j = i;
  while (j < n && isEmailLocalCh(text[j])) j++;
  if (j === i || j >= n || text[j] !== '@') return null;
  const dom = matchDomain(text, j + 1);
  if (!dom) return null;
  const end = resolveEmailEnd(text, dom, hasOpenDelim);
  if (end < 0) return null;
  return { end, email: text.slice(i, end) };
}

// Try a <...> autolink starting at text[i] === '<'. Returns {end, node} or null.
function tryAngleAutolink(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (c === '>') break;
    if (c === ' ' || c === '\t' || c === '\n' || c === '<' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) return null;
    j++;
  }
  if (j >= n) return null;
  const content = text.slice(i + 1, j);
  let href;
  let linkText;
  const colon = content.indexOf(':');
  if (colon >= 2 && colon <= 32 && content.length - colon - 1 >= 1) {
    const scheme = content.slice(0, colon);
    if (/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) {
      href = content;
      linkText = content;
    } else return null;
  } else {
    const em = matchEmail(content, 0);
    if (!em || em.end !== content.length) return null;
    href = 'mailto:' + content;
    linkText = content;
  }
  const url = cleanUrl(href);
  if (url === null) return null;
  return { end: j + 1, node: { t: 8, href: url, text: linkText, prev: null, next: null } };
}

// Build the {end, node} result for an inline HTML construct spanning
// text[i..end).
function htmlTagNode(text, i, end) {
  return { end, node: { t: 5, s: text.slice(i, end), prev: null, next: null } };
}

// Is the character a valid start of an HTML attribute name
// ([A-Za-z_:]) or a continuation ([A-Za-z0-9_.:-])?
function isAttrNameStart(c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === ':';
}
function isAttrNameChar(c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
    c === '-' || c === '.' || c === '_' || c === ':';
}

// Scan one attribute (name + optional = value) starting at text[j].
// Returns the index just past the attribute, or -1 when invalid.
function scanTagAttribute(text, j) {
  const n = text.length;
  if (!isAttrNameStart(text[j])) return -1;
  j++;
  while (j < n && isAttrNameChar(text[j])) j++;
  // the name must be followed by whitespace, >, /, or =
  if (j < n) {
    const c = text[j];
    if (!(c === ' ' || c === '\t' || c === '\n' || c === '>' || c === '/' || c === '=')) return -1;
  }
  // look ahead for = (after optional whitespace) without consuming
  // the whitespace when there is no = (it separates this attribute
  // from the next one)
  let k = j;
  while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n')) k++;
  if (k < n && text[k] === '=') {
    j = k + 1;
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    if (j >= n) return -1;
    const q = text[j];
    if (q === '"' || q === "'") {
      j++;
      while (j < n && text[j] !== q) j++;
      if (j >= n) return -1;
      j++;
    } else {
      // unquoted value: non-empty, no whitespace, ", ', =, <, >, `
      const vStart = j;
      while (j < n) {
        const c = text[j];
        if (c === ' ' || c === '\t' || c === '\n' || c === '"' || c === "'" || c === '=' || c === '<' || c === '>' || c === '`') break;
        j++;
      }
      if (j === vStart) return -1;
    }
  }
  return j;
}

// Try an inline HTML construct starting at text[i] === '<'. Returns {end, node} or null.
function tryHtmlTag(text, i) {
  const n = text.length;
  if (text.startsWith('<!--', i)) {
    // <!--> and <!---> are complete (empty) comments: abrupt closing
    if (text.startsWith('<!-->', i)) return htmlTagNode(text, i, i + 5);
    if (text.startsWith('<!--->', i)) return htmlTagNode(text, i, i + 6);
    const e = text.indexOf('-->', i + 4);
    if (e < 0) return null;
    return htmlTagNode(text, i, e + 3);
  }
  if (text.startsWith('<?', i)) {
    const e = text.indexOf('?>', i + 2);
    if (e < 0) return null;
    return htmlTagNode(text, i, e + 2);
  }
  if (text.startsWith('<![CDATA[', i)) {
    const e = text.indexOf(']]>', i + 9);
    if (e < 0) return null;
    return htmlTagNode(text, i, e + 3);
  }
  if (text.startsWith('<!', i) && i + 2 < n) {
    const c = text[i + 2];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      const e = text.indexOf('>', i + 2);
      if (e < 0) return null;
      return htmlTagNode(text, i, e + 1);
    }
    return null;
  }
  // open / close tag
  let j = i + 1;
  let closing = false;
  if (text[j] === '/') { closing = true; j++; }
  if (j >= n) return null;
  const c0 = text[j];
  if (!((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z'))) return null;
  j++;
  while (j < n) {
    const c = text[j];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-') j++;
    else break;
  }
  if (closing) {
    // a closing tag has no attributes: only whitespace then >
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    if (j < n && text[j] === '>') return htmlTagNode(text, i, j + 1);
    return null;
  }
  // attributes: each attribute must be preceded by whitespace, and its
  // name matches the HTML5 pattern [A-Za-z_:][A-Za-z0-9_.:-]*
  while (true) {
    const wsStart = j;
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    const hadWs = j > wsStart;
    if (j >= n) return null;
    if (text[j] === '>') return htmlTagNode(text, i, j + 1);
    if (text[j] === '/' && j + 1 < n && text[j + 1] === '>') {
      return htmlTagNode(text, i, j + 2);
    }
    if (!hadWs) return null;
    const after = scanTagAttribute(text, j);
    if (after < 0) return null;
    j = after;
  }
}

const TRIM_PUNCT = '?!.,:;*_~\'"';

// Scan an extended-autolink URL starting at text[i]. Returns the URL string
// (raw, untrimmed end removed) or null if it is empty.
function scanExtUrl(text, i) {
  const n = text.length;
  let j = i;
  while (j < n) {
    const c = text[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '<' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) break;
    j++;
  }
  if (j === i) return null;
  let url = text.slice(i, j);
  // marked's _backpedal: keep a run of non-punctuation, a balanced
  // (...) group (which may end the URL, so a trailing ')' that closes
  // an earlier '(' is kept), a bare '&', and trailing punctuation only
  // when it is not at the very end. Apply until stable.
  let prev;
  do {
    prev = url;
    const m = BACKPEDAL_RE.exec(url);
    url = m ? m[0] : '';
  } while (url !== prev);
  return url.length === 0 ? null : url;
}

// marked's inline _backpedal regex, used to trim a GFM autolink URL.
const BACKPEDAL_RE = /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;

// ---------------------------------------------------------------------------
// Emphasis / strikethrough: a port of marked's greedy left-to-right scan.
// The CommonMark delimiter stack gets the nesting wrong when an inner
// opener run must also be closed by the outer closer (e.g. `*a **b**c*`
// stays literal in marked, but a closer-first stack wraps an em), so each
// opener is scanned forward over the delimiter runs that follow it,
// tracking how many opener delims are still unclosed (m) and how many
// were skipped by the rule of 3 (f). Delimiters are handled in text order
// (an em and a del that overlap are decided by whichever starts first),
// and the scan recurses into a span's children the way marked re-tokenizes
// the span's inner text.
// ---------------------------------------------------------------------------

// GFM punctuation for flanking: Unicode P/S except '~' (marked's GFM
// punct set excludes the strikethrough delimiter).
function isScanPunct(c) {
  return c !== '~' && isPunctCh(c);
}

// Left/right flanking of a delimiter run from its neighbouring characters
// (GFM classes).
function scanFlank(before, after) {
  const bw = before === undefined || isSpaceCh(before);
  const bp = before !== undefined && isScanPunct(before);
  const aw = after === undefined || isSpaceCh(after);
  const ap = after !== undefined && isScanPunct(after);
  return {
    left: !aw && (!ap || bw || bp),
    right: !bw && (!bp || aw || ap),
    bw, bp, aw, ap,
  };
}

// Classify a candidate delimiter run for the scan: 'open' (open-only),
// 'close' (close-only), 'both', or null (invisible: neither flanking, or
// for '_' an intraword run, which marked's GFM scan cannot see at all).
// The punctuation class differs by character: '*' uses marked's GFM
// punct (excluding '~'), while '_' and '~' use the default punct set
// (including '~').
function scanClassify(node) {
  const punct = node.ch === '*' ? isScanPunct : isPunctCh;
  const before = node.before, after = node.after;
  const bw = before === undefined || isSpaceCh(before);
  const bp = before !== undefined && punct(before);
  const aw = after === undefined || isSpaceCh(after);
  const ap = after !== undefined && punct(after);
  const left = !aw && (!ap || bw || bp);
  const right = !bw && (!bp || aw || ap);
  if (!left && !right) return null;
  if (left && !right) return 'open';
  if (!left && right) return 'close';
  // both flanking; for '_' a run with word characters on both sides is
  // intraword and invisible to the scan
  if (node.ch === '_' && !bw && !bp && !aw && !ap) return null;
  return 'both';
}

// --- Masking: ranges of the inline text that marked's emphasis scan
// cannot see (its #n step masks code spans, link-shaped spans, HTML tags
// and known reference links before scanning). Delimiter runs inside a
// masked span are invisible to the scan. ---

// End index of a code span starting at a backtick run at text[i], under
// the masking rule (the closing run must be the first backtick run after
// the opening run, of the same length, with non-empty content), or -1.
function maskCodeSpanEnd(text, i) {
  const n = text.length;
  let k = i;
  while (k < n && text[k] === '`') k++;
  const run = k - i;
  let m = k;
  while (m < n) {
    if (text[m] === '`') {
      let e = m;
      while (e < n && text[e] === '`') e++;
      // a run of the wrong length is content, not the closer
      if (e - m === run) {
        if (m === k) return -1;
        return e;
      }
      m = e;
    } else m++;
  }
  return -1;
}

// Scan a link label for masking, from text[i] === '['. Returns the index
// just past the closing ']', or -1. Label characters are anything except
// '[', ']' and backtick, or a code span (equal backtick runs).
function maskLabelEnd(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (c === '\\' && j + 1 < n && ASCII_PUNCT.indexOf(text[j + 1]) >= 0) { j += 2; continue; }
    if (c === '`') {
      const e = maskCodeSpanEnd(text, j);
      if (e < 0) return -1;
      j = e;
      continue;
    }
    if (c === '[') return -1;
    if (c === ']') return j + 1;
    j++;
  }
  return -1;
}

// Scan a reference label for masking, from text[i] === '['. Returns the
// index just past the closing ']', or -1. Backticks are ordinary here.
function maskRefEnd(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (c === '\\' && j + 1 < n) { j += 2; continue; }
    if (c === '[') return -1;
    if (c === ']') return j + 1;
    j++;
  }
  return -1;
}

// Scan a parenthesized destination for masking, from text[i] === '('.
// Returns the index just past the matching ')', or -1. Allows one level
// of nested parens and escapes.
function maskDestEnd(text, i) {
  const n = text.length;
  let depth = 1;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (c === '\\' && j + 1 < n) { j += 2; continue; }
    if (c === '(') {
      depth++;
      if (depth > 2) return -1;
      j++;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
      j++;
      continue;
    }
    j++;
  }
  return -1;
}

// Ranges [start, end) of the inline text that the emphasis scan cannot
// see. Scanned left to right, non-overlapping, sorted.
const MASK_JUMP_RE = /[\\`[<]/g;
function maskedSpans(text, linkRefs) {
  const n = text.length;
  const spans = [];
  let i = 0;
  while (i < n) {
    MASK_JUMP_RE.lastIndex = i;
    const jm = MASK_JUMP_RE.exec(text);
    if (!jm) break;
    i = jm.index;
    const c = text[i];
    // an escaped character cannot open a code span or a link label
    if (c === '\\' && i + 1 < n && ASCII_PUNCT.indexOf(text[i + 1]) >= 0) { i += 2; continue; }
    if (c === '`') {
      const cs = tryCodeSpan(text, i);
      if (cs) { spans.push([i, cs.end]); i = cs.end; continue; }
      let k = i;
      while (k < n && text[k] === '`') k++;
      i = k;
      continue;
    }
    if (c === '[') {
      const le = maskLabelEnd(text, i);
      if (le > 0) {
        if (text[le] === '(') {
          const de = maskDestEnd(text, le);
          if (de > 0) { spans.push([i, de]); i = de; continue; }
        } else if (text[le] === '[') {
          const re = maskRefEnd(text, le);
          if (re > 0) {
            const refText = text.slice(le + 1, re - 1);
            const labText = text.slice(i + 1, le - 1);
            const key = refText.length ? normLabel(refText) : normLabel(labText);
            if (linkRefs && linkRefs.has(key)) { spans.push([i, re]); i = re; continue; }
          }
        } else {
          const labText = text.slice(i + 1, le - 1);
          if (linkRefs && linkRefs.has(normLabel(labText))) { spans.push([i, le]); i = le; continue; }
        }
      }
      i++;
      continue;
    }
    if (c === '<') {
      if (i + 1 < n && text[i + 1] !== ' ') {
        // first terminator wins: '>' closes the tag, '<' aborts it
        const gt = text.indexOf('>', i + 1);
        const lt = text.indexOf('<', i + 1);
        if (gt >= 0 && (lt < 0 || gt < lt)) { spans.push([i, gt + 1]); i = gt + 1; continue; }
      }
      i++;
      continue;
    }
    i++;
  }
  return spans;
}

// Is position pos inside one of the (sorted) masked spans?
function isMaskedPos(spans, pos) {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (pos < s[0]) hi = mid - 1;
    else if (pos >= s[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// The LDelim gate values for an opener node. d: the character after the
// run is punctuation (GFM punct for '*'/'_', default punct for '~'). h:
// the character before the extended run is a delimiter, whitespace or
// punctuation (marked's `punctuation` regex matches whitespace too, and
// includes '~'). The gate passes unless the character after the run is
// punctuation while the character before it is a word character.
function ldelimGate(node) {
  const d = node.after !== undefined && (node.ch === '~' ? isPunctCh(node.after) : isScanPunct(node.after));
  const p = node.p;
  const h = p !== undefined && (p === '*' || p === '_' || isSpaceCh(p) || isPunctCh(p));
  const nGate = node.o ? p : node.before;
  const u = node.o ? h : (nGate !== undefined && (isSpaceCh(nGate) || isPunctCh(nGate)));
  return { d, h, pass: !d || nGate === undefined || u };
}
function skipRunPos(text, start, ch) {
  const other = ch === '*' ? '_' : '*';
  let i = start;
  while (i < text.length && text[i] !== ch && text[i] !== other) i++;
  if (i >= text.length || text[i] !== other) return -1;
  let j = i;
  while (j < text.length && text[j] === other) j++;
  if (j - i < 2) return -1;
  let k = j;
  while (k < text.length && text[k] !== ch && text[k] !== other) k++;
  if (k >= text.length || text[k] !== ch) return -1;
  let m = k;
  while (m < text.length && text[m] === ch) m++;
  let p = m;
  while (p < text.length && text[p] !== ch && text[p] !== other) p++;
  if (p >= text.length || text[p] !== other) return -1;
  let q = p;
  while (q < text.length && text[q] === other) q++;
  if (q - p < 2) return -1;
  return k;
}

// First source character of a node (for flanking of delimiter runs placed
// inside a span).
function firstSrcChar(nd) {
  if (nd.t === 0) return nd.s.length ? nd.s[0] : undefined;
  if (nd.t === 1) return nd.ch;
  if (nd.t === 4) return '`';
  if (nd.t === 2 || nd.t === 3) return '!';
  if (nd.t === 5) return '<';
  if (nd.t === 6) return '\n';
  if (nd.t === 8) return nd.text.length ? nd.text[0] : undefined;
  if (nd.t === 7) return nd.children.length ? firstSrcChar(nd.children[0]) : undefined;
  return undefined;
}
function lastSrcChar(nd) {
  if (nd.t === 0) return nd.s.length ? nd.s[nd.s.length - 1] : undefined;
  if (nd.t === 1) return nd.ch;
  if (nd.t === 4) return '`';
  if (nd.t === 2 || nd.t === 3) return ']';
  if (nd.t === 5) return '>';
  if (nd.t === 6) return '\n';
  if (nd.t === 8) return nd.text.length ? nd.text[nd.text.length - 1] : undefined;
  if (nd.t === 7) return nd.children.length ? lastSrcChar(nd.children[nd.children.length - 1]) : undefined;
  return undefined;
}

// Wrap the nodes between opener and closer in an em/strong/del node.
// `k` is the opener length the scan used, `bPrime` the closer length it
// used, `strip` the delims the span itself consumes from each end
// (1 for em, 2 for strong, o for del). The opener's (k - strip) and the
// closer's (bPrime - strip) leftover delims land INSIDE the span (marked
// re-parses them as part of the span's inner text); the opener's
// (opener.n - k) leading delims become literal text before the span, and
// the closer's (closer.n - bPrime) trailing delims stay a delimiter node
// after it. Returns the span node.
function wrapScan(opener, closer, k, bPrime, strip, strong, del) {
  const emNode = { t: 7, strong, del, children: [], prev: null, next: null };
  // opener leftover inside the span (at its start): it stands at the
  // start of the span's inner text, so it can only open, and only when
  // the character after it is not whitespace
  if (k - strip > 0) {
    const first = opener.next;
    const afterCh = first && first !== closer ? firstSrcChar(first) : undefined;
    const nd = { t: 1, ch: opener.ch, n: k - strip, canOpen: afterCh !== undefined && !isSpaceCh(afterCh), canClose: false, before: undefined, after: afterCh, y: k - strip, p: undefined, o: false, masked: false, prev: null, next: null };
    emNode.children.push(nd);
  }
  let x = opener.next;
  while (x !== closer) {
    const nx = x.next;
    emNode.children.push(x);
    x.prev = null; x.next = null;
    x = nx;
  }
  // closer leftover inside the span (at its end): it stands at the end
  // of the span's inner text, so it can only close, and only when the
  // character before it is not whitespace
  if (bPrime - strip > 0) {
    const last = emNode.children.length ? emNode.children[emNode.children.length - 1] : null;
    const beforeCh = last ? lastSrcChar(last) : undefined;
    const nd = { t: 1, ch: closer.ch, n: bPrime - strip, canOpen: false, canClose: beforeCh !== undefined && !isSpaceCh(beforeCh), before: beforeCh, after: undefined, y: bPrime - strip, p: undefined, o: false, masked: false, prev: null, next: null };
    emNode.children.push(nd);
  }
  // link the children into a doubly-linked list for the recursion
  for (let ci = 0; ci < emNode.children.length; ci++) {
    emNode.children[ci].prev = ci > 0 ? emNode.children[ci - 1] : null;
    emNode.children[ci].next = ci < emNode.children.length - 1 ? emNode.children[ci + 1] : null;
  }
  const openerPrev = opener.prev;
  const closerNext = closer.next;
  // opener's leading delims (opener.n - k) become literal text
  if (opener.n - k > 0) {
    const lit = { t: 0, s: opener.ch.repeat(opener.n - k), prev: openerPrev, next: emNode };
    if (openerPrev) openerPrev.next = lit;
    emNode.prev = lit;
  } else if (openerPrev) {
    openerPrev.next = emNode;
    emNode.prev = openerPrev;
  } else {
    emNode.prev = openerPrev;
  }
  // closer's trailing delims (closer.n - bPrime) stay a delimiter node
  if (closer.n - bPrime > 0) {
    closer.n = closer.n - bPrime;
    closer.prev = emNode;
    emNode.next = closer;
  } else {
    emNode.next = closerNext;
    if (closerNext) closerNext.prev = emNode;
  }
  return emNode;
}

// Scan forward from an opener node for a matching closer. `k` is the
// opener length to try, `text` the inline source (for the first-alternative
// skip). Returns {closer, bPrime, minKB} or null.
function scanEmphasis(opener, k, text) {
  const ch = opener.ch;
  const y = opener.y;
  const p = opener.p;
  const gate = ldelimGate(opener);
  const d = gate.d;
  const h = gate.h;
  const o = opener.o || k < opener.n;
  // R: a previous non-space character exists, and the character after the
  // opener is punctuation, or (for '*') the previous character is not
  // punctuation
  const R = p !== undefined && !isSpaceCh(p) && (d || (ch === '*' && !h));
  const skipPos = skipRunPos(text, opener.pos + opener.n, ch);
  let m = k;
  let f = 0;
  let firstCand = true;
  let x = opener.next;
  while (x) {
    if (x.t === 1 && x.ch === ch && !x.masked && x.n > 0) {
      if (firstCand && skipPos >= 0 && x.pos === skipPos) { firstCand = false; x = x.next; continue; }
      firstCand = false;
      const cls = scanClassify(x);
      if (cls === null) { x = x.next; continue; }
      const b = x.n;
      if (cls === 'open') { m += b; x = x.next; continue; }
      if (cls === 'both' || R) {
        if (o && cls === 'both') return null;
        if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; x = x.next; continue; }
      }
      m -= b;
      if (m > 0) { x = x.next; continue; }
      const bPrime = Math.min(b, b + m + f);
      return { closer: x, bPrime, minKB: Math.min(k, bPrime) };
    }
    x = x.next;
  }
  return null;
}


// Recompute a delimiter node's canOpen/canClose from its before/after
// characters (the CommonMark flanking rules used at creation).
function recomputeFlanking(node) {
  const before = node.before, after = node.after;
  const beforeWs = before === undefined || isSpaceCh(before);
  const beforePunct = before !== undefined && isPunctCh(before);
  const afterWs = after === undefined || isSpaceCh(after);
  const afterPunct = after !== undefined && isPunctCh(after);
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
  if (node.ch === '_') {
    node.canOpen = leftFlanking && (!rightFlanking || beforePunct);
    node.canClose = rightFlanking && (!leftFlanking || afterPunct);
  } else {
    node.canOpen = leftFlanking;
    node.canClose = rightFlanking;
  }
}

// A delimiter node at the very start or end of a span's inner text sees
// the inner text's boundary (start/end) as its neighbour, not the span's
// own delimiters or the text outside the span. Adjust those boundary
// nodes before recursing into the span, so their flanking matches a
// fresh tokenization of the inner text.
function adjustSpanBoundary(children) {
  if (!children.length) return;
  const first = children[0];
  if (first.t === 1) {
    first.before = undefined;
    first.p = undefined;
    first.o = false;
    first.y = first.n;
    recomputeFlanking(first);
  }
  const last = children[children.length - 1];
  if (last.t === 1) {
    last.after = undefined;
    recomputeFlanking(last);
  }
}

// Recurse into a span node's children, then refresh its children array
// (a wrap inside the recursion replaces nodes, so the array goes stale).
function processSpanChildren(span, text) {
  if (!span.children.length) return;
  adjustSpanBoundary(span.children);
  const childDummy = { t: -1, prev: null, next: span.children[0] };
  span.children[0].prev = childDummy;
  processEmphasis(childDummy, text);
  const arr = [];
  let x = childDummy.next;
  while (x) { arr.push(x); x = x.next; }
  span.children = arr;
}

// Process emphasis / strikethrough in the node list whose dummy head is
// `dummy`, following marked's left-to-right token order: at each delimiter
// run, try to form its span; on failure the run stays literal (and stays
// available as a candidate for later openers). `text` is the inline source.
function emphasisHit(cur, text) {
  if (!ldelimGate(cur).pass) return null;
  let hit = null;
  let kk = 0;
  for (let k = cur.n; k >= 1; k--) {
    const r = scanEmphasis(cur, k, text);
    if (r) { hit = r; kk = k; break; }
  }
  if (!hit) return null;
  const strip = hit.minKB % 2 === 1 ? 1 : 2;
  return wrapScan(cur, hit.closer, kk, hit.bPrime, strip, hit.minKB % 2 === 0, false);
}

function delHit(cur, text) {
  if (!ldelimGate(cur).pass) return null;
  const o = Math.min(cur.n, 2);
  let p = o;
  let x = cur.next;
  let hit = null;
  while (x) {
    if (x.t === 1 && x.ch === '~' && !x.masked && x.n > 0) {
      const cls = scanClassify(x);
      if (cls === null) { x = x.next; continue; }
      if (cls === 'open') { p += x.n; x = x.next; continue; }
      // every closer run subtracts from the balance, whatever its
      // length (a single '~' closer inside a '~~' span still counts);
      // only the run where the balance hits zero becomes the closer
      p -= x.n;
      if (p > 0) { x = x.next; continue; }
      hit = { closer: x, bPrime: Math.min(x.n, x.n + p) };
      break;
    }
    x = x.next;
  }
  if (!hit) return null;
  return wrapScan(cur, hit.closer, o, hit.bPrime, o, false, true);
}

function processEmphasis(dummy, text) {
  let cur = dummy.next;
  while (cur) {
    const next = cur.next;
    if (cur.t === 1 && !cur.masked && cur.n > 0) {
      let span = null;
      // LDelim gate: enter the scan unless the character after the
      // opener is punctuation while the character before it is a word
      // character
      if ((cur.ch === '*' || cur.ch === '_') && cur.canOpen) span = emphasisHit(cur, text);
      else if (cur.ch === '~' && cur.canOpen) span = delHit(cur, text);
      if (span) {
        // recurse into the span's children (marked re-tokenizes them)
        processSpanChildren(span, text);
        // continue after the span (its closer leftover, if any, is next)
        cur = span.next;
        continue;
      }
    }
    cur = next;
  }
}

function renderNodeList(nodes) {
  const parts = [];
  for (const nd of nodes) {
    switch (nd.t) {
      case 0: parts.push(renderText(nd.s)); break;
      case 1: parts.push(nd.ch.repeat(nd.n)); break;
      case 2:
        if (nd.href === null) parts.push(nd.html);
        else parts.push('<a href="' + escNoEnc(nd.href) + '"' + titleAttr(nd.title) + '>' + nd.html + '</a>');
        break;
      case 3:
        if (nd.src === null) parts.push(nd.alt);
        else parts.push('<img src="' + escNoEnc(nd.src) + '" alt="' + nd.alt + '"' + titleAttr(nd.title) + '>');
        break;
      case 4: parts.push('<code>' + escAll(nd.s) + '</code>'); break;
      case 5: parts.push(nd.s); break;
      case 6: parts.push('<br>'); break;
      case 7: {
        const inner = renderNodeList(nd.children);
        if (nd.del) parts.push('<del>' + inner + '</del>');
        else parts.push(nd.strong ? '<strong>' + inner + '</strong>' : '<em>' + inner + '</em>');
        break;
      }
      case 8: parts.push('<a href="' + escAll(nd.href) + '">' + escAll(nd.text) + '</a>'); break;
      default: break;
    }
  }
  return parts.join('');
}

// The optional title attribute for a link or image, already escaped.
function titleAttr(title) {
  return title !== null ? ' title="' + escNoEnc(title) + '"' : '';
}

// Try a GFM extended autolink at text[i]; i is a candidate start found
// by AUTOLINK_RE, so a scheme/www. match is guaranteed. Returns the index
// just past the autolink, or -1 when no autolink forms (the caller then
// emits text[i] as plain text). pushNode/pushText/hasOpenDelim are the
// inline scanner's closures; docInLink is module state.
function tryExtAutolink(text, i, n, inLink, prevCh, hasOpenDelim, pushNode, pushText) {
  if (inLink || docInLink) return -1;
  const c = text[i];
if (!(inLink || docInLink) && (c === 'w' || c === 'W') && text.startsWith('www.', i)) {
  const okPrev = prevCh === null || isSpaceCh(prevCh) || prevCh === '(' || prevCh === '*' || prevCh === '_' || prevCh === '~';
  if (okPrev) {
    const c1 = text[i + 4];
    if (c1 !== undefined && ((c1 >= 'a' && c1 <= 'z') || (c1 >= 'A' && c1 <= 'Z') || (c1 >= '0' && c1 <= '9') || c1 === '_' || c1 === '-')) {
      const url = scanExtUrl(text, i);
      if (url) {
        const href = cleanUrl('http://' + url);
        if (href !== null) {
          pushNode({ t: 8, href, text: url, prev: null, next: null });
          return i + url.length;
        }
      }
    }
  }
  return -1;
}
if (!(inLink || docInLink) && (c === 'h' || c === 'H' || c === 'f' || c === 'F')) {
  const rest = text.slice(i, i + 8).toLowerCase();
  let schemeLen = 0;
  if (rest.startsWith('https://')) schemeLen = 8;
  else if (rest.startsWith('http://')) schemeLen = 7;
  else if (rest.startsWith('ftp://')) schemeLen = 6;
  if (schemeLen > 0) {
    const url = scanExtUrl(text, i);
    if (url) {
      const href = cleanUrl(url);
      if (href !== null) {
        pushNode({ t: 8, href, text: url, prev: null, next: null });
        return i + url.length;
      }
    }
  }
  return -1;
}
if (!(inLink || docInLink) && c === 'x' && text.startsWith('xmpp:', i)) {
  // the only bare-scheme autolink: literal lowercase xmpp: + an
  // email, optionally + / + one path segment ([A-Za-z0-9@.]+,
  // trailing dots trimmed)
  const okPrev = prevCh === null || isSpaceCh(prevCh) || prevCh === '(' || prevCh === '*' || prevCh === '_' || prevCh === '~';
  if (okPrev) {
    const em = matchEmail(text, i + 5, hasOpenDelim);
    if (em) {
      let end = em.end;
      if (text[end] === '/') {
        let k = end + 1;
        while (k < n) {
          const ch = text[k];
          if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '@' || ch === '.') k++;
          else break;
        }
        if (k > end + 1) {
          let e2 = k;
          while (e2 > end + 1 && text[e2 - 1] === '.') e2--;
          if (e2 > end + 1) end = e2;
        }
      }
      const full = text.slice(i, end);
      const href = cleanUrl(full);
      if (href !== null) {
        pushNode({ t: 8, href, text: full, prev: null, next: null });
        return end;
      }
    }
  }
  return -1;
}
if (!(inLink || docInLink) && c === 'm' && text.startsWith('mailto:', i)) {
  const okPrev = prevCh === null || isSpaceCh(prevCh) || prevCh === '(' || prevCh === '*' || prevCh === '_' || prevCh === '~';
  if (okPrev) {
    const em = matchEmail(text, i + 7, hasOpenDelim);
    if (em) {
      const full = text.slice(i, em.end);
      const href = cleanUrl('mailto:' + em.email);
      if (href !== null) {
        pushNode({ t: 8, href, text: full, prev: null, next: null });
        return em.end;
      }
    }
  }
  return -1;
}
  return -1;
}

// Parse inline content to a node list. linkRefs is a Map of normalised label -> {dest, title}.
function inlineToNodes(text, linkRefs, inLink) {
  const n = text.length;
  // ranges of this inline text that the emphasis scan cannot see
  // (code spans, link-shaped spans, HTML tags, known reference links).
  // Only computable when a delimiter exists (nothing else reads the
  // mask) and a mask opener exists (otherwise the span list is empty).
  const maskSpans = (HAS_DELIM.test(text) && MASK_OPEN.test(text)) ? maskedSpans(text, linkRefs) : [];
  // a label's tokenization saves/restores the document-level inLink
  const savedDocInLink = inLink ? docInLink : null;
  const dummy = { t: -1, prev: null, next: null };
  let tail = dummy;
  let txt = '';
  let prevCh = null;
  function flush() {
    if (txt.length > 0) {
      const node = { t: 0, s: txt, prev: tail, next: null };
      tail.next = node;
      tail = node;
      txt = '';
    }
  }
  function pushNode(node) {
    flush();
    node.prev = tail;
    node.next = null;
    tail.next = node;
    tail = node;
    prevCh = null;
  }
  function pushText(s) {
    txt += s;
    if (s.length > 0) prevCh = s[s.length - 1];
  }
  // Is there an opener delimiter of ch still open in the nodes pushed
  // so far in this inline content? (A simplified delimiter-stack walk:
  // a closer consumes the nearest opener.) Used for the email lookahead:
  // an email at the end of an emphasis span links in full.
  function hasOpenDelim(ch) {
    let depth = 0;
    let nd = dummy.next;
    while (nd) {
      if (nd.t === 1 && nd.ch === ch) {
        if (nd.canClose && depth > 0) depth--;
        else if (nd.canOpen) depth++;
      }
      nd = nd.next;
    }
    return depth > 0;
  }
  // Autolink candidate starts, found by one native scan. The main loop
  // never stops at the letters w/h/f/m/x themselves.
  const cands = [];
  if (!inLink) {
    AUTOLINK_RE.lastIndex = 0;
    let am;
    while ((am = AUTOLINK_RE.exec(text)) !== null) cands.push(am.index);
  }
  let ci = 0;
  let i = 0;
  while (i < n) {
    JUMP_RE.lastIndex = i;
    const jm = JUMP_RE.exec(text);
    const jSpecial = jm ? jm.index : n;
    while (ci < cands.length && cands[ci] < i) ci++;
    const jCand = ci < cands.length ? cands[ci] : n;
    const j = jSpecial < jCand ? jSpecial : jCand;
    if (j > i) { pushText(text.slice(i, j)); i = j; }
    if (i >= n) break;
    if (jCand < jSpecial) {
      const ni = tryExtAutolink(text, i, n, inLink, prevCh, hasOpenDelim, pushNode, pushText);
      if (ni >= 0) { i = ni; continue; }
      pushText(text[i]);
      i++;
      continue;
    }

    if (i >= n) break;
    const c = text[i];
    if (c === '`') {
      const cs = tryCodeSpan(text, i);
      if (cs) { pushNode(cs.node); i = cs.end; continue; }
      // no matching run: emit the whole run as text
      let k = i;
      while (k < n && text[k] === '`') k++;
      pushText(text.slice(i, k));
      i = k;
      continue;
    }
    if (c === '<') {
      const al = tryAngleAutolink(text, i);
      if (al) { pushNode(al.node); i = al.end; continue; }
      const ht = tryHtmlTag(text, i);
      if (ht) {
        // an inline <a ...> tag sets the document-level inLink (it
        // stays set until an inline </a> tag clears it); a label's
        // tokenization restores it afterwards
        const tagText = ht.node.s;
        if (/^<a /i.test(tagText)) docInLink = true;
        else if (/^<\/a>/i.test(tagText)) docInLink = false;
        pushNode(ht.node); i = ht.end; continue;
      }
      pushText('<');
      i++;
      continue;
    }
    if (c === '[' || (c === '!' && i + 1 < n && text[i + 1] === '[')) {
      const lk = tryLink(text, i, linkRefs, inLink);
      if (lk) { pushNode(lk.node); i = lk.end; continue; }
      pushText(c);
      i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let k = i;
      while (k < n && text[k] === c) k++;
      const run = k - i;
      if (c === '~' && run >= 3) { pushText(text.slice(i, k)); i = k; continue; }
      const before = i > 0 ? text[i - 1] : undefined;
      const after = k < n ? text[k] : undefined;
      const beforeWs = before === undefined || isSpaceCh(before);
      const beforePunct = before !== undefined && isPunctCh(before);
      const afterWs = after === undefined || isSpaceCh(after);
      const afterPunct = after !== undefined && isPunctCh(after);
      const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
      const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
      let canOpen;
      let canClose;
      if (c === '_') {
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      if (!canOpen && !canClose) { pushText(text.slice(i, k)); i = k; continue; }
      // y is the full run length including any same-character run
      // immediately before it (e.g. an escaped `\*` before a `*` run);
      // p is the character before that extended run, o whether the run
      // is preceded by the same delimiter character at all
      let ext = i;
      while (ext > 0 && text[ext - 1] === c) ext--;
      pushNode({ t: 1, ch: c, n: run, canOpen, canClose, pos: i, before, after, y: k - ext, p: ext > 0 ? text[ext - 1] : undefined, o: ext < i, masked: isMaskedPos(maskSpans, i), prev: null, next: null });
      i = k;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < n && text[i + 1] === '\n') {
        pushNode({ t: 6, prev: null, next: null });
        i += 2;
        // leading whitespace after a hard break is stripped
        while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
        continue;
      }
      if (i + 1 < n && ASCII_PUNCT.indexOf(text[i + 1]) >= 0) {
        // an escaped character is literal text: it must not be
        // re-read as an entity or markup, so HTML-special characters
        // are pushed in their escaped form (renderText passes those
        // through unchanged). It is its own text node, so it cannot
        // join an autolink local part across the escape.
        const e = text[i + 1];
        flush();
        if (e === '&') pushText('&amp;');
        else if (e === '<') pushText('&lt;');
        else if (e === '>') pushText('&gt;');
        else if (e === '"') pushText('&quot;');
        else if (e === "'") pushText('&#39;');
        else pushText(e);
        flush();
        i += 2;
        continue;
      }
      pushText('\\');
      i++;
      continue;
    }
    if (c === '\n') {
      // hard break: 2+ trailing spaces in the current text run
      let sp = 0;
      let p = txt.length - 1;
      while (p >= 0 && txt[p] === ' ') { sp++; p--; }
      if (sp >= 2) {
        txt = txt.slice(0, txt.length - sp);
        pushNode({ t: 6, prev: null, next: null });
        i++;
        // leading whitespace after a hard break is stripped (a soft
        // break keeps it)
        while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
        continue;
      }
      pushText('\n');
      i++;
      continue;
    }
    if (c === '@' && !inLink && !docInLink) {
      // Bare email: the local part is the trailing run of local chars in the
      // current text run; the domain is matched forward in the source.
      let p = txt.length - 1;
      while (p >= 0 && isEmailLocalCh(txt[p])) p--;
      const localStart = p + 1;
      if (localStart < txt.length) {
        const dom = matchDomain(text, i + 1);
        if (dom && dom.end > i + 1) {
          const useEnd = resolveEmailEnd(text, dom, hasOpenDelim);
          if (useEnd > i + 1) {
            const email = txt.slice(localStart) + '@' + text.slice(i + 1, useEnd);
            const href = cleanUrl('mailto:' + email);
            if (href !== null) {
              txt = txt.slice(0, localStart);
              prevCh = txt.length > 0 ? txt[txt.length - 1] : null;
              pushNode({ t: 8, href, text: email, prev: null, next: null });
              i = useEnd;
              continue;
            }
          }
        }
      }
      pushText('@');
      i++;
      continue;
    }
    pushText(c);
    i++;
  }
  flush();
  processEmphasis(dummy, text);
  // a label's tokenization restores the document-level inLink
  if (savedDocInLink !== null) docInLink = savedDocInLink;
  // collect the list into an array for rendering
  const nodes = [];
  let nd = dummy.next;
  while (nd) { nodes.push(nd); nd = nd.next; }
  return nodes;
}

// Parse inline content to HTML. linkRefs is a Map of normalised label -> {dest, title}.
// Fast path: no markup char, no entity, no autolink trigger and no
// two-spaces-before-newline hard break anywhere — the text then renders
// as plain escaped text, with no node list, no emphasis scan, no masking.
// NB: schemes are case-insensitive in the slow path (it lowercases
// before testing), so the gate must match Https://, FTP:// etc too;
// www./mailto:/xmpp: are lowercase-only there.
const INLINE_CHARS = /[`*_[\]<\\!~&@]/;
const INLINE_TRIG = /www\.|[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ff][Tt][Pp]:\/\/|mailto:|xmpp:|  \n/;
const HAS_DELIM = /[*_~]/;
const MASK_OPEN = /[`[<]/;
// Jump table for the inline scanner: the next character that can start
// markup. Ordinary letters ride inside bulk slices; autolink scheme
// starts are pre-scanned separately (AUTOLINK_RE) so the loop never
// stops at the letters w/h/f/m/x themselves.
const JUMP_RE = /[`*_[\]<\\!~@\n]/g;
const AUTOLINK_RE = /www\.|[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ff][Tt][Pp]:\/\/|mailto:|xmpp:/g;
function inlineToHtml(text, linkRefs, inLink) {
  if (!INLINE_CHARS.test(text) && !INLINE_TRIG.test(text)) return escAll(text);
  return renderNodeList(inlineToNodes(text, linkRefs, inLink));
}

// Plain-text (alt) form of an inline node list: links contribute their
// label text, images their alt text, raw HTML and breaks nothing.
function altTextFromNodes(nodes) {
  let out = '';
  for (const nd of nodes) {
    switch (nd.t) {
      case 0: out += renderText(nd.s); break;
      case 1: out += nd.ch.repeat(nd.n); break;
      case 2: out += nd.html; break;
      case 3: out += nd.alt; break;
      case 4: out += escAll(nd.s); break;
      case 5: break;
      case 6: break;
      case 7: out += altTextFromNodes(nd.children); break;
      case 8: out += escAll(nd.text); break;
      default: break;
    }
  }
  return out;
}

// Does an inline node list contain a regular link, at any depth?
// (An autolink inside a label does not block the outer link; only a
// regular [text](dest) link does.)
function nodesContainLink(nodes) {
  for (const nd of nodes) {
    if (nd.t === 2) return true;
    if (nd.t === 7 && nodesContainLink(nd.children)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- blocks

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));

// Line cursor: s is the line, i the index, col the column, pend the remaining
// columns of a partially consumed tab.
function peekCursor(cursor) {
  if (cursor.pend > 0) return ' ';
  return cursor.i < cursor.s.length ? cursor.s[cursor.i] : undefined;
}
function advanceCursor(cursor) {
  if (cursor.pend > 0) { cursor.pend--; cursor.col++; return; }
  if (cursor.s[cursor.i] === '\t') { cursor.pend = 3 - (cursor.col & 3); cursor.i++; cursor.col++; }
  else { cursor.i++; cursor.col++; }
}
function advanceCursorN(cursor, n) {
  for (let k = 0; k < n; k++) advanceCursor(cursor);
}
function skipCursorSpaces(cursor) {
  let n = 0;
  while (true) {
    const c = peekCursor(cursor);
    if (c !== ' ' && c !== '\t') break;
    advanceCursor(cursor);
    n++;
  }
  return n;
}
function saveCursor(cursor) { return { i: cursor.i, col: cursor.col, pend: cursor.pend, baseCol: cursor.baseCol || 0 }; }
function restoreCursor(cursor, st) { cursor.i = st.i; cursor.col = st.col; cursor.pend = st.pend; cursor.baseCol = st.baseCol; }
function isBlankCursor(cursor) {
  // local-state scan: identical to save/skip/restore, but touches no
  // cursor fields and allocates nothing
  const s = cursor.s;
  let i = cursor.i, col = cursor.col, pend = cursor.pend;
  for (;;) {
    const c = pend > 0 ? ' ' : (i < s.length ? s[i] : undefined);
    if (c !== ' ' && c !== '\t') break;
    if (pend > 0) { pend--; col++; }
    else if (s[i] === '\t') { pend = 3 - (col & 3); i++; col++; }
    else { i++; col++; }
  }
  return i >= s.length;
}
function indentCursor(cursor) {
  // columns of leading whitespace, computed on locals (same state
  // machine as skipCursorSpaces, without touching the cursor)
  const s = cursor.s;
  let i = cursor.i, col = cursor.col, pend = cursor.pend;
  let n = 0;
  for (;;) {
    const c = pend > 0 ? ' ' : (i < s.length ? s[i] : undefined);
    if (c !== ' ' && c !== '\t') break;
    if (pend > 0) { pend--; col++; }
    else if (s[i] === '\t') { pend = 3 - (col & 3); i++; col++; }
    else { i++; col++; }
    n++;
  }
  return n;
}
// The remaining line content from the cursor, a partially consumed tab
// rendered as spaces.
function restCursor(cursor) {
  let s = '';
  if (cursor.pend > 0) s += ' '.repeat(cursor.pend);
  return s + cursor.s.slice(cursor.i);
}
// Dedent a fenced-code content line by the fence's indent, the way
// marked's Dt does: remove min(leadingWsChars, fenceIndentChars)
// CHARACTERS from the leading whitespace (a tab is one character and
// is removed whole, not expanded to columns first).
function dedentFenceLine(cursor, fi) {
  if (fi <= 0) return;
  let chars = 0;
  // a partially consumed tab is one character; removing it drops its
  // remaining spaces too
  if (cursor.pend > 0) { cursor.pend = 0; chars++; }
  while (chars < fi && cursor.i < cursor.s.length && (cursor.s[cursor.i] === ' ' || cursor.s[cursor.i] === '\t')) {
    if (cursor.s[cursor.i] === '\t') cursor.col += 4 - (cursor.col & 3);
    else cursor.col++;
    cursor.i++;
    chars++;
  }
}

// A fenced-code content line with leading tabs expanded to spaces (a tab
// advances to the next multiple of 4 columns from the starting column).
// A partially consumed tab (pend) renders as spaces first. `startCol`
// overrides the cursor's column as the tab-expansion origin: marked
// re-lexes blockquote content, so a tab inside a fence whose innermost
// container is a blockquote expands from the column the tab would have
// in the re-lexed line (the outer containers' columns forgotten).
function fencedCodeLine(cursor, startCol) {
  let out = ' '.repeat(cursor.pend);
  let col = (startCol !== undefined ? startCol : cursor.col) + cursor.pend;
  const s = cursor.s.slice(cursor.i);
  let i = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') {
      const w = 4 - (col & 3);
      out += ' '.repeat(w);
      col += w;
    } else {
      out += ' ';
      col++;
    }
    i++;
  }
  return out + s.slice(i);
}

// --- link reference definitions ------------------------------------------

// Advance past a backslash escape at text[k] (backslash + ASCII punctuation).
// Returns k + 2 when an escape is present, otherwise k.
function skipEscaped(text, k) {
  if (text[k] === '\\' && k + 1 < text.length && ASCII_PUNCT.indexOf(text[k + 1]) >= 0) return k + 2;
  return k;
}

// Parse a link destination starting at text[j] (after whitespace was skipped).
// Returns {dest, end} or null.
function parseDefDest(text, j) {
  const n = text.length;
  if (text[j] === '<') {
    let k = j + 1;
    let closed = false;
    while (k < n) {
      const stepped = skipEscaped(text, k);
      if (stepped !== k) { k = stepped; continue; }
      const c = text[k];
      if (c === '\n' || c === '<') break;
      if (c === '>') { closed = true; break; }
      k++;
    }
    if (!closed) return null;
    return { dest: unescapeStr(text.slice(j + 1, k)), end: k + 1 };
  }
  let k = j;
  let depth = 0;
  while (k < n) {
    const stepped = skipEscaped(text, k);
    if (stepped !== k) { k = stepped; continue; }
    const c = text[k];
    if (c === '(') { depth++; k++; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth--; k++; continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) break;
    k++;
  }
  if (k === j) return null;
  return { dest: unescapeStr(text.slice(j, k)), end: k };
}

// Scan a quoted span starting at text[j] ('"' or "'"). Returns the index
// just past the closing quote, or -1 when the span is not closed.
function scanQuotedSpan(text, j) {
  const n = text.length;
  const q = text[j];
  let k = j + 1;
  while (k < n) {
    const stepped = skipEscaped(text, k);
    if (stepped !== k) { k = stepped; continue; }
    if (text[k] === q) return k + 1;
    k++;
  }
  return -1;
}

// Parse a link title starting at text[j] ('"', "'" or '('). Returns {title, end} or null.
function parseDefTitle(text, j) {
  const n = text.length;
  const q = text[j];
  if (q === '"' || q === "'") {
    const end = scanQuotedSpan(text, j);
    if (end < 0) return null;
    return { title: unescapeStr(text.slice(j + 1, end - 1)), end };
  }
  if (q === '(') {
    let k = j + 1;
    while (k < n) {
      const stepped = skipEscaped(text, k);
      if (stepped !== k) { k = stepped; continue; }
      if (text[k] === '(') return null;
      if (text[k] === ')') return { title: unescapeStr(text.slice(j + 1, k)), end: k + 1 };
      k++;
    }
    return null;
  }
  return null;
}

// Find the end of a backtick run starting at text[j]; returns the index just
// past the run, and the run's length via the returned object.
function backtickRunEnd(text, j) {
  let k = j;
  while (k < text.length && text[k] === '`') k++;
  return { end: k, run: k - j };
}

// Parse one link reference definition at the start of text. Returns
// {label, dest, title, rest} or null.
function parseOneDef(text) {
  let i = 0;
  let sp = 0;
  while (i < text.length && text[i] === ' ' && sp < 3) { i++; sp++; }
  if (i >= text.length || text[i] !== '[') return null;
  // label: up to the first unescaped ']' (code spans respected, no nesting)
  let j = i + 1;
  let labelEnd = -1;
  while (j < text.length) {
    const stepped = skipEscaped(text, j);
    if (stepped !== j) { j = stepped; continue; }
    const c = text[j];
    if (c === '`') {
      const { end, run } = backtickRunEnd(text, j);
      let m = end;
      let found = -1;
      while (m < text.length) {
        if (text[m] === '`') {
          const e = backtickRunEnd(text, m);
          if (e.run === run) { found = e.end; break; }
          m = e.end;
        } else m++;
      }
      if (found < 0) { j++; continue; }
      j = found;
      continue;
    }
    if (c === ']') { labelEnd = j; break; }
    // an unescaped '[' inside a label makes the definition invalid
    if (c === '[') return null;
    j++;
  }
  if (labelEnd < 0) return null;
  const label = text.slice(i + 1, labelEnd);
  if (label.length === 0) return null;
  // a label that is only whitespace is invalid
  if (normLabel(label) === '') return null;
  j = labelEnd + 1;
  if (j >= text.length || text[j] !== ':') return null;
  j++;
  j = skipWs(text, j);
  if (j >= text.length) return null;
  const d = parseDefDest(text, j);
  if (!d) return null;
  const afterDest = d.end;
  // look for a title after whitespace (possibly on a following line);
  // a title must be separated from the destination by whitespace
  let title = null;
  let endPos = -1;
  let k = skipWs(text, afterDest);
  if (k > afterDest && k < text.length && (text[k] === '"' || text[k] === "'" || text[k] === '(')) {
    const t = parseDefTitle(text, k);
    if (!t) return null;
    title = t.title;
    endPos = defLineEnd(text, t.end);
    if (endPos < 0) {
      // trailing junk after the title: if the title is on a following
      // line, the lines up to that line are consumed and the paragraph
      // restarts from the title's line
      if (text.slice(afterDest, k).indexOf('\n') >= 0) {
        const titleLineStart = text.lastIndexOf('\n', k - 1) + 1;
        return { failedRest: text.slice(titleLineStart) };
      }
      return null;
    }
  } else {
    endPos = defLineEnd(text, afterDest);
    if (endPos < 0) return null;
  }
  return { label, dest: d.dest, title, rest: text.slice(endPos) };
}

// The end position of a definition that ends at text[pos] (after its
// destination or title): trailing spaces/tabs, then either end of input
// or a single newline. Returns -1 when other content follows.
function defLineEnd(text, pos) {
  let e = pos;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  if (e >= text.length) return e;
  if (text[e] === '\n') return e + 1;
  return -1;
}

// Remove leading link reference definitions from a paragraph's text, registering
// them in linkRefs. Returns the remaining text.
function extractDefs(text, linkRefs) {
  let rest = text;
  while (true) {
    const m = parseOneDef(rest);
    if (!m) break;
    // a failed definition whose title was on a following line consumes
    // the lines up to that line; the rest is the paragraph
    if (m.failedRest !== undefined) {
      rest = m.failedRest;
      break;
    }
    const key = normLabel(m.label);
    if (!linkRefs.has(key)) linkRefs.set(key, { dest: m.dest, title: m.title });
    rest = m.rest;
  }
  return rest;
}

// --- tables ---------------------------------------------------------------

// Trim one leading and one trailing pipe (with the spaces around them)
// from a table row line. Returns [start, end) indices into the line.
function trimPipeEdges(line) {
  let start = 0;
  let end = line.length;
  let k = 0;
  while (k < end && (line[k] === ' ' || line[k] === '\t')) k++;
  if (k < end && line[k] === '|') start = k + 1;
  k = end - 1;
  while (k >= start && (line[k] === ' ' || line[k] === '\t')) k--;
  if (k >= start && line[k] === '|') end = k;
  return [start, end];
}

// Split a table row/header line into cells on unescaped '|'. Leading/trailing
// pipes are dropped. A single cell is still a cell.
function splitTableRow(line) {
  const [start, end] = trimPipeEdges(line);
  const cells = [];
  let cell = '';
  for (let i = start; i < end; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < end && line[i + 1] === '|') { cell += '|'; i++; continue; }
    if (c === '|') { cells.push(cell); cell = ''; continue; }
    cell += c;
  }
  cells.push(cell);
  return cells;
}

// Alignment of one delimiter cell: ':---:' center, ':---' left, '---:' right,
// '---' none. Returns the alignment string (or null) or undefined when the
// cell is not a delimiter cell.
function delimiterAlign(cell) {
  const t = cell.trim();
  if (!/^:?-+:?$/.test(t)) return undefined;
  if (t[0] === ':' && t[t.length - 1] === ':') return 'center';
  if (t[0] === ':') return 'left';
  if (t[t.length - 1] === ':') return 'right';
  return null;
}

// Is the line a table delimiter row? Returns the alignments array or null.
// Every delimiter cell needs at least one '-', so a line without one
// cannot be a delimiter row.
function parseDelimiterRow(line) {
  if (line.indexOf('-') < 0) return null;
  const cells = splitTableRow(line);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const a = delimiterAlign(cell);
    if (a === undefined) return null;
    aligns.push(a);
  }
  return aligns;
}

// --- HTML blocks ----------------------------------------------------------

// Is the character a boundary after a tag name (end of line, whitespace,
// '>' or '/')?
function isTagBoundary(c) {
  return c === undefined || c === ' ' || c === '\t' || c === '\n' || c === '>' || c === '/';
}

// The tag name starting at s[j] (letters, digits, '-'), and the index just
// past it. Returns null when s[j] is not a letter.
function tagNameAfter(s, j) {
  const c0 = s[j];
  if (c0 === undefined || !((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z'))) return null;
  let k = j;
  while (k < s.length) {
    const c = s[k];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-') k++;
    else break;
  }
  return { name: s.slice(j, k).toLowerCase(), end: k };
}

// Determine the HTML block type (1-7) for a line starting at the cursor,
// or 0 when the line does not start an HTML block. The cursor is positioned
// after at most 3 spaces of indentation.
function htmlBlockType(s, i, pend) {
  if (pend > 0) return 0;
  // note: pend is 0 here (we only call this when the cursor is at a real char)
  if (i >= s.length || s[i] !== '<') return 0;
  const rest = s.slice(i + 1);
  const low = rest.toLowerCase();
  const names1 = ['script', 'pre', 'style', 'textarea'];
  for (const nm of names1) {
    if (low.startsWith(nm) && isTagBoundary(rest[nm.length])) return 1;
    if (low.startsWith(nm)) break;
  }
  if (rest.startsWith('!--')) return 2;
  if (rest.startsWith('?')) return 3;
  if (rest.startsWith('!') && rest.length > 1) {
    const c = rest[1];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) return 4;
  }
  if (rest.startsWith('![CDATA[')) return 5;
  // type 6: block tag
  let j = i + 1;
  if (s[j] === '/') j++;
  const tag = tagNameAfter(s, j);
  if (tag && BLOCK_TAGS.has(tag.name) && isTagBoundary(s[tag.end])) return 6;
  // type 7: a complete open/close tag alone on the line
  const ht = tryHtmlTag(s, i);
  if (ht) {
    let e = ht.end;
    while (e < s.length && (s[e] === ' ' || s[e] === '\t')) e++;
    if (e >= s.length) return 7;
  }
  return 0;
}

// Does this line end an HTML block of the given type?
function htmlBlockEnds(type, line) {
  const low = line.toLowerCase();
  switch (type) {
    case 1:
      return low.includes('</script') || low.includes('</pre') || low.includes('</style') || low.includes('</textarea');
    case 2: return line.includes('-->');
    case 3: return line.includes('?>');
    case 4: return line.includes('>');
    case 5: return line.includes(']]>');
    default: return false;
  }
}

// Is the line (at the cursor) a setext underline? Returns 1 for '=', 2 for '-', else 0.
function setextLevel(s, i, col, pend) {
  if (pend > 0) return 0;
  // a setext underline is indented at most 3 columns
  let j = i, ccol = col, pp = pend;
  let n = 0;
  for (;;) {
    const c = pp > 0 ? ' ' : (j < s.length ? s[j] : undefined);
    if (c !== ' ' && c !== '\t') break;
    if (pp > 0) { pp--; ccol++; }
    else if (s[j] === '\t') { pp = 3 - (ccol & 3); j++; ccol++; }
    else { j++; ccol++; }
    n++;
  }
  if (n > 3) return 0;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
  if (j >= s.length) return 0;
  const c = s[j];
  if (c !== '=' && c !== '-') return 0;
  j++;
  while (j < s.length && s[j] === c) j++;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
  if (j < s.length) return 0;
  return c === '=' ? 1 : 2;
}

// Is the line (at the cursor) a thematic break?
function isThematicBreak(s, i, pend) {
  if (pend > 0) return false;
  let c = null;
  let count = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (c === null) {
      c = ch;
      if (c !== '*' && c !== '-' && c !== '_') return false;
      count++;
      i++;
      continue;
    }
    if (ch !== c) return false;
    count++;
    i++;
  }
  return c !== null && count >= 3;
}

// --- main block parser ----------------------------------------------------

function parseBlocks(src) {
  const endsWithNL = src.length > 0 && src[src.length - 1] === '\n';
  const lines = src.split('\n');
  if (endsWithNL) lines.pop();
  const root = { t: 'doc', children: [], parent: null, lastLineBlank: false };
  const linkRefs = new Map();
  const stack = [root];

  function isContainer(node) {
    return node.t === 'quote' || node.t === 'list' || node.t === 'item';
  }

  function addChild(parent, node) {
    // tight/loose bookkeeping: a blank line before this child makes a list loose
    if (parent.lastLineBlank) {
      if (parent.t === 'list' && parent.children.length > 0) parent.loose = true;
      else if (parent.t === 'item' && parent.children.length > 0) {
        const p = parent.parent;
        if (p && p.t === 'list') p.loose = true;
      }
    }
    node.parent = parent;
    parent.children.push(node);
    return node;
  }

  function markNonBlank() {
    for (const b of stack) b.lastLineBlank = false;
  }
  function markBlank() {
    for (const b of stack) b.lastLineBlank = true;
  }

  // Extract leading defs from a paragraph node, mutating its lines.
  // Returns true when lines remain.
  function extractDefsFromPara(node) {
    // Definitions only ever start at the paragraph's start (after at
    // most 3 spaces) with '['; anything else cannot contain one, so the
    // join/split round-trip is skipped. When extractDefs finds nothing
    // it returns the input string itself, so the lines are untouched.
    const first = node.lines.length > 0 ? node.lines[0] : '';
    let p = 0;
    while (p < first.length && first[p] === ' ' && p < 3) p++;
    if (p >= first.length || first[p] !== '[') return node.lines.length > 0;
    const text = node.lines.join('\n');
    const rest = extractDefs(text, linkRefs);
    if (rest === text) return node.lines.length > 0;
    node.lines = rest === '' ? [] : rest.split('\n');
    return node.lines.length > 0;
  }

  function finalizePara(node) {
    extractDefsFromPara(node);
    if (node.lines.length === 0) {
      const idx = node.parent.children.indexOf(node);
      if (idx >= 0) node.parent.children.splice(idx, 1);
      return false;
    }
    return true;
  }

  function closeBlock(node) {
    // an HTML block that is the last child of a container gets no
    // trailing newline (the container's closing tag follows immediately)
    if ((node.t === 'quote' || node.t === 'item') && node.children.length > 0) {
      const last = node.children[node.children.length - 1];
      if (last.t === 'html') last.keepNL = false;
    }
    if (node.t === 'para') finalizePara(node);
    else if (node.t === 'code' && !node.fenced) {
      // indented code strips ALL trailing empty lines (unlike fenced
      // code, where trailing empty lines are content)
      while (node.lines.length > 0 && node.lines[node.lines.length - 1] === '') node.lines.pop();
    }
  }

  // Does the line at the cursor start a block that can interrupt a paragraph?
  // parentIsItem: the paragraph's direct parent is a list item, in which
  // case an ordered list may interrupt it whatever its start number.
  function startsBlockInterruptingPara(s, i, col, pend, parentIsItem) {
    // pure predicate: skip leading whitespace on locals
    let j = i, ccol = col, pp = pend, indent = 0;
    for (;;) {
      const c = pp > 0 ? ' ' : (j < s.length ? s[j] : undefined);
      if (c !== ' ' && c !== '\t') break;
      if (pp > 0) { pp--; ccol++; }
      else if (s[j] === '\t') { pp = 3 - (ccol & 3); j++; ccol++; }
      else { j++; ccol++; }
      indent++;
    }
    if (indent > 3) return false;
    const c = pp > 0 ? ' ' : (j < s.length ? s[j] : undefined);
    let r = false;
    if (c === '#') {
      let idx = j;
      let level = 0;
      while (idx < s.length && s[idx] === '#') { level++; idx++; }
      if (level >= 1 && level <= 6) {
        const a = idx < s.length ? s[idx] : undefined;
        if (a === undefined || a === ' ' || a === '\t') r = true;
      }
    } else if (c === '`' || c === '~') {
      let idx = j;
      while (idx < s.length && s[idx] === c) idx++;
      if (idx - j >= 3) {
        // a backtick fence whose info string contains a backtick is not
        // a fence at all, so it cannot interrupt a paragraph
        if (c === '`' && s.slice(idx).indexOf('`') >= 0) r = false;
        else r = true;
      }
    } else if (c === '<') {
      const t = htmlBlockType(s, j, pp);
      if (t >= 1 && t <= 6) r = true;
    } else if (c === '>') {
      r = true;
    } else if (c === '*' || c === '-' || c === '+' || c === '_') {
      if (isThematicBreak(s, j, pp)) r = true;
      else {
        const li = matchListItem(s, j, ccol, pp, !parentIsItem);
        if (li && !li.empty) r = true;
      }
    } else if (c !== undefined && c >= '0' && c <= '9') {
      const li = matchListItem(s, j, ccol, pp, !parentIsItem);
      if (li && !li.empty) r = true;
    }
    return r;
  }

  // Does the line at the cursor start a block (ending a table's rows)?
  function startsBlockEndingTable(s, i, col, pend) {
    let j = i, ccol = col, pp = pend, indent = 0;
    for (;;) {
      const c = pp > 0 ? ' ' : (j < s.length ? s[j] : undefined);
      if (c !== ' ' && c !== '\t') break;
      if (pp > 0) { pp--; ccol++; }
      else if (s[j] === '\t') { pp = 3 - (ccol & 3); j++; ccol++; }
      else { j++; ccol++; }
      indent++;
    }
    if (indent >= 4) return true;
    if (indent > 3) return false;
    const c = pp > 0 ? ' ' : (j < s.length ? s[j] : undefined);
    let r = false;
    if (c === '#') {
      let idx = j;
      let level = 0;
      while (idx < s.length && s[idx] === '#') { level++; idx++; }
      if (level >= 1 && level <= 6) {
        const a = idx < s.length ? s[idx] : undefined;
        if (a === undefined || a === ' ' || a === '\t') r = true;
      }
    } else if (c === '`' || c === '~') {
      let idx = j;
      while (idx < s.length && s[idx] === c) idx++;
      if (idx - j >= 3) {
        if (c === '`' && s.slice(idx).indexOf('`') >= 0) r = false;
        else r = true;
      }
    } else if (c === '<') {
      const t = htmlBlockType(s, j, pp);
      if (t >= 1 && t <= 6) r = true;
    } else if (c === '>') {
      r = true;
    } else if (c === '*' || c === '-' || c === '_') {
      if (isThematicBreak(s, j, pp)) r = true;
      else if (matchListItem(s, j, ccol, pp, false)) r = true;
    } else if (c !== undefined && c >= '0' && c <= '9') {
      if (matchListItem(s, j, ccol, pp, false)) r = true;
    }
    return r;
  }

  // Match a list item marker at the cursor (after indent was checked <= 3).
  // Returns {ordered, delim, start, contentIndent, contentStart} or null.
  // When forInterrupt is true, an empty bullet item or an ordered item not
  // starting with 1 does not count.
  function matchListItem(s, i, col, pend, forInterrupt) {
    // pure predicate: works on locals, never touches the cursor
    for (;;) {
      const c = pend > 0 ? ' ' : (i < s.length ? s[i] : undefined);
      if (c !== ' ' && c !== '\t') break;
      if (pend > 0) { pend--; col++; }
      else if (s[i] === '\t') { pend = 3 - (col & 3); i++; col++; }
      else { i++; col++; }
    }
    if (pend > 0) return null;
    const i0 = i;
    const c = s[i0];
    if (c === undefined) return null;
    let ordered = false;
    let delim = null;
    let start = 0;
    let markerEnd = 0;
    if (c === '-' || c === '+' || c === '*') {
      delim = c;
      markerEnd = i0 + 1;
    } else if (c >= '0' && c <= '9') {
      let j = i0;
      let digits = 0;
      let num = 0;
      while (j < s.length && s[j] >= '0' && s[j] <= '9' && digits < 10) { num = num * 10 + (s.charCodeAt(j) - 48); digits++; j++; }
      if (digits === 0 || digits > 9) return null;
      if (j >= s.length || (s[j] !== '.' && s[j] !== ')')) return null;
      ordered = true;
      delim = s[j];
      start = num;
      markerEnd = j + 1;
    } else return null;
    // the marker must be followed by a space/tab or EOL
    if (markerEnd >= s.length) {
      // empty item: content indent is marker width + 1; an empty item
      // never interrupts a paragraph
      if (forInterrupt) return null;
      return { ordered, delim, start, contentIndent: (markerEnd - i0) + 1, contentStart: markerEnd, empty: true };
    }
    const after = s[markerEnd];
    if (after !== ' ' && after !== '\t') return null;
    // count the whitespace columns after the marker (tabs expanded by column)
    let wsCols = 0;
    let wj = markerEnd;
    let wcol = col + (markerEnd - i0);
    while (wj < s.length) {
      const ch = s[wj];
      if (ch === ' ') { wsCols++; wj++; wcol++; continue; }
      if (ch === '\t') { const w = 4 - (wcol & 3); wsCols += w; wj++; wcol += w; continue; }
      break;
    }
    let contentIndent;
    if (wsCols === 0) {
      // cannot happen: after is a space/tab
      contentIndent = 1;
    } else if (wsCols >= 1 && wsCols <= 4) {
      contentIndent = (markerEnd - i0) + wsCols;
    } else {
      contentIndent = (markerEnd - i0) + 1;
    }
    // empty item: only whitespace to EOL; an empty item never
    // interrupts a paragraph
    if (wj >= s.length) {
      if (forInterrupt) return null;
      return { ordered, delim, start, contentIndent: (markerEnd - i0) + 1, contentStart: wj, empty: true };
    }
    if (forInterrupt && !ordered) {
      // bullet non-empty: ok
    }
    if (forInterrupt && ordered && start !== 1) return null;
    return { ordered, delim, start, contentIndent, contentStart: wj, empty: false };
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isLastLine = li === lines.length - 1;
    const cursor = { s: line, i: 0, col: 0, pend: 0, baseCol: 0 };

    // ---- phase 1: match open containers
    let depth = 0;
    // columns consumed by container levels outside the innermost
    // column-consuming level, and whether that level is a blockquote
    let outerCols = 0;
    let innermostQuote = false;
    for (let si = 1; si < stack.length; si++) {
      const node = stack[si];
      if (node.t === 'quote') {
        const saved = saveCursor(cursor);
        const cb = cursor.col;
        const indent = skipCursorSpaces(cursor);
        if (indent > 3 || peekCursor(cursor) !== '>') { restoreCursor(cursor, saved); break; }
        advanceCursor(cursor);
        if (peekCursor(cursor) === ' ' || peekCursor(cursor) === '\t') {
          if (peekCursor(cursor) === '\t') {
            // marked re-lexes blockquote content, so the whitespace
            // after '>' expands from the marker's length in the
            // re-lexed line (leading spaces + '>'), not from the
            // original column
            const reCol = indent + 1;
            const w = 4 - (reCol & 3);
            cursor.pend = w - 1;
            cursor.i++;
            cursor.col++;
          } else advanceCursor(cursor);
        }
        depth = si;
        outerCols = cb;
        innermostQuote = true;
      } else if (node.t === 'item') {
        if (isBlankCursor(cursor)) { depth = si; continue; }
        // an empty item followed by a blank line takes no further content
        if (node.children.length === 0 && node.lastLineBlank) break;
        const cb = cursor.col;
        const indent = indentCursor(cursor);
        if (indent >= node.contentIndent) {
          advanceCursorN(cursor, node.contentIndent);
          depth = si;
          outerCols = cb;
          innermostQuote = false;
        } else break;
      } else if (node.t === 'list') {
        depth = si;
      } else break;
    }
    // the line is blank iff the raw line is all whitespace, or the
    // remaining content after container matching is empty (a line
    // whose remainder is only whitespace after a container prefix was
    // consumed is content, e.g. `>  ` adds a space to the paragraph)
    const isBlankLine = /^[ \t]*$/.test(line) || (cursor.pend === 0 && cursor.i >= cursor.s.length);
    // lazy continuation: if the tip is a paragraph beyond the matched
    // containers and the line does not start a block that interrupts a
    // paragraph, keep the paragraph (and its containers) instead of
    // popping them; phase 2 then adds the line to the paragraph
    let isLazyPara = false;
    if (stack.length > 1) {
      const top = stack[stack.length - 1];
      // a list item marker ends a lazy continuation only when it can
      // start a list item (indent <= 3); at indent >= 4 it is code or
      // paragraph text, not a marker
      const lazyItem = indentCursor(cursor) <= 3 ? matchListItem(cursor.s, cursor.i, cursor.col, cursor.pend, false) : null;
      if (top.t === 'para' && stack.length - 1 > depth + 1 && !isBlankLine && !startsBlockInterruptingPara(cursor.s, cursor.i, cursor.col, cursor.pend, stack[stack.length - 2] && stack[stack.length - 2].t === 'item') && !lazyItem) {
        isLazyPara = true;
      }
    }
    if (!isLazyPara) {
      // Fenced code inside a list item: a content line that fails only
      // list-item matching (indent below the item's content indent) is
      // still code content — unless the previous line ends the item.
      // Marked's item collection breaks the item when the previous line
      // was blank, indented >= 4, or begins a fence, heading, HTML
      // block or hr; otherwise the line is consumed into the item (so a
      // fence that already has content keeps swallowing low-indent
      // lines, while a fence with no content yet is left empty).
      let keepFence = false;
      if (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top.t === 'code' && top.fenced && !isBlankLine && stack.length - 1 > depth + 1 && top.lines.length > 0) {
          let allItems = true;
          for (let si = depth + 1; si < stack.length - 1; si++) {
            if (stack[si].t !== 'item') { allItems = false; break; }
          }
          if (allItems) {
            const prev = top.lines[top.lines.length - 1];
            let prevBreaks = false;
            if (prev.trim() === '') prevBreaks = true;
            else {
              let pi = 0;
              while (pi < prev.length && prev[pi] === ' ') pi++;
              if (pi >= 4) prevBreaks = true;
              else {
                const rest = prev.slice(pi);
                if (rest.startsWith('```') || rest.startsWith('~~~')) prevBreaks = true;
                else if (/^#{1,6}(?:[ \t]|$)/.test(rest)) prevBreaks = true;
                else if (/^<(?:[A-Za-z][A-Za-z0-9-]*|!--|![A-Za-z]|\?|\/[A-Za-z])/.test(rest)) prevBreaks = true;
                else if (/^(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/.test(rest.trim())) prevBreaks = true;
              }
            }
            if (!prevBreaks) keepFence = true;
          }
        }
      }
      if (!keepFence) {
        while (stack.length > depth + 1) {
          const tip = stack[stack.length - 1];
          const isLeafTip = !isContainer(tip);
          if (isLeafTip && stack.length - 2 === depth) break;
          closeBlock(stack.pop());
        }
      }
    }
    let tip = stack[stack.length - 1];

    // ---- blank line
    if (isBlankLine) {
      // a whitespace-only line containing a tab is a table row, not a
      // blank line: marked's table body regex only treats space-only
      // lines as blank, and a tab line is indented code only when a
      // non-newline char follows the indent (here there is none). Only
      // when the line is inside the table's parent container.
      if (tip.t === 'table' && depth >= stack.length - 2 && line.indexOf('\t') >= 0) {
        let ti = 0;
        let tsp = 0;
        while (ti < line.length && line[ti] === ' ') { tsp++; ti++; }
        const isCode = (tsp >= 4 && ti < line.length) || (ti < line.length && line[ti] === '\t' && ti + 1 < line.length);
        if (!isCode) {
          tip.rows.push(splitTableRow(restCursor(cursor)));
          markNonBlank();
          continue;
        }
      }
      if (tip !== stack[depth]) {
        if (tip.t === 'para') { closeBlock(stack.pop()); }
        else if (tip.t === 'html' && (tip.htmlType === 6 || tip.htmlType === 7)) { closeBlock(stack.pop()); }
        else if (tip.t === 'table') { closeBlock(stack.pop()); }
        else if (tip.t === 'code') {
          if (tip.fenced) {
            // a blank line in fenced code is dedented like any other
            // content line (backtick fences only; tilde fences keep it)
            if (tip.fenceChar === '`') {
              const fiB = tip.fenceIndentChars !== undefined ? tip.fenceIndentChars : (tip.fenceIndent || 0);
              dedentFenceLine(cursor, fiB);
            }
            tip.lines.push(restCursor(cursor));
          } else {
            // a blank line in indented code loses 4 columns of indent
            const ind = indentCursor(cursor);
            const stripB = Math.min(4, ind);
            if (stripB > 0) advanceCursorN(cursor, stripB);
            tip.lines.push(restCursor(cursor));
          }
        }
        else if (tip.t === 'html') { tip.lines.push(''); }
      }
      // a blank line that is only container markers (e.g. `> `) is blank
      // only for the deepest matched container, not for its ancestors
      if (/^[ \t]*$/.test(line)) markBlank();
      else {
        stack[depth].lastLineBlank = true;
        // a marker-only blank line directly inside a list item separates
        // that item from the next one, so the item's list is loose too
        // (a blank line deeper inside the item, e.g. inside a nested
        // blockquote, does not: cm-320 stays tight)
        const at = stack[depth];
        if (at.t === 'item' && at.parent && at.parent.t === 'list') at.parent.lastLineBlank = true;
      }
      continue;
    }

    // ---- phase 2: leaf continuations
    if (tip.t === 'code' && tip.fenced) {
      const indent = indentCursor(cursor);
      let closed = false;
      if (indent <= 3) {
        const saved = saveCursor(cursor);
        skipCursorSpaces(cursor);
        const ch = peekCursor(cursor);
        if (ch === tip.fenceChar && cursor.pend === 0) {
          let idx = cursor.i;
          let k = 0;
          while (idx < cursor.s.length && cursor.s[idx] === ch) { k++; idx++; }
          if (k >= tip.fenceLen) {
            let ok = true;
            while (idx < cursor.s.length) {
              if (cursor.s[idx] !== ' ' && cursor.s[idx] !== '\t') { ok = false; break; }
              idx++;
            }
            if (ok) { closeBlock(stack.pop()); closed = true; }
          }
        }
        restoreCursor(cursor, saved);
      }
      if (closed) { markNonBlank(); continue; }
      // Dedent the content line by the fence's own indent. Marked's Dt
      // removes min(leadingWsChars, fenceIndentChars) CHARACTERS from
      // the line's leading whitespace (a tab is one character and is
      // removed whole, not expanded to columns first); a tilde fence
      // keeps its content lines verbatim (indentCodeCompensation only
      // matches ```).
      if (tip.fenceChar === '`') {
        const fi = tip.fenceIndentChars !== undefined ? tip.fenceIndentChars : (tip.fenceIndent || 0);
        dedentFenceLine(cursor, fi);
      }
      // a leading tab expands to spaces only when the block sits inside
      // a container (list item / blockquote); at the top level a tab
      // stays a literal tab. When the innermost container is a
      // blockquote inside another container, marked re-lexes the
      // blockquote content, so the tab expands from the column with the
      // outer containers' columns forgotten.
      const effCol = innermostQuote && outerCols > 0 ? cursor.col - outerCols : cursor.col;
      tip.lines.push(tip.parent && tip.parent.t !== 'doc' ? fencedCodeLine(cursor, effCol) : restCursor(cursor));
      markNonBlank();
      continue;
    }
    if (tip.t === 'code' && !tip.fenced) {
      const indent = indentCursor(cursor);
      if (indent >= 4) {
        advanceCursorN(cursor, 4);
        tip.lines.push(restCursor(cursor));
        markNonBlank();
        continue;
      }
      closeBlock(stack.pop());
      tip = stack[stack.length - 1];
    }
    if (tip.t === 'html') {
      const lineText = restCursor(cursor);
      tip.lines.push(lineText);
      // the block keeps a trailing newline iff it is not immediately
      // followed by a blank line (or it is the last line and the input
      // ends with a newline); for types 1-5 a whitespace-only line is
      // not a blank line for this purpose (only a truly empty line is),
      // while types 6-7 drop the newline after any blank line
      tip.keepNL = isLastLine ? endsWithNL : (tip.htmlType >= 1 && tip.htmlType <= 5 ? lines[li + 1] !== '' : !/^[ \t]*$/.test(lines[li + 1]));
      if (tip.htmlType >= 1 && tip.htmlType <= 5 && htmlBlockEnds(tip.htmlType, lineText)) {
        closeBlock(stack.pop());
      }
      markNonBlank();
      continue;
    }
    if (tip.t === 'table') {
      if (!startsBlockEndingTable(cursor.s, cursor.i, cursor.col, cursor.pend)) {
        tip.rows.push(splitTableRow(restCursor(cursor)));
        markNonBlank();
        continue;
      }
      closeBlock(stack.pop());
      tip = stack[stack.length - 1];
    }
    if (tip.t === 'para') {
      let sl = setextLevel(cursor.s, cursor.i, cursor.col, cursor.pend);
      // a setext underline that is a lazy continuation inside a blockquote
      // cannot form a heading: a level-1 underline is added to the
      // paragraph as an indented line, a level-2 underline is a
      // thematic break (handled by the interruption check below)
      const isLazyBQ = stack.length - 1 > depth + 1 && tip.parent !== null && tip.parent.t === 'quote';
      if (sl === 1 && isLazyBQ) {
        const u = restCursor(cursor).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        tip.lines.push('    ' + u);
        markNonBlank();
        continue;
      }
      if (sl === 2 && isLazyBQ) sl = 0;
      if (sl > 0) {
        const hasContent = extractDefsFromPara(tip);
        if (!hasContent) {
          // the paragraph held only definitions: remove it entirely
          // (not just from the stack) so no empty <p> is rendered
          const parent = tip.parent;
          const pidx = parent.children.indexOf(tip);
          if (pidx >= 0) parent.children.splice(pidx, 1);
          stack.pop();
          tip = stack[stack.length - 1];
          // fall through to phase 3: the setext line starts a new block
        } else {
          const heading = { t: 'heading', level: sl, lines: tip.lines, parent: null };
          const parent = tip.parent;
          const idx = parent.children.indexOf(tip);
          parent.children[idx] = heading;
          heading.parent = parent;
          stack.pop();
          markNonBlank();
          continue;
        }
      } else {
        // a leading tab in a paragraph line expands to spaces when the
        // paragraph sits inside a container (marked re-lexes the
        // container content); at the top level it stays a literal tab
        const paraEffCol = innermostQuote && outerCols > 0 ? cursor.col - outerCols : cursor.col;
        const rest = tip.parent && tip.parent.t !== 'doc' ? fencedCodeLine(cursor, paraEffCol) : restCursor(cursor);
        // a delimiter row is indented at most 3 columns
        const aligns = indentCursor(cursor) <= 3 ? parseDelimiterRow(rest) : null;
        if (aligns) {
          const hasContent = extractDefsFromPara(tip);
          if (!hasContent) {
            const parent = tip.parent;
            const pidx = parent.children.indexOf(tip);
            if (pidx >= 0) parent.children.splice(pidx, 1);
            stack.pop();
            tip = stack[stack.length - 1];
            // fall through to phase 3
          } else {
            const headerCells = splitTableRow(tip.lines[tip.lines.length - 1]);
            if (headerCells.length === aligns.length) {
              const preLines = tip.lines.slice(0, tip.lines.length - 1);
              const table = { t: 'table', header: headerCells, aligns, rows: [], parent: null };
              const parent = tip.parent;
              const idx = parent.children.indexOf(tip);
              parent.children[idx] = table;
              table.parent = parent;
              stack.pop();
              stack.push(table);
              if (preLines.length > 0) {
                const pre = { t: 'para', lines: preLines, parent: null };
                parent.children.splice(idx, 0, pre);
                pre.parent = parent;
                finalizePara(pre);
                if (pre.lines.length === 0) {
                  const pi = parent.children.indexOf(pre);
                  if (pi >= 0) parent.children.splice(pi, 1);
                }
              }
              markNonBlank();
              continue;
            }
            tip.lines.push(rest);
            markNonBlank();
            continue;
          }
        } else if (startsBlockInterruptingPara(cursor.s, cursor.i, cursor.col, cursor.pend, stack[stack.length - 2] && stack[stack.length - 2].t === 'item')) {
          closeBlock(stack.pop());
          tip = stack[stack.length - 1];
          // fall through to phase 3
        } else {
          // lazy continuation: the line did not match the paragraph's
          // containers, so it is added with its leading whitespace
          // minus 4 columns when it is indented by 4 or more (a
          // 4-space lazy line is dedented to the margin, a shorter
          // one is kept as-is)
          if (stack.length - 1 > depth + 1) {
            const indent = indentCursor(cursor);
            const strip = indent >= 4 ? 4 : 0;
            if (strip > 0) {
              advanceCursorN(cursor, strip);
              tip.lines.push(restCursor(cursor));
            } else {
              tip.lines.push(rest);
            }
          } else {
            tip.lines.push(rest);
          }
          markNonBlank();
          continue;
        }
      }
    }

    // ---- phase 3: start new blocks (loop: containers may nest)
    while (true) {
      // a line whose remainder is only whitespace starts no block
      if (/^[ \t]*$/.test(restCursor(cursor))) break;
      let container = stack[stack.length - 1];
      // a list may only contain items: if the line does not start a
      // same-type item, close the list and retry in its parent
      if (container.t === 'list') {
        const indent0 = indentCursor(cursor);
        let matched = null;
        let leadCols = 0;
        if (indent0 <= 3) {
          const saved0 = saveCursor(cursor);
          skipCursorSpaces(cursor);
          // a thematic break takes precedence over a list item
          if (!isThematicBreak(cursor.s, cursor.i, cursor.pend)) {
            const li0 = matchListItem(cursor.s, cursor.i, cursor.col, cursor.pend, false);
            if (li0 && li0.ordered === container.ordered && li0.delim === container.delim) {
              matched = li0;
              leadCols = cursor.col - saved0.col;
            }
          }
          if (!matched) restoreCursor(cursor, saved0);
        }
        if (matched) {
          // the stored content indent is the absolute column of the
          // content (leading indent + marker-relative indent); the
          // marker column is kept for lazy-line dedenting
          const item = { t: 'item', contentIndent: leadCols + matched.contentIndent, markerCol: leadCols, children: [], parent: null, lastLineBlank: false };
          addChild(container, item);
          stack.push(item);
          // the cursor is at the marker (matchListItem restores it)
          advanceCursorN(cursor, matched.contentIndent);
          if (matched.empty) {
            markNonBlank();
            break;
          }
          continue;
        }
        closeBlock(stack.pop());
        continue;
      }
      const iterStart = saveCursor(cursor);
      const indent = indentCursor(cursor);
      if (indent <= 3) {
        const saved = saveCursor(cursor);
        skipCursorSpaces(cursor);
        const c = peekCursor(cursor);
        // blockquote
        if (c === '>') {
          const bq = { t: 'quote', children: [], parent: null, lastLineBlank: false };
          addChild(container, bq);
          stack.push(bq);
          advanceCursor(cursor);
          if (peekCursor(cursor) === ' ' || peekCursor(cursor) === '\t') advanceCursor(cursor);
          continue;
        }
        // ATX heading
        if (c === '#') {
          let idx = cursor.i;
          let level = 0;
          while (idx < cursor.s.length && cursor.s[idx] === '#') { level++; idx++; }
          if (level >= 1 && level <= 6) {
            const a = idx < cursor.s.length ? cursor.s[idx] : undefined;
            if (a === undefined || a === ' ' || a === '\t') {
              // the closing sequence is a run of # preceded by a space;
              // it is checked before the leading spaces are stripped,
              // so the space after the opening hashes can precede it
              let content = cursor.s.slice(idx);
              content = content.replace(/[ \t]+$/, '');
              const m = /[ \t]+#+$/.exec(content);
              if (m) content = content.slice(0, m.index);
              content = content.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
              const hd = { t: 'heading', level, lines: [content], parent: null };
              addChild(container, hd);
              markNonBlank();
              break;
            }
          }
        }
        // fenced code
        if (c === '`' || c === '~') {
          let idx = cursor.i;
          while (idx < cursor.s.length && cursor.s[idx] === c) idx++;
          const run = idx - cursor.i;
          if (run >= 3) {
            let info = cursor.s.slice(idx);
            let okFence = true;
            if (c === '`' && info.indexOf('`') >= 0) okFence = false;
            if (okFence) {
              info = info.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
              // content lines are dedented by the fence's own indent
              const fenceIndent = cursor.col - iterStart.col;
              // marked's Dt removes min(leadingWsChars, fenceIndentChars)
              // CHARACTERS (a tab is one character); store the indent in
              // characters too (cursor.i counts characters, not columns)
              const fenceIndentChars = cursor.i - iterStart.i;
              const code = { t: 'code', fenced: true, fenceChar: c, fenceLen: run, info: info === '' ? null : info, fenceIndent, fenceIndentChars, lines: [], parent: null };
              addChild(container, code);
              stack.push(code);
              markNonBlank();
              break;
            }
          }
        }
        // HTML block
        if (c === '<') {
          const t = htmlBlockType(cursor.s, cursor.i, cursor.pend);
          if (t >= 1 && t <= 7) {
            restoreCursor(cursor, iterStart);
            const firstLine = restCursor(cursor);
            const html = { t: 'html', htmlType: t, lines: [firstLine], keepNL: isLastLine ? endsWithNL : (t >= 1 && t <= 5 ? lines[li + 1] !== '' : !/^[ \t]*$/.test(lines[li + 1])), parent: null };
            addChild(container, html);
            // types 1-5 can already end on their first line
            if (t >= 1 && t <= 5 && htmlBlockEnds(t, firstLine)) {
              // closed immediately; not pushed
            } else {
              stack.push(html);
            }
            markNonBlank();
            break;
          }
        }
        // thematic break
        if (c === '*' || c === '-' || c === '_') {
          if (isThematicBreak(cursor.s, cursor.i, cursor.pend)) {
            const hr = { t: 'hr', parent: null };
            addChild(container, hr);
            markNonBlank();
            break;
          }
        }
        // list item
        if (c === '-' || c === '+' || c === '*' || (c !== undefined && c >= '0' && c <= '9')) {
          const li2 = matchListItem(cursor.s, cursor.i, cursor.col, cursor.pend, false);
          if (li2) {
            // a list of a different type ends the current list
            if (container.t === 'list') {
              const same = li2.ordered === container.ordered && li2.delim === container.delim;
              if (!same) {
                closeBlock(stack.pop());
                container = stack[stack.length - 1];
              }
            }
            let list = null;
            if (container.t === 'list') list = container;
            if (!list) {
              list = { t: 'list', ordered: li2.ordered, delim: li2.delim, start: li2.ordered ? li2.start : null, loose: false, children: [], parent: null, lastLineBlank: false };
              addChild(container, list);
              stack.push(list);
            }
            const leadCols = cursor.col - iterStart.col;
            const item = { t: 'item', contentIndent: leadCols + li2.contentIndent, markerCol: leadCols, children: [], parent: null, lastLineBlank: false };
            addChild(list, item);
            stack.push(item);
            // the cursor is at the marker (matchListItem restores it); advance
            // by the marker-relative content indent to reach the item's content
            advanceCursorN(cursor, li2.contentIndent);
            if (li2.empty) {
              markNonBlank();
              break;
            }
            continue;
          }
        }
        restoreCursor(cursor, saved);
      }
      // indented code
      if (indent >= 4) {
        restoreCursor(cursor, iterStart);
        advanceCursorN(cursor, 4);
        const code = { t: 'code', fenced: false, info: null, lines: [restCursor(cursor)], parent: null };
        addChild(container, code);
        stack.push(code);
        markNonBlank();
        break;
      }
      // paragraph
      restoreCursor(cursor, iterStart);
      // a leading tab in a paragraph inside a container expands like a
      // continuation line (marked re-lexes the container content); at
      // the top level it stays a literal tab
      const paraCreateEffCol = innermostQuote && outerCols > 0 ? cursor.col - outerCols : cursor.col;
      const para = { t: 'para', lines: [container && container.t !== 'doc' ? fencedCodeLine(cursor, paraCreateEffCol) : restCursor(cursor)], parent: null, lastLineBlank: false };
      addChild(container, para);
      stack.push(para);
      markNonBlank();
      break;
    }
  }

  while (stack.length > 1) closeBlock(stack.pop());
  return { doc: root, linkRefs };
}
