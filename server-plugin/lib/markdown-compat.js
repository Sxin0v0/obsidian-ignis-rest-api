'use strict';

// Compatibility facade for the Markdown engine. It normalizes the public
// target-read/document-map shapes used by the REST/MCP service and keeps
// table-row patch instructions compatible with earlier v1 development builds.
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

function patchV2(document, instruction) {
  try {
    return base.patchV2(document, instruction);
  } catch (error) {
    const isLegacyTableCarrier =
      instruction &&
      instruction.targetType === 'block' &&
      Object.prototype.hasOwnProperty.call(instruction, 'value') &&
      !Object.prototype.hasOwnProperty.call(instruction, 'content') &&
      instruction.operation !== 'delete' &&
      /Text operation requires a string ['"]content['"]/.test(String(error?.message || ''));
    if (!isLegacyTableCarrier) throw error;
    return base.patchV2(document, { ...instruction, content: '' });
  }
}

module.exports = {
  ...base,
  readTarget,
  legacyDocumentMap,
  patchV2,
};
