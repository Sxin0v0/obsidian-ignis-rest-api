const path = require('path');
const MAP = Object.freeze({
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
  '.json': 'application/json', '.yaml': 'application/yaml', '.yml': 'application/yaml', '.xml': 'application/xml', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.zip': 'application/zip', '.gz': 'application/gzip',
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain', '.csv': 'text/csv'
});
function lookup(filename) { return MAP[path.extname(String(filename)).toLowerCase()] || 'application/octet-stream'; }
function isTextMime(mime) { return mime.startsWith('text/') || /(?:json|yaml|xml|javascript)$/.test(mime); }
module.exports = { lookup, isTextMime };
