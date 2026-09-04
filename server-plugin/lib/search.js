const path = require('path');
const { walkFiles, readFile, fileStat, statPath, normalizeRelativePath } = require('./vault');
const { parseFrontmatter } = require('./markdown');
const { apiError, ERROR_CODES } = require('./errors');

function extractTags(text, frontmatter = {}) {
  const tags = new Set();
  const bodyWithoutFm = String(text).replace(/^---(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---(?:\r\n|\r|\n|$)/, '');
  const stripped = bodyWithoutFm.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
  const rx = /(^|[\s(\[{:;,])#([\p{L}\p{N}_/-]+)/gu; let m;
  while ((m = rx.exec(stripped))) if (m[2]) tags.add(m[2]);
  const fm = frontmatter.tags ?? frontmatter.tag; const values = Array.isArray(fm) ? fm : typeof fm === 'string' ? fm.split(/[ ,]+/) : [];
  for (const v of values) if (String(v).trim()) tags.add(String(v).replace(/^#/, '').trim());
  return [...tags];
}
function hierarchyTags(tags) { const out = new Set(); for (const tag of tags) { out.add(tag); const p = tag.split('/'); for (let i=1;i<p.length;i++) out.add(p.slice(0,i).join('/')); } return [...out]; }
function extractLinkTexts(text) {
  const out = [];
  const wiki = /\[\[([^\]]+)\]\]/g; let m;
  while ((m = wiki.exec(text))) { const raw = m[1]; const dest = raw.split('|')[0].trim(); if (dest) out.push(dest); }
  const md = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g;
  while ((m = md.exec(text))) if (m[1] && !/^[a-z][a-z0-9+.-]*:/i.test(m[1]) && !m[1].startsWith('#')) out.push(decodeMaybe(m[1]));
  return out;
}
function decodeMaybe(s) { try { return decodeURIComponent(s); } catch { return s; } }
function normalizeLinkTarget(source, raw) {
  let value = String(raw).split('#')[0].trim().replace(/\\/g,'/'); if (!value) return null;
  if (value.startsWith('/')) value = value.slice(1); else value = path.posix.join(path.posix.dirname(source), value);
  value = path.posix.normalize(value); if (value.startsWith('../')) return null; return value;
}
async function buildFileIndex(root) {
  const files = []; const set = new Set(); const basename = new Map();
  for await (const rel of walkFiles(root, '', { markdownOnly: true })) { files.push(rel); set.add(rel); const base = path.posix.basename(rel, '.md').toLowerCase(); if (!basename.has(base)) basename.set(base, []); basename.get(base).push(rel); }
  return { files, set, basename };
}
function resolveLink(index, source, raw) {
  let normalized = normalizeLinkTarget(source, raw); if (!normalized) return null;
  const candidates = [normalized, /\.[a-z0-9]+$/i.test(normalized) ? normalized : normalized + '.md'];
  for (const c of candidates) if (index.set.has(c)) return c;
  const base = path.posix.basename(normalized, path.posix.extname(normalized)).toLowerCase(); const hits = index.basename.get(base); return hits?.length === 1 ? hits[0] : null;
}
async function metadataForFile(root, rel, { includeContent = true, index = null, backlinkIndex = null } = {}) {
  const content = (await readFile(root, rel)).toString('utf8'); const frontmatter = parseFrontmatter(content); const tags = hierarchyTags(extractTags(content, frontmatter)); const idx = index || await buildFileIndex(root);
  const rawLinks = extractLinkTexts(content); const links = []; const unresolvedLinks = [];
  for (const raw of rawLinks) { const resolved = resolveLink(idx, rel, raw); if (resolved) { if (!links.includes(resolved)) links.push(resolved); } else if (!unresolvedLinks.includes(raw)) unresolvedLinks.push(raw); }
  let backlinks = [];
  if (backlinkIndex) backlinks = backlinkIndex.get(rel) || [];
  else {
    const back = []; for (const other of idx.files) { if (other === rel) continue; const t = (await readFile(root, other)).toString('utf8'); if (extractLinkTexts(t).some((raw) => resolveLink(idx, other, raw) === rel)) back.push(other); } backlinks = back;
  }
  const stat = await fileStat(root, rel); return { tags, frontmatter, stat, path: rel, content: includeContent ? content : '', links, backlinks, unresolvedLinks };
}
async function buildBacklinks(root, index) {
  const result = new Map(index.files.map((f) => [f, []]));
  for (const source of index.files) { const text = (await readFile(root, source)).toString('utf8'); for (const raw of extractLinkTexts(text)) { const dest = resolveLink(index, source, raw); if (dest && result.has(dest) && !result.get(dest).includes(source)) result.get(dest).push(source); } }
  return result;
}
function widenCodePoint(text, start, end) { if (start > 0 && start < text.length) { const c=text.charCodeAt(start); if (c>=0xdc00&&c<=0xdfff) start--; } if (end>0&&end<text.length){const c=text.charCodeAt(end-1);if(c>=0xd800&&c<=0xdbff)end++;} return [start,end]; }
function simpleMatch(haystack, query) {
  const q = String(query); if (!q) return null; const lower = haystack.toLocaleLowerCase(); const needle = q.toLocaleLowerCase(); const matches=[]; let from=0;
  while (matches.length<100) { const i=lower.indexOf(needle,from); if(i<0)break; matches.push([i,i+q.length]); from=i+Math.max(1,q.length); }
  if(!matches.length)return null; return { score: matches.length * 10 - (matches[0][0]/Math.max(1,haystack.length)), matches };
}
async function simpleSearch(root, query, contextLength = 100) {
  if (typeof query !== 'string') throw apiError(ERROR_CODES.InvalidSearch, "A single '?query=' parameter is required."); const results=[];
  for await (const rel of walkFiles(root,'',{markdownOnly:true})) {
    const content=(await readFile(root,rel)).toString('utf8'); const basename=path.posix.basename(rel,'.md'); const prefix=basename+'\n\n'; const r=simpleMatch(prefix+content,query); if(!r)continue; const matches=[];
    for(const [a,b] of r.matches){ if(a<prefix.length&&b<=prefix.length){matches.push({match:{start:a,end:Math.min(b,basename.length),source:'filename'},context:basename});} else if(a>=prefix.length){const s=a-prefix.length,e=b-prefix.length;const [ws,we]=widenCodePoint(content,Math.max(0,s-contextLength),Math.min(content.length,e+contextLength));matches.push({match:{start:s,end:e,source:'content'},context:content.slice(ws,we)});} }
    results.push({filename:rel,score:r.score,matches});
  }
  results.sort((a,b)=>(b.score||0)-(a.score||0)); return results;
}
function getVar(data, name, defaultValue) { if (name === '' || name == null) return data; const v=String(name).split('.').reduce((c,k)=>c==null?undefined:c[k],data); return v===undefined?defaultValue:v; }
function truthy(v){if(v==null)return false;if(Array.isArray(v))return v.length>0;if(typeof v==='object')return Object.keys(v).length>0;return Boolean(v);}
function wildcardToRegex(glob){return new RegExp('^'+String(glob).replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'.*').replace(/\*/g,'[^/]*').replace(/\?/g,'.')+'$');}
function evalLogic(rule,data){
  if(Array.isArray(rule))return rule.map((x)=>evalLogic(x,data)); if(rule===null||typeof rule!=='object')return rule; const keys=Object.keys(rule); if(keys.length!==1)return rule; const op=keys[0],raw=rule[op]; const args=Array.isArray(raw)?raw:[raw];
  if(op==='var')return getVar(data,args[0],args[1]); if(op==='missing')return args.filter((n)=>getVar(data,n)===undefined); if(op==='missing_some'){const need=args[0],names=args[1]||[];const missing=names.filter((n)=>getVar(data,n)===undefined);return names.length-missing.length>=need?[]:missing;}
  if(op==='and'){let v;for(const a of args){v=evalLogic(a,data);if(!truthy(v))return v;}return v;} if(op==='or'){let v;for(const a of args){v=evalLogic(a,data);if(truthy(v))return v;}return v;} if(op==='!')return !truthy(evalLogic(raw,data)); if(op==='!!')return truthy(evalLogic(raw,data));
  const v=args.map((x)=>evalLogic(x,data)); if(op==='==')return v[0]==v[1]; if(op==='===')return v[0]===v[1]; if(op==='!=')return v[0]!=v[1]; if(op==='!==')return v[0]!==v[1]; if(op==='>')return chain(v,(a,b)=>a>b); if(op==='>=')return chain(v,(a,b)=>a>=b); if(op==='<')return chain(v,(a,b)=>a<b); if(op==='<=')return chain(v,(a,b)=>a<=b); if(op==='+')return v.reduce((a,b)=>Number(a)+Number(b),0); if(op==='-')return v.length===1?-Number(v[0]):Number(v[0])-Number(v[1]); if(op==='*')return v.reduce((a,b)=>Number(a)*Number(b),1); if(op==='/')return Number(v[0])/Number(v[1]); if(op==='%')return Number(v[0])%Number(v[1]); if(op==='min')return Math.min(...v.map(Number)); if(op==='max')return Math.max(...v.map(Number));
  if(op==='in'){const [needle,hay]=v;return typeof hay==='string'?hay.includes(String(needle)):Array.isArray(hay)?hay.includes(needle):false;} if(op==='cat')return v.join(''); if(op==='substr'){const s=String(v[0]);return v.length>2?s.substr(Number(v[1]),Number(v[2])):s.substr(Number(v[1]));}
  if(op==='if'||op==='?:'){for(let i=0;i<v.length-1;i+=2)if(truthy(v[i]))return v[i+1];return v.length%2?v[v.length-1]:null;} if(op==='merge')return v.flatMap((x)=>Array.isArray(x)?x:[x]);
  if(op==='glob')return wildcardToRegex(v[0]).test(String(v[1]??'')); if(op==='regexp'){try{return new RegExp(String(v[0]),String(v[2]||'')).test(String(v[1]??''));}catch(e){throw new Error(`Invalid regexp: ${e.message}`);}}
  throw new Error(`Unrecognized operation ${op}`);
}
function chain(values,fn){for(let i=0;i<values.length-1;i++)if(!fn(values[i],values[i+1]))return false;return true;}
async function structuredSearch(root, query) {
  const results=[]; const index=await buildFileIndex(root); const backlinks=await buildBacklinks(root,index); const includeContent=JSON.stringify(query).includes('"content"');
  for(const rel of index.files){const ctx=await metadataForFile(root,rel,{includeContent,index,backlinkIndex:backlinks});let value;try{value=evalLogic(query,ctx);}catch(e){throw apiError(ERROR_CODES.InvalidFilterQuery,`${e.message} (while processing ${rel})`);}if(truthy(value))results.push({filename:rel,result:value});}return results;
}
async function tagCounts(root){const counts={};for await(const rel of walkFiles(root,'',{markdownOnly:true})){const text=(await readFile(root,rel)).toString('utf8');const tags=extractTags(text,parseFrontmatter(text));for(const tag of tags){counts[tag]=(counts[tag]||0)+1;const parts=tag.split('/');for(let i=1;i<parts.length;i++){const p=parts.slice(0,i).join('/');counts[p]=(counts[p]||0)+1;}}}return Object.entries(counts).filter(([n])=>n).map(([name,count])=>({name,count})).sort((a,b)=>a.name.localeCompare(b.name));}
module.exports={extractTags,hierarchyTags,extractLinkTexts,buildFileIndex,resolveLink,metadataForFile,buildBacklinks,simpleSearch,evalLogic,structuredSearch,tagCounts,truthy};
