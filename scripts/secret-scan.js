#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'release', 'build', 'coverage', '.cache', 'tmp', 'temp']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXTENSIONS = new Set([
  '', '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yaml', '.yml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.env', '.example', '.ini', '.conf', '.properties', '.html', '.css', '.svg'
]);

const SAFE_VALUES = new Set([
  'YOUR_API_KEY', 'YOUR_ACCESS_TOKEN', 'YOUR_TOKEN', 'YOUR_SECRET', 'YOUR_PASSWORD', 'YOUR_CLIENT_SECRET',
  'YOUR_SERVER_URL', 'YOUR_API_ENDPOINT', 'replace-me', 'changeme', 'example', 'example-value', '<redacted>'
]);

const checks = [
  ['GitHub classic token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['Private IPv4', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
  ['User home path', /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+\//g],
];

const assignment = /\b(API[_-]?KEY|TOKEN|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|SECRET|SECRET[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|WEBHOOK[_-]?SECRET)\b\s*[:=]\s*["']?([^\s"'`#]+)/g;
const bearer = /\bBearer\s+((?=[A-Za-z0-9._~+\/-]{12,}\b)(?=[A-Za-z0-9._~+\/-]*[0-9._~+\/-])[A-Za-z0-9._~+\/-]+)\b/g;

function isProbablyText(file) {
  const base = path.basename(file);
  if (base === '.gitignore' || base === 'Dockerfile' || base.startsWith('.env')) return true;
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!SKIP_FILES.has(entry.name) && isProbablyText(full)) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const findings = [];
for (const file of walk(ROOT)) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (text.includes('\u0000')) continue;

  for (const [label, regex] of checks) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      findings.push(`${rel}:${lineOf(text, match.index)} ${label}`);
    }
  }

  assignment.lastIndex = 0;
  let match;
  while ((match = assignment.exec(text))) {
    const value = match[2].replace(/[;,]+$/, '');
    if (SAFE_VALUES.has(value) || /^YOUR_[A-Z0-9_]+$/.test(value) || /^\$\{[A-Z0-9_]+(?::-[^}]*)?\}$/.test(value)) continue;
    if (/^(true|false|null|undefined|\d+)$/i.test(value)) continue;
    findings.push(`${rel}:${lineOf(text, match.index)} suspicious ${match[1]} assignment`);
  }

  bearer.lastIndex = 0;
  while ((match = bearer.exec(text))) {
    const value = match[1];
    const bare = value.replace(/[.,;:!?]+$/, '');
    if (SAFE_VALUES.has(value) || /^YOUR_[A-Z0-9_]+$/.test(value) || value.includes('$') || /^[A-Za-z]+$/.test(bare)) continue;
    findings.push(`${rel}:${lineOf(text, match.index)} suspicious Bearer credential`);
  }
}

if (findings.length) {
  console.error('Secret/privacy scan FAILED:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('Secret/privacy scan PASS: no high-confidence credentials or private-environment indicators found.');
