const crypto = require('crypto');
const { parseYaml, dumpYaml, YamlError } = require('./yaml');
const { ApiError, ERROR_CODES, apiError, statusError } = require('./errors');

const DUPLICATE_MARKER = String.fromCodePoint(0xfc750);
const DUPLICATE_DIGITS = Array.from({ length: 16 }, (_, i) => String.fromCodePoint(0xf6440 + i));
const DUPLICATE_SUFFIX_RE = new RegExp(`${DUPLICATE_MARKER}[${DUPLICATE_DIGITS.join('')}]+$`, 'u');
const TARGET_TYPES = new Set(['heading', 'block', 'frontmatter']);
const OPERATIONS = new Set(['replace', 'prepend', 'append', 'delete']);
const SCOPES = new Set(['content', 'marker', 'markerAndContent', 'parent']);
const VALID_CELLS = {
  heading: { content: ['replace','prepend','append','delete'], marker: ['replace','prepend','append','delete'], markerAndContent: ['replace','prepend','append','delete'], parent: ['replace'] },
  block: { content: ['replace','prepend','append','delete'], marker: ['replace','delete'], markerAndContent: ['replace','prepend','append','delete'], parent: [] },
  frontmatter: { content: ['replace','prepend','append','delete'], marker: ['replace'], markerAndContent: ['replace','prepend','append','delete'], parent: [] },
};

class PatchError extends ApiError {}
class TargetNotFoundError extends PatchError { constructor(message) { super(message, { statusCode: 404 }); } }
class PreconditionFailedError extends PatchError { constructor(message) { super(message, { statusCode: 412 }); } }
class ContentPreexistsError extends PatchError { constructor(message) { super(message, { statusCode: 409 }); } }
class FrontmatterKeyCollisionError extends PatchError { constructor(message) { super(message, { statusCode: 409 }); } }

function versionOf(document) { return crypto.createHash('sha256').update(String(document), 'utf8').digest('hex').slice(0, 6); }
function lineEndingOf(text) { return String(text).includes('\r\n') ? '\r\n' : '\n'; }
function normalizeEol(text, le) { return String(text).replace(/\r\n|\r|\n/g, le); }
function encodeOccurrenceSuffix(index) { return index.toString(16).split('').map((h) => DUPLICATE_DIGITS[parseInt(h, 16)]).join(''); }
function disambiguate(raw, occurrence) { return occurrence <= 0 ? raw : raw + DUPLICATE_MARKER + encodeOccurrenceSuffix(occurrence - 1); }

function splitLines(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    const start = i;
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    const contentEnd = i;
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2; else if (text[i] === '\r' || text[i] === '\n') i += 1;
    out.push({ start, contentEnd, end: i, content: text.slice(start, contentEnd), eol: text.slice(contentEnd, i) });
  }
  if (text.length === 0 || (out.length && out[out.length - 1].end === text.length && out[out.length - 1].eol)) {
    out.push({ start: text.length, contentEnd: text.length, end: text.length, content: '', eol: '' });
  }
  return out;
}

