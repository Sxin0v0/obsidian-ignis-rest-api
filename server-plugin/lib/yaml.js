class YamlError extends Error {}

function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote && s[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}
function parseScalar(raw) {
  const s = stripComment(String(raw)).trim();
  if (s === '') return '';
  if (s === 'null' || s === '~') return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s[0] === '"') { try { return JSON.parse(s); } catch {} }
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    try { return JSON.parse(s.replace(/'/g, '"')); } catch {}
    if (s.startsWith('[')) return splitFlow(s.slice(1, -1)).map(parseScalar);
    const out = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const i = part.indexOf(':'); if (i > 0) out[part.slice(0, i).trim()] = parseScalar(part.slice(i + 1));
    }
    return out;
  }
  return s;
}
function splitFlow(s) {
  const out = []; let start = 0, depth = 0, quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '{') depth++; else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  if (s.slice(start).trim()) out.push(s.slice(start).trim());
  return out;
}
function linesOf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((raw, index) => ({ raw, index, indent: raw.match(/^ */)[0].length, trimmed: raw.trim() }));
}
function nextMeaningful(lines, from) { for (let i = from; i < lines.length; i++) if (lines[i].trimmed && !lines[i].trimmed.startsWith('#')) return lines[i]; return null; }
function parseYaml(text) {
  const lines = linesOf(text);
  function parseNode(start, indent) {
    const first = nextMeaningful(lines, start);
    const isSeq = first && first.indent === indent && first.trimmed.startsWith('- ');
    const container = isSeq ? [] : {};
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trimmed || line.trimmed.startsWith('#')) { i++; continue; }
      if (line.indent < indent) break;
      if (line.indent > indent) { i++; continue; }
      if (isSeq) {
        if (!line.trimmed.startsWith('-')) break;
        const body = line.trimmed.slice(1).trimStart();
        if (!body) {
          const next = nextMeaningful(lines, i + 1);
          if (next && next.indent > indent) { const parsed = parseNode(i + 1, next.indent); container.push(parsed.value); i = parsed.next; continue; }
          container.push(null); i++; continue;
        }
        const m = /^([^:#][^:]*):\s*(.*)$/.exec(body);
        if (m) {
          const obj = {}; const key = unquoteKey(m[1].trim());
          if (m[2] !== '') obj[key] = parseScalar(m[2]);
          else {
            const next = nextMeaningful(lines, i + 1);
            if (next && next.indent > indent) { const parsed = parseNode(i + 1, next.indent); obj[key] = parsed.value; i = parsed.next; container.push(obj); continue; }
            obj[key] = null;
          }
          container.push(obj); i++; continue;
        }
        container.push(parseScalar(body)); i++; continue;
      }
      const m = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(line.trimmed);
      if (!m) throw new YamlError(`Cannot parse frontmatter line ${line.index + 1}: ${line.raw}`);
      const key = unquoteKey(m[1].trim()); const tail = m[2] ?? '';
      if (tail === '|' || tail === '>') {
        const folded = tail === '>'; const parts = []; i++;
        while (i < lines.length && (lines[i].trimmed === '' || lines[i].indent > indent)) { parts.push(lines[i].raw.slice(Math.min(lines[i].raw.length, indent + 2))); i++; }
        container[key] = folded ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n'); continue;
      }
      if (tail !== '') { container[key] = parseScalar(tail); i++; continue; }
      const next = nextMeaningful(lines, i + 1);
      if (next && next.indent > indent) { const parsed = parseNode(i + 1, next.indent); container[key] = parsed.value; i = parsed.next; continue; }
      container[key] = null; i++;
    }
    return { value: container, next: i };
  }
  const first = nextMeaningful(lines, 0);
  if (!first) return {};
  return parseNode(0, first.indent).value;
}
function unquoteKey(key) { return ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) ? key.slice(1, -1) : key; }
function plainString(s) { return /^[A-Za-z0-9_./@ -]+$/.test(s) && !/^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(s) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s); }
function dumpScalar(v) {
  if (v === null) return 'null'; if (v === true) return 'true'; if (v === false) return 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return plainString(v) ? v : JSON.stringify(v);
  if (v === undefined) return 'null';
  return JSON.stringify(v);
}
function dumpYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((v) => {
      if (v && typeof v === 'object') return `${pad}-\n${dumpYaml(v, indent + 2)}`;
      return `${pad}- ${dumpScalar(v)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return `${pad}{}`;
    return entries.map(([k, v]) => {
      const key = /^[A-Za-z0-9_.-]+$/.test(k) ? k : JSON.stringify(k);
      if (v && typeof v === 'object') return `${pad}${key}:\n${dumpYaml(v, indent + 2)}`;
      return `${pad}${key}: ${dumpScalar(v)}`;
    }).join('\n');
  }
  return `${pad}${dumpScalar(value)}`;
}

module.exports = { YamlError, parseYaml, dumpYaml, parseScalar, dumpScalar };
