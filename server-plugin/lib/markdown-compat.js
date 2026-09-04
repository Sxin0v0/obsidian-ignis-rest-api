'use strict';

// Compatibility facade for the Markdown engine. It normalizes the public
// target-read/document-map shapes used by the REST/MCP service and keeps a
// small number of early-v1 engine differences behind one stable interface.
const base = require('./markdown');

function readTarget(document, spec = {}) {
  if (spec.within !== undefined && spec.targetType === 'heading') {
    const model = base.buildModel(document);
    const heading = base.resolveHeading(model, spec.target);
    if (!heading) throw new base.TargetNotFoundError(`Target not found: heading ${JSON.stringify(spec.target)}`);
    const blocks = heading.bodyChildren || [];
    let index = Number(spec.within);
    if (index < 0) index = blocks.length + index;
    const block = blocks[index];
    if (!block) throw new base.TargetNotFoundError(`Body block ${spec.within} not found.`);
    return { kind: 'heading', content: model.text.slice(block.start, block.end) };
  }

  const result = base.readTarget(document, spec);
  if (result && typeof result === 'object' && typeof result.kind === 'string') return result;

  if (spec.targetType === 'frontmatter') return { kind: 'frontmatter', value: result };
  if (spec.targetType === 'heading' && (spec.scope || 'content') === 'content') {
    const model = base.buildModel(document);
    return { kind: 'heading', content: base.relevelText(String(result), -1, model.lineEnding).text };
  }
  return { kind: spec.targetType, content: result };
}

function legacyDocumentMap(document) {
  const result = base.legacyDocumentMap(document);
  if (result && Array.isArray(result.headings)) return result;
  const model = base.buildModel(document);
  return {
    headings: model.headings.map((h) => (h.path || []).join('::')),
    blocks: model.blocks.map((b) => b.id || b.key),
    frontmatterFields: model.frontmatter.entries.map(([key]) => key),
  };
}

function splitTableLine(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = []; let current = ''; let escaped = false;
  for (const ch of s) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\') { current += ch; escaped = true; continue; }
    if (ch === '|') { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function legacyTablePatch(document, instruction) {
  const model = base.buildModel(document);
  const block = base.resolveBlock(model, String(instruction.target));
  if (!block || !Array.isArray(instruction.value)) return null;

  const le = model.lineEnding || (String(document).includes('\r\n') ? '\r\n' : '\n');
  const lines = String(document).split(le);
  const before = String(document).slice(0, block.contentStart);
  const targetLine = before.split(le).length - 1;
  let first = targetLine;
  while (first > 0 && /^\s*\|.*\|\s*$/.test(lines[first - 1] || '')) first--;
  const group = lines.slice(first, targetLine + 1);
  const sepOffset = group.findIndex((line) => /^\s*\|?\s*:?-{3,}/.test(line));
  if (sepOffset < 1) return null;
  const columns = splitTableLine(group[sepOffset - 1]).length;
  if (!instruction.value.every((row) => Array.isArray(row) && row.length === columns && row.every((cell) => typeof cell === 'string'))) return null;
  const format = (row) => '| ' + row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ') + ' |';
  const incoming = instruction.value.map(format);

  const dataStart = first + sepOffset + 1;
  if (instruction.operation === 'prepend') lines.splice(dataStart, 0, ...incoming);
  else if (instruction.operation === 'append') lines.splice(targetLine + 1, 0, ...incoming);
  else if (instruction.operation === 'replace') lines.splice(dataStart, targetLine - dataStart + 1, ...incoming);
  else return null;
  return { document: lines.join(le), warnings: [] };
}

function patchV2(document, instruction) {
  try {
    return base.patchV2(document, instruction);
  } catch (error) {
    const isTableCarrier =
      instruction &&
      instruction.targetType === 'block' &&
      Object.prototype.hasOwnProperty.call(instruction, 'value') &&
      !Object.prototype.hasOwnProperty.call(instruction, 'content') &&
      instruction.operation !== 'delete';
    if (!isTableCarrier) throw error;

    if (/Text operation requires a string ['"]content['"]/.test(String(error?.message || ''))) {
      try {
        return base.patchV2(document, { ...instruction, content: '' });
      } catch (second) {
        const fallback = legacyTablePatch(document, instruction);
        if (fallback) return fallback;
        throw second;
      }
    }
    const fallback = legacyTablePatch(document, instruction);
    if (fallback) return fallback;
    throw error;
  }
}

module.exports = {
  ...base,
  readTarget,
  legacyDocumentMap,
  patchV2,
};