function frontmatterBounds(text) {
  const leMatch = /^(---)(\r\n|\r|\n)/.exec(text);
  if (!leMatch) return null;
  const openEnd = leMatch[0].length;
  const rx = /^(---)[ \t]*(?:\r\n|\r|\n|$)/gm;
  rx.lastIndex = openEnd;
  const close = rx.exec(text);
  if (!close) return null;
  return {
    start: 0,
    bodyStart: openEnd,
    bodyEnd: close.index,
    end: close.index + close[0].length,
    body: text.slice(openEnd, close.index),
  };
}
function parseFrontmatter(text) {
  const bounds = frontmatterBounds(text);
  if (!bounds) return {};
  try { const value = parseYaml(bounds.body); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch (e) { throw apiError(ERROR_CODES.InvalidFrontmatter, e.message); }
}
function frontmatterPairs(text) { const obj = parseFrontmatter(text); return Object.entries(obj); }
function serializeFrontmatter(pairs, le) {
  if (!pairs.length) return '';
  const obj = {}; for (const [key, value] of pairs) obj[key] = value;
  return `---${le}${normalizeEol(dumpYaml(obj), le)}${le}---${le}`;
}

function trimTrailingGap(text, start, end) {
  let i = end;
  while (i > start) {
    if (text.slice(Math.max(start, i - 2), i) === '\r\n') i -= 2;
    else if (text[i - 1] === '\n' || text[i - 1] === '\r') i -= 1;
    else break;
  }
  if (i === start) return start;
  if (text.slice(i, i + 2) === '\r\n') return i + 2;
  if (text[i] === '\r' || text[i] === '\n') return i + 1;
  return i;
}
function consumeTrailingBlank(text, from) {
  let i = from;
  const eat = () => {
    if (text.slice(i, i + 2) === '\r\n') { i += 2; return true; }
    if (text[i] === '\r' || text[i] === '\n') { i += 1; return true; }
    return false;
  };
  eat(); eat(); return i;
}
function lineStartGap(text, at, le) { return at === 0 || text[at - 1] === '\n' || text[at - 1] === '\r' ? '' : le; }
function hasBlankBefore(text, at) { return at === 0 || /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)$/.test(text.slice(Math.max(0, at - 6), at)); }
function hasBlankAfter(text, at) { return at >= text.length || /^(?:[ \t]*(?:\r\n|\r|\n)){2}/.test(text.slice(at)); }
function padBlock(text, at, value, { before = false, after = false, le = '\n' } = {}) {
  if (!value) return '';
  let prefix = lineStartGap(text, at, le); let suffix = '';
  if (before && !hasBlankBefore(text, at)) prefix = (at > 0 && !prefix ? le + le : prefix + le);
  if (after && !hasBlankAfter(text, at)) suffix = le + le;
  return prefix + value + suffix;
}
function splice(text, start, end, replacement) { return text.slice(0, start) + replacement + text.slice(end); }
function trimBlankEdges(text) { return String(text).replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '').replace(/(?:\r\n|\r|\n)[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)*$/, ''); }

