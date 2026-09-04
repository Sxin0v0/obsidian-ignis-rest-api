const fs = require('fs');
const path = require('path');
const { apiError, statusError, ERROR_CODES } = require('./errors');
const SKIP_DIRS = new Set(['.git', '.trash', 'node_modules']);

function normalizeRelativePath(rel = '') {
  let value = String(rel).replace(/\\/g, '/');
  if (value.includes('\0')) throw apiError(ERROR_CODES.PathTraversalNotAllowed, 'NUL bytes are not allowed in paths.');
  if (value.startsWith('/')) throw apiError(ERROR_CODES.PathTraversalNotAllowed, 'Absolute paths are not allowed.');
  value = value.replace(/^\.\//, '');
  const normalized = path.posix.normalize(value || '.');
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) throw apiError(ERROR_CODES.PathTraversalNotAllowed);
  return normalized === '.' ? '' : normalized;
}
function resolveVaultPath(vaultRoot, rel = '') {
  const safe = normalizeRelativePath(rel); const base = path.resolve(vaultRoot); const target = path.resolve(base, safe);
  if (target !== base && !target.startsWith(base + path.sep)) throw apiError(ERROR_CODES.PathTraversalNotAllowed);
  return target;
}
function toPosix(value) { return String(value).split(path.sep).join('/'); }
async function statPath(root, rel) { try { return await fs.promises.stat(resolveVaultPath(root, rel)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function listDirectory(root, rel = '') {
  const abs = resolveVaultPath(root, rel); let entries;
  try { entries = await fs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') throw statusError(404, 'Directory not found'); throw e; }
  return entries.filter((e) => e.isDirectory() || e.isFile()).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort((a,b) => a.localeCompare(b));
}
async function readFile(root, rel) { try { return await fs.promises.readFile(resolveVaultPath(root, rel)); } catch (e) { if (e.code === 'ENOENT') throw statusError(404, `File not found: ${rel}`); throw e; } }
async function writeFile(root, rel, data) {
  const safe = normalizeRelativePath(rel); if (!safe || safe.endsWith('/')) throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);
  const abs = resolveVaultPath(root, safe); await fs.promises.mkdir(path.dirname(abs), { recursive: true }); await fs.promises.writeFile(abs, data); return statObject(await fs.promises.stat(abs));
}
async function appendFile(root, rel, data) {
  const safe = normalizeRelativePath(rel); if (!safe || safe.endsWith('/')) throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);
  const abs = resolveVaultPath(root, safe); await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  let prefix = Buffer.alloc(0);
  try { const st = await fs.promises.stat(abs); if (st.size > 0) { const fh = await fs.promises.open(abs, 'r'); const last = Buffer.alloc(1); await fh.read(last, 0, 1, st.size - 1); await fh.close(); if (last[0] !== 10 && last[0] !== 13) prefix = Buffer.from('\n'); } } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.promises.appendFile(abs, Buffer.concat([prefix, Buffer.isBuffer(data) ? data : Buffer.from(data)])); return statObject(await fs.promises.stat(abs));
}
function statObject(st) { return { ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size }; }
async function ensureSourceFile(root, rel) { const safe = normalizeRelativePath(rel); const st = await statPath(root, safe); if (!st || !st.isFile()) throw statusError(404, `File not found: ${safe}`); return safe; }
async function deleteFile(root, rel, { permanent = false } = {}) {
  const safe = await ensureSourceFile(root, rel); const abs = resolveVaultPath(root, safe);
  if (permanent) { await fs.promises.unlink(abs); return { path: safe, permanent: true }; }
  const trashRelBase = path.posix.join('.trash', safe); let trashRel = trashRelBase; let n = 1;
  while (await statPath(root, trashRel)) { const ext = path.posix.extname(trashRelBase); const stem = ext ? trashRelBase.slice(0, -ext.length) : trashRelBase; trashRel = `${stem} ${n++}${ext}`; }
  const dest = resolveVaultPath(root, trashRel); await fs.promises.mkdir(path.dirname(dest), { recursive: true }); await fs.promises.rename(abs, dest); return { path: safe, trashedTo: trashRel, permanent: false };
}
function normalizeDestination(source, destination) {
  let dest = String(destination ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (dest.startsWith('/')) throw apiError(ERROR_CODES.PathTraversalNotAllowed);
  const preserve = !dest || dest.endsWith('/'); dest = normalizeRelativePath(dest);
  return preserve ? normalizeRelativePath(path.posix.join(dest, path.posix.basename(source))) : dest;
}
async function moveFile(root, source, destination, { allowOverwrite = false } = {}) {
  const src = await ensureSourceFile(root, source); const dest = normalizeDestination(src, destination); const destSt = await statPath(root, dest);
  if (destSt && !allowOverwrite) throw apiError(ERROR_CODES.DestinationAlreadyExists);
  if (destSt && destSt.isDirectory()) throw apiError(ERROR_CODES.DestinationAlreadyExists, 'Destination is a directory.');
  const srcAbs = resolveVaultPath(root, src); const dstAbs = resolveVaultPath(root, dest); await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  if (destSt && allowOverwrite) await fs.promises.unlink(dstAbs); await fs.promises.rename(srcAbs, dstAbs); return dest;
}
async function copyFile(root, source, destination, { allowOverwrite = false } = {}) {
  const src = await ensureSourceFile(root, source); const dest = normalizeDestination(src, destination); const destSt = await statPath(root, dest);
  if (destSt && !allowOverwrite) throw apiError(ERROR_CODES.DestinationAlreadyExists); if (destSt && destSt.isDirectory()) throw apiError(ERROR_CODES.DestinationAlreadyExists, 'Destination is a directory.');
  const dstAbs = resolveVaultPath(root, dest); await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true }); await fs.promises.copyFile(resolveVaultPath(root, src), dstAbs); return dest;
}
async function* walkFiles(root, rel = '', options = {}) {
  const { markdownOnly = false, includeObsidian = false } = options; const abs = resolveVaultPath(root, rel); let entries;
  try { entries = await fs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  entries.sort((a,b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const child = normalizeRelativePath(path.posix.join(rel || '', entry.name));
    if (entry.isDirectory()) { if (SKIP_DIRS.has(entry.name) || (!includeObsidian && entry.name === '.obsidian')) continue; yield* walkFiles(root, child, options); }
    else if (entry.isFile()) { if (markdownOnly && !/\.md$/i.test(entry.name)) continue; yield child; }
  }
}
async function fileStat(root, rel) { const st = await fs.promises.stat(resolveVaultPath(root, rel)); return statObject(st); }
module.exports = { normalizeRelativePath, resolveVaultPath, toPosix, statPath, listDirectory, readFile, writeFile, appendFile, deleteFile, moveFile, copyFile, walkFiles, fileStat, statObject, normalizeDestination };