function relevelText(text, delta, le) {
  const warnings = [];
  const normalized = normalizeEol(text, le);
  const lines = normalized.split(le);
  const out = lines.map((line) => {
    const m = /^(#{1,})([ \t]+)(.*)$/.exec(line);
    if (!m) return line;
    let level = m[1].length + delta;
    if (level < 1) level = 1;
    if (level > 6) warnings.push({ code: 'heading-depth-overflow', message: `Heading ${JSON.stringify(m[3])} resolves to level ${level}, beyond Markdown's maximum of 6.` });
    return '#'.repeat(level) + m[2] + m[3];
  });
  return { text: out.join(le), warnings };
}
function sectionFragment(content, baseline, le) {
  const raw = trimBlankEdges(normalizeEol(content, le));
  if (!raw) return { text: '', warnings: [] };
  const r = relevelText(raw, baseline, le);
  return { text: r.text + le, warnings: r.warnings };
}

function topLevelBlocks(text, start, end) {
  const lines = splitLines(text).filter((l) => l.start >= start && l.start < end);
  const blocks = []; let current = null; let fence = null;
  const finish = () => { if (current) { current.end = Math.min(current.end, end); blocks.push(current); current = null; } };
  for (const line of lines) {
    const visible = line.content;
    const fenceMatch = /^\s*(```+|~~~+)/.exec(visible);
    if (fence) {
      if (!current) current = { start: line.start, end: line.contentEnd, kind: 'code' };
      current.end = line.contentEnd;
      if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(visible)) { fence = null; }
      continue;
    }
    if (fenceMatch) {
      finish(); fence = fenceMatch[1]; current = { start: line.start, end: line.contentEnd, kind: 'code' }; continue;
    }
    if (!visible.trim()) { finish(); continue; }
    if (/^\s*\^[A-Za-z0-9_-]+\s*$/.test(visible)) { continue; }
    if (!current) current = { start: line.start, end: line.contentEnd, kind: classifyBlockLine(visible) };
    else current.end = line.contentEnd;
  }
  finish(); return blocks;
}
function classifyBlockLine(line) {
  if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) return 'list';
  if (/^\s*>/.test(line)) return 'blockquote';
  if (/^\s*#{1,6}\s+/.test(line)) return 'heading';
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table';
  if (/^\s*!?\[.*?\]\(.*?\)/.test(line)) return 'image';
  return 'paragraph';
}
function tableColumns(text, start, end) {
  const raw = text.slice(start, end).replace(/\r\n|\r/g, '\n'); const lines = raw.split('\n');
  if (lines.length < 2 || !/^\s*\|?.*\|.*\|?\s*$/.test(lines[0]) || !/^\s*\|?\s*:?-{3,}/.test(lines[1])) return null;
  return splitTableLine(lines[0]);
}
function splitTableLine(line) {
  let s = line.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = []; let cur = ''; let esc = false;
  for (const ch of s) { if (esc) { cur += ch; esc = false; } else if (ch === '\\') { cur += ch; esc = true; } else if (ch === '|') { cells.push(cur.trim()); cur = ''; } else cur += ch; }
  cells.push(cur.trim()); return cells;
}

function buildModel(document) {
  const text = String(document); const le = lineEndingOf(text); const fm = frontmatterBounds(text); const bodyStart = fm ? fm.end : 0;
  let frontmatter = {};
  if (fm) { try { frontmatter = parseYaml(fm.body); } catch (e) { throw apiError(ERROR_CODES.InvalidFrontmatter, e.message); } }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) frontmatter = {};
  const root = { title: null, key: null, level: 0, markerStart: bodyStart, markerEnd: bodyStart, contentStart: bodyStart, directBodyEnd: text.length, rawEnd: text.length, children: [], parent: null, path: [], bodyChildren: [] };
  const headings = []; const stack = [root];
  for (const line of splitLines(text)) {
    if (line.start < bodyStart) continue;
    const m = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(line.content);
    if (!m) continue;
    const level = m[1].length; while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop(); const parent = stack[stack.length - 1];
    const h = { title: m[2], key: m[2], level, markerStart: line.start, markerEnd: line.contentEnd, contentStart: line.end, contentEnd: text.length, directBodyEnd: text.length, rawEnd: text.length, children: [], parent, path: [...parent.path, m[2]], bodyChildren: [] };
    parent.children.push(h); headings.push(h); stack.push(h);
  }
  const all = [root, ...headings];
  for (let i = 0; i < all.length; i++) {
    const h = all[i]; const next = headings.find((x) => x.markerStart > h.markerStart && x.level <= h.level); h.rawEnd = next ? next.markerStart : text.length; h.contentEnd = h.rawEnd; const firstChild = h.children[0]; h.directBodyEnd = firstChild ? firstChild.markerStart : h.rawEnd;
  }
  const assignKeys = (node) => { const counts = new Map(); for (const c of node.children) { const n = counts.get(c.title) || 0; c.key = disambiguate(c.title, n); counts.set(c.title, n + 1); assignKeys(c); } };
  assignKeys(root);
  for (const h of all) {
    if (h === root) h.contentStart = bodyStart;
    const ranges = topLevelBlocks(text, h.contentStart, h.directBodyEnd); h.bodyChildren = ranges.map((r, index) => ({ index, ...r, text: text.slice(r.start, r.end), columns: r.kind === 'table' ? tableColumns(text, r.start, r.end) : null }));
  }
  const blockCandidates = [];
  const lines = splitLines(text);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]; if (line.start < bodyStart) continue; const inline = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(line.content); if (!inline) continue;
    const id = inline[1]; let markerStart = line.start + inline.index + (line.content[inline.index] === ' ' ? 1 : 0); let markerEnd = line.contentEnd; let contentStart = line.start; let contentEnd = markerStart; let fullStart = line.start; let fullEnd = line.end;
    if (/^\s*\^[A-Za-z0-9_-]+\s*$/.test(line.content)) { let p = li - 1; while (p >= 0 && !lines[p].content.trim()) p--; if (p >= 0) { contentStart = lines[p].start; while (p > 0 && lines[p - 1].content.trim()) { p--; contentStart = lines[p].start; } contentEnd = line.start; fullStart = contentStart; } }
    else { contentEnd = markerStart; }
    blockCandidates.push({ id, key: id, markerStart, markerEnd, contentStart, contentEnd, fullStart, fullEnd, kind: classifyBlockLine(text.slice(contentStart, contentEnd).split(/\r\n|\r|\n/)[0] || ''), columns: tableColumns(text, contentStart, contentEnd) });
  }
  const bCounts = new Map(); for (const b of blockCandidates) { const n = bCounts.get(b.id) || 0; b.key = disambiguate(b.id, n); bCounts.set(b.id, n + 1); }
  const entries = Object.entries(frontmatter);
  return { text, lineEnding: le, version: versionOf(text), root, headings, blocks: blockCandidates, frontmatter: { bounds: fm, object: frontmatter, entries }, bodyStart };
}
function projectMap(document) {
  const m = buildModel(document); const headings = {};
  const add = (dst, children) => { for (const h of children) { dst[h.key] = {}; add(dst[h.key], h.children); } }; add(headings, m.root.children);
  return { version: m.version, frontmatterFields: m.frontmatter.entries.map(([k]) => k), headings, blocks: m.blocks.map((b) => b.key) };
}
function legacyDocumentMap(document) {
  const m = buildModel(document); const root = { type: 'root', children: [] };
  const convert = (h) => ({ type: 'heading', name: h.title, level: h.level, children: h.children.map(convert) }); root.children = m.root.children.map(convert); return root;
}

function normalizeHeadingTarget(target, options = {}) {
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') { if (options.legacyDelimiter && target.includes(options.legacyDelimiter)) return target.split(options.legacyDelimiter).map((s) => s.trim()); return [target]; }
  return [];
}
function resolveHeading(model, target, options = {}) {
  const parts = normalizeHeadingTarget(target, options); let node = model.root;
  for (const part of parts) { const found = node.children.find((c) => c.key === part || c.title === part); if (!found) return null; node = found; }
  return node === model.root ? null : node;
}
function resolveBlock(model, id) { return model.blocks.find((b) => b.key === id || b.id === id) || null; }

function delevel(content, baseline, le) { return relevelText(content, -(baseline - 1), le).text; }
function directHeadingBody(model, h) { return model.text.slice(h.contentStart, h.directBodyEnd).replace(/(?:\r\n|\r|\n)+$/, ''); }
function rawHeadingContent(model, h) { return model.text.slice(h.contentStart, h.rawEnd).replace(/(?:\r\n|\r|\n)+$/, ''); }
function readTarget(document, spec = {}) {
  const model = buildModel(document); const scope = spec.scope || 'content'; if (!['content','marker','markerAndContent'].includes(scope)) throw apiError(ERROR_CODES.InvalidPatchInstruction, 'invalid read scope');
  if (spec.targetType === 'heading') { const h = resolveHeading(model, spec.target); if (!h) throw new TargetNotFoundError(`heading ${JSON.stringify(spec.target)} was not found`); if (scope === 'marker') return h.title; if (scope === 'content') return delevel(rawHeadingContent(model,h), h.level, model.lineEnding); return delevel(model.text.slice(h.markerStart,h.rawEnd).replace(/(?:\r\n|\r|\n)+$/, ''), h.level-1, model.lineEnding); }
  if (spec.targetType === 'block') { const b = resolveBlock(model, String(spec.target)); if (!b) throw new TargetNotFoundError(`block ${JSON.stringify(spec.target)} was not found`); if (scope === 'marker') return b.id; if (scope === 'content') return model.text.slice(b.contentStart,b.contentEnd).trimEnd(); return model.text.slice(b.fullStart,b.fullEnd).trimEnd(); }
  if (spec.targetType === 'frontmatter') { const key = String(spec.target); if (!Object.prototype.hasOwnProperty.call(model.frontmatter.object,key)) throw new TargetNotFoundError(`frontmatter key ${JSON.stringify(key)} was not found`); if (scope === 'marker') return key; if (scope === 'content') return model.frontmatter.object[key]; return { [key]: model.frontmatter.object[key] }; }
  throw apiError(ERROR_CODES.InvalidPatchInstruction, `invalid target type ${JSON.stringify(spec.targetType)}`);
}

function instructionContentNeed(ins) { return ins.operation !== 'delete' && ins.scope !== 'parent' && !(ins.targetType === 'frontmatter' && ins.scope !== 'marker'); }
function normalizeInstruction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw apiError(ERROR_CODES.InvalidPatchInstruction, 'Patch instruction must be an object.'); const ins = { ...raw };
  if (!TARGET_TYPES.has(ins.targetType)) throw apiError(ERROR_CODES.InvalidPatchInstruction, `invalid targetType ${JSON.stringify(ins.targetType)}`); if (!OPERATIONS.has(ins.operation)) throw apiError(ERROR_CODES.InvalidPatchInstruction, `invalid operation ${JSON.stringify(ins.operation)}`); ins.scope = ins.scope || 'content'; if (!SCOPES.has(ins.scope)) throw apiError(ERROR_CODES.InvalidPatchInstruction, `invalid scope ${JSON.stringify(ins.scope)}`);
  if (!VALID_CELLS[ins.targetType][ins.scope]?.includes(ins.operation)) throw apiError(ERROR_CODES.InvalidPatchInstruction, `${ins.operation} is invalid for ${ins.targetType}/${ins.scope}`);
  if (ins.targetType === 'heading') ins.target = normalizeHeadingTarget(ins.target); else if (typeof ins.target !== 'string') throw apiError(ERROR_CODES.InvalidPatchInstruction, 'Block/frontmatter target must be a string.');
  if (instructionContentNeed(ins) && typeof ins.content !== 'string') throw apiError(ERROR_CODES.InvalidPatchInstruction, "Text operation requires a string 'content'.");
  if (ins.targetType === 'frontmatter' && ins.scope !== 'marker' && ins.operation !== 'delete') { if (!Object.prototype.hasOwnProperty.call(ins,'value')) { if (typeof ins.content === 'string') { try { ins.value = parseYaml(ins.content); } catch (e) { ins.value = ins.content; } } else throw apiError(ERROR_CODES.InvalidPatchInstruction, "Frontmatter operation requires 'value'."); } }
  if (ins.within !== undefined && (!Number.isInteger(ins.within) || ins.targetType !== 'heading' || ins.scope !== 'content' || !['replace','prepend','append','delete'].includes(ins.operation))) throw apiError(ERROR_CODES.InvalidWithinHeader);
  return ins;
}
function targetSlice(model, ins, target) {
  if (ins.targetType === 'heading') { if (ins.scope === 'marker') return [target.markerStart,target.markerEnd]; if (ins.scope === 'markerAndContent') return [target.markerStart,target.rawEnd]; if (ins.scope === 'parent') return [target.markerStart,target.rawEnd]; return [target.contentStart,target.rawEnd]; }
  if (ins.targetType === 'block') { if (ins.scope === 'marker') return [target.markerStart,target.markerEnd]; if (ins.scope === 'markerAndContent') return [target.fullStart,target.fullEnd]; return [target.contentStart,target.contentEnd]; }
  return null;
}
function assertPreconditions(document, model, ins, target) {
  if (ins.ifMatch && ins.ifMatch !== model.version) throw new PreconditionFailedError(`document version ${model.version} does not match ifMatch ${ins.ifMatch}`);
  if (ins.rejectIfContentPreexists && typeof ins.content === 'string') {
    let content;
    if (ins.targetType === 'heading') content = rawHeadingContent(model,target); else if (ins.targetType === 'block') content = model.text.slice(target.contentStart,target.contentEnd); else content = JSON.stringify(model.frontmatter.object[ins.target]);
    if (String(content).includes(ins.content)) throw new ContentPreexistsError('the requested content already exists in the target');
  }
}
function patchV2(document, rawInstruction) {
  const ins = normalizeInstruction(rawInstruction); const model = buildModel(document); let target = null;
  if (ins.targetType === 'heading') target = resolveHeading(model, ins.target); else if (ins.targetType === 'block') target = resolveBlock(model, ins.target); else target = Object.prototype.hasOwnProperty.call(model.frontmatter.object,ins.target) ? { key: ins.target } : null;
  if (!target && ins.createTargetIfMissing) { if (ins.targetType === 'heading') return createHeading(document, model, ins); if (ins.targetType === 'block') return createBlock(document, model, ins); if (ins.targetType === 'frontmatter') return patchFrontmatter(document,model,ins); }
  if (!target) throw new TargetNotFoundError(`${ins.targetType} ${JSON.stringify(ins.target)} was not found`); assertPreconditions(document, model, ins, target);
  if (ins.targetType === 'heading') return patchHeading(document, model, ins, target); if (ins.targetType === 'block') return patchBlock(document,model,ins,target); return patchFrontmatter(document,model,ins);
}

function patchHeading(document, model, ins, h) {
  const le = model.lineEnding;
  if (ins.within !== undefined) return patchHeadingWithin(document, model, ins, h);
  if (ins.scope === 'parent') return moveHeading(document,model,ins,h);
  if (ins.operation === 'delete') {
    if (ins.scope === 'content') return { document: splice(document,h.contentStart,h.rawEnd,''), warnings: [] };
    if (ins.scope === 'marker') { const childRaw = document.slice(h.contentStart,h.rawEnd); const rr = relevelText(childRaw,-1,le); return { document: splice(document,h.markerStart,h.rawEnd,rr.text), warnings: rr.warnings }; }
    return { document: splice(document,h.markerStart,h.rawEnd,''), warnings: [] };
  }
  if (ins.scope === 'marker') return patchHeadingMarker(document,model,ins,h);
  if (ins.scope === 'markerAndContent') {
    const frag = sectionFragment(ins.content,h.parent.level,le); if (ins.operation === 'replace') return { document: splice(document,h.markerStart,h.rawEnd,frag.text), warnings: frag.warnings }; const before = ins.operation === 'prepend'; const at = before ? h.markerStart : h.rawEnd; return { document: splice(document,at,at,padBlock(document,at,frag.text,{before:!before,after:before,le})), warnings: frag.warnings };
  }
  const frag = sectionFragment(ins.content,h.level,le); const directEnd = h.directBodyEnd;
  if (ins.operation === 'replace') { const tail = document.slice(directEnd,h.rawEnd); return { document: splice(document,h.contentStart,h.rawEnd,frag.text+tail), warnings: frag.warnings }; }
  const at = ins.operation === 'prepend' ? h.contentStart : directEnd; return { document: splice(document,at,at,padBlock(document,at,frag.text,{before:ins.operation==='append',after:ins.operation==='prepend'&&h.children.length>0,le})), warnings: frag.warnings };
}
function patchHeadingMarker(document, model, ins, h) {
  const marker = document.slice(h.markerStart,h.markerEnd); const content = ins.content; const currentTitle = h.title;
  if (ins.operation === 'replace') { const next = marker.replace(currentTitle,content); return { document: splice(document,h.markerStart,h.markerEnd,next), warnings: [] }; }
  if (ins.operation === 'prepend') return { document: splice(document,h.markerStart,h.markerEnd,marker.replace(currentTitle,content+currentTitle)), warnings: [] };
  return { document: splice(document,h.markerStart,h.markerEnd,marker.replace(currentTitle,currentTitle+content)), warnings: [] };
}
function patchHeadingWithin(document, model, ins, h) {
  const blocks = h.bodyChildren; let idx = ins.within; if (idx < 0) idx = blocks.length + idx; if (idx < 0 || idx >= blocks.length) throw new TargetNotFoundError(`within index ${ins.within} is outside heading body (${blocks.length} blocks)`); const b = blocks[idx];
  if (ins.operation === 'delete') return { document: splice(document,b.start,b.end,''), warnings: [] }; const value = normalizeEol(ins.content,model.lineEnding); if (ins.operation === 'replace') return { document: splice(document,b.start,b.end,value), warnings: [] }; const at = ins.operation === 'prepend'?b.start:b.end; return { document: splice(document,at,at,value), warnings: [] };
}
function moveHeading(document, model, ins, h) {
  const d = ins.destination || ins.value || {}; let parent = model.root; if (d.parent !== undefined && d.parent !== null) { parent = resolveHeading(model,d.parent); if (!parent) throw new TargetNotFoundError(`destination parent ${JSON.stringify(d.parent)} was not found`); if (parent === h || parent.path.slice(0,h.path.length).every((v,i)=>v===h.path[i])) throw apiError(ERROR_CODES.PatchFailed,'cannot move a heading into its own subtree'); }
  let at = parent === model.root ? document.length : parent.rawEnd; if (d.position === 'start') at = parent === model.root ? model.bodyStart : parent.contentStart;
  if (d.before) { const s = resolveHeading(model,[...parent.path,...normalizeHeadingTarget(d.before)]); if (!s) throw new TargetNotFoundError('before-heading destination not found'); at = s.markerStart; }
  if (d.after) { const s = resolveHeading(model,[...parent.path,...normalizeHeadingTarget(d.after)]); if (!s) throw new TargetNotFoundError('after-heading destination not found'); at = s.rawEnd; }
  const sourceStart = h.markerStart; const sourceEnd = h.rawEnd; const delta = (parent.level || 0) + 1 - h.level; const rr = relevelText(document.slice(sourceStart, h.contentEnd), delta, model.lineEnding);
  let moved = rr.text; if (moved && !moved.endsWith(model.lineEnding)) moved += model.lineEnding;
  if (at === sourceStart || at === sourceEnd) return { document: splice(document, sourceStart, h.contentEnd, rr.text), warnings: rr.warnings };
  let without = splice(document, sourceStart, sourceEnd, ''); let adjustedAt = at > sourceEnd ? at - (sourceEnd - sourceStart) : at;
  moved = lineStartGap(without, adjustedAt, model.lineEnding) + moved;
  return { document: splice(without, adjustedAt, adjustedAt, moved), warnings: rr.warnings };
}

function patchBlock(document, model, ins, b) {
  const le = model.lineEnding;
  if (ins.operation === 'delete') {
    if (ins.scope === 'content') return { document: splice(document, b.contentStart, b.contentEnd, ''), warnings: [] };
    if (ins.scope === 'marker') return { document: splice(document, b.markerStart, b.markerEnd, ''), warnings: [] };
    return { document: splice(document, b.fullStart, consumeTrailingBlank(document, b.fullEnd), ''), warnings: [] };
  }
  if (ins.scope === 'content' && Object.prototype.hasOwnProperty.call(ins, 'value')) return patchTableRows(document, model, ins, b);
  const value = normalizeEol(ins.content, le);
  if (ins.scope === 'content') {
    if (ins.operation === 'replace') return { document: splice(document, b.contentStart, b.contentEnd, value), warnings: [] };
    if (ins.operation === 'prepend') return { document: splice(document, b.contentStart, b.contentStart, value), warnings: [] };
    return { document: splice(document, b.contentEnd, b.contentEnd, value), warnings: [] };
  }
  if (ins.scope === 'marker') {
    if (!/^[A-Za-z0-9_-]+$/.test(ins.content)) throw apiError(ERROR_CODES.InvalidPatchInstruction, 'Block id must contain only letters, digits, underscore, or hyphen.');
    const marker = document.slice(b.markerStart, b.markerEnd).replace(/\^[A-Za-z0-9_-]+/, '^' + ins.content);
    return { document: splice(document, b.markerStart, b.markerEnd, marker), warnings: [] };
  }
  if (ins.operation === 'replace') return { document: splice(document, b.fullStart, b.fullEnd, value), warnings: [] };
  const sep = le + le; if (ins.operation === 'prepend') return { document: splice(document, b.fullStart, b.fullStart, value + sep), warnings: [] };
  return { document: splice(document, b.fullEnd, b.fullEnd, sep + value), warnings: [] };
}
function patchTableRows(document, model, ins, b) {
  if (b.kind !== 'table' || !b.columns) throw apiError(ERROR_CODES.PatchFailed, `block ${JSON.stringify(b.id)} is not a table; row writes require a table block`);
  if (!Array.isArray(ins.value) || !ins.value.every((row) => Array.isArray(row) && row.every((c) => typeof c === 'string'))) throw apiError(ERROR_CODES.InvalidPatchInstruction, 'Table row value must be string[][].');
  for (const row of ins.value) if (row.length !== b.columns.length) throw apiError(ERROR_CODES.PatchFailed, `row has ${row.length} cells; table has ${b.columns.length} columns`);
  const raw = document.slice(b.contentStart, b.contentEnd); const trailing = /(?:\r\n|\r|\n)$/.test(raw); const lines = raw.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/); const existing = lines.slice(2);
  const format = (row) => '| ' + row.map((c) => { if (/[\r\n]/.test(c)) throw apiError(ERROR_CODES.PatchFailed, 'Table cell cannot contain a line break.'); return c.replace(/\|/g, '\\|'); }).join(' | ') + ' |';
  const incoming = ins.value.map(format); const rows = ins.operation === 'replace' ? incoming : ins.operation === 'prepend' ? [...incoming, ...existing] : [...existing, ...incoming]; const next = [lines[0] || '', lines[1] || '', ...rows].join(model.lineEnding) + (trailing ? model.lineEnding : '');
  return { document: splice(document, b.contentStart, b.contentEnd, next), warnings: [] };
}

function mergeValues(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (isPlain(a) && isPlain(b)) return { ...a, ...b };
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  throw apiError(ERROR_CODES.PatchFailed, 'frontmatter values are not mergeable (need two lists, two dictionaries, or two strings)');
}
function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function patchFrontmatter(document, model, ins) {
  const pairs = model.frontmatter.entries.map(([k,v]) => [k,v]); const key = ins.target; let idx = pairs.findIndex(([k]) => k === key);
  if (idx < 0) {
    const creatable = ins.createTargetIfMissing && ((ins.scope === 'content' && ins.operation !== 'delete') || (ins.scope === 'markerAndContent' && ins.operation === 'replace'));
    if (!creatable) throw new TargetNotFoundError(`frontmatter key ${JSON.stringify(key)} was not found`);
    const content = Object.prototype.hasOwnProperty.call(ins,'value') ? ins.value : ''; const seed = Array.isArray(content) ? [] : isPlain(content) ? {} : ''; pairs.push([key, seed]); idx = pairs.length - 1;
  }
  if (ins.scope === 'marker') {
    const newKey = ins.content; if (newKey !== key && pairs.some(([k]) => k === newKey)) throw new FrontmatterKeyCollisionError(`cannot rename frontmatter key ${JSON.stringify(key)} to ${JSON.stringify(newKey)}: key exists`); pairs[idx] = [newKey, pairs[idx][1]];
  } else if (ins.operation === 'delete') {
    if (ins.scope === 'content') pairs[idx] = [key, null]; else pairs.splice(idx, 1);
  } else if (ins.scope === 'content') {
    if (ins.operation === 'replace') pairs[idx] = [key, ins.value]; else { const current = pairs[idx][1]; pairs[idx] = [key, ins.operation === 'append' ? mergeValues(current, ins.value) : mergeValues(ins.value, current)]; }
  } else if (ins.operation === 'replace') pairs[idx] = [key, ins.value];
  else {
    if (!isPlain(ins.value)) throw apiError(ERROR_CODES.PatchFailed, 'inserting frontmatter entries requires a dictionary'); const incoming = Object.entries(ins.value); const collision = incoming.find(([k]) => pairs.some(([e]) => e === k)); if (collision) throw new FrontmatterKeyCollisionError(`cannot insert frontmatter key ${JSON.stringify(collision[0])}: key exists`); pairs.splice(ins.operation === 'prepend' ? idx : idx + 1, 0, ...incoming);
  }
  const bounds = model.frontmatter.bounds || { start: 0, end: 0 }; return { document: splice(document, bounds.start, bounds.end, serializeFrontmatter(pairs, model.lineEnding)), warnings: [] };
}

function createHeading(document, model, ins) {
  if (ins.operation === 'delete' || ins.scope === 'parent' || ins.scope !== 'content') throw new TargetNotFoundError('cannot create a heading for this instruction'); const path = ins.target || []; if (!path.length) throw apiError(ERROR_CODES.PatchFailed, 'the document root cannot be created');
  let ancestor = model.root, matched = 0;
  for (let len = path.length - 1; len >= 1; len--) { const r = resolveHeading(model, path.slice(0,len)); if (r) { ancestor = r; matched = len; break; } }
  const rest = path.slice(matched); let level = ancestor.level || 0; const parts = []; const warnings = [];
  for (const seg of rest) { level++; if (level > 6) warnings.push({ code:'heading-depth-overflow', message:`Created heading ${JSON.stringify(seg)} resolves to level ${level}, beyond Markdown maximum 6.` }); parts.push('#'.repeat(level) + ' ' + seg + model.lineEnding); }
  const body = sectionFragment(ins.content, level, model.lineEnding); parts.push(body.text); warnings.push(...body.warnings); const at = ancestor === model.root ? document.length : ancestor.rawEnd;
  return { document: splice(document, at, at, lineStartGap(document, at, model.lineEnding) + parts.join('')), warnings };
}
function createBlock(document, model, ins) {
  if (ins.operation === 'delete' || ins.scope !== 'content' || typeof ins.content !== 'string') throw apiError(ERROR_CODES.PatchFailed, 'createTargetIfMissing for blocks supports content-scope text writes only'); const value = normalizeEol(ins.content, model.lineEnding); const block = `${value} ^${ins.target}`; const le = model.lineEnding; const sep = !document ? '' : document.endsWith(le+le) ? '' : document.endsWith(le) ? le : le+le; return { document: document + sep + block + le, warnings: [] };
}

function legacyPatch(document, instruction) {
  const targetType = instruction.targetType; const operation = instruction.operation; const scope = instruction.targetScope || 'content';
  if (!TARGET_TYPES.has(targetType)) throw apiError(ERROR_CODES.InvalidTargetTypeHeader); if (!OPERATIONS.has(operation)) throw apiError(ERROR_CODES.InvalidOperation); if (!['content','marker','markerAndContent'].includes(scope)) throw apiError(ERROR_CODES.InvalidTargetScopeHeader);
  const target = targetType === 'heading' ? normalizeHeadingTarget(instruction.target, { legacyDelimiter: instruction.targetDelimiter || '::' }) : instruction.target;
  const converted = { targetType, target, operation, scope, createTargetIfMissing: !!instruction.createTargetIfMissing, rejectIfContentPreexists: !!instruction.rejectIfContentPreexists };
  if (operation !== 'delete') {
    if (targetType === 'frontmatter' && scope !== 'marker') converted.value = instruction.value !== undefined ? instruction.value : instruction.content;
    else converted.content = String(instruction.content ?? '');
  }
  return patchV2(document, converted);
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
module.exports = {
  DUPLICATE_MARKER, DUPLICATE_DIGITS, versionOf, frontmatterBounds, parseFrontmatter, buildModel, projectMap, legacyDocumentMap,
  resolveHeading, resolveBlock, readTarget, patchV2, legacyPatch, relevelText, topLevelBlocks,
  PatchError, TargetNotFoundError, PreconditionFailedError, ContentPreexistsError, FrontmatterKeyCollisionError,
};
