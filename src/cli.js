#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { applyEdit } from './edit.js';

const HELP = `htmlpen: comment on and edit local HTML files in your browser, for your coding agent.

Usage: htmlpen [file.html | folder] [--agent] [--port 4747] [--no-open]
       htmlpen --install-skill    teach Claude Code to use htmlpen (~/.claude/skills/htmlpen)

  C  comment on any element (select text first to quote it)
  E  edit text in place; Enter writes it straight into the file
  Comments are saved next to the file as <file>.comments.json for your agent to read.

  --agent  For coding agents: "Send to agent" delivers the review to you. In a Conductor
           workspace it arrives as a chat message; elsewhere htmlpen prints it and exits,
           so run it in the background.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '4747' },
    agent: { type: 'boolean' },
    'no-open': { type: 'boolean' },
    'install-skill': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts['install-skill']) {
  const dest = path.join(homedir(), '.claude', 'skills', 'htmlpen', 'SKILL.md');
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(new URL('../skills/htmlpen/SKILL.md', import.meta.url), dest);
  console.log(`Installed ${dest}\nClaude Code will now offer htmlpen reviews for HTML it writes.`);
  process.exit(0);
}

const target = path.resolve(positionals[0] ?? '.');
const targetStat = await stat(target).catch(() => null);
if (!targetStat) {
  console.error(`htmlpen: ${target} does not exist`);
  process.exit(1);
}
const root = targetStat.isDirectory() ? target : path.dirname(target);
const realRoot = await realpath(root);

// In a Conductor cloud workspace the user's browser can't reach localhost, so htmlpen shares
// itself at the workspace preview URL. Anyone with read access can open that URL, so writes
// there need the edit key that only the printed link carries.
const conductorCloud = process.env.CONDUCTOR_IS_LOCAL === '0' && !!process.env.CONDUCTOR_WORKSPACE_ID;
const EDIT_KEY = conductorCloud
  ? createHash('sha256')
      .update(`htmlpen:${process.env.CONDUCTOR_API_TOKEN ?? randomUUID()}`)
      .digest('hex')
      .slice(0, 24)
  : '1';
const SEND = !opts.agent ? 'copy' : process.env.CONDUCTOR_SESSION_ID ? 'conductor' : 'exit';
const AGENT = process.env.CLAUDECODE ? 'Claude' : 'your agent';
const CLIENT = await readFile(new URL('./client.js', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};
const isHtml = (p) => /\.html?$/i.test(p);
const escAttr = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`); // ASCII-only, so any page encoding works
const fail = (status, message) => Object.assign(new Error(message), { status });

// URL path <-> absolute file path, refusing anything outside the served folder.
const toUrl = (abs) => `/${path.relative(root, abs).split(path.sep).map(encodeURIComponent).join('/')}`;
const outside = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
function toAbs(urlPath) {
  const abs = path.join(root, decodeURIComponent(urlPath));
  const rel = path.relative(root, abs);
  if (outside(rel)) throw fail(403, 'Outside the served folder');
  // Never serve dotfiles (.env, .git): on a shared preview link, every viewer could read them.
  if (rel.split(path.sep).some((part) => part.startsWith('.'))) throw fail(404, 'Not found');
  return abs;
}
// Symlinks can point anywhere, so also check where an existing file really lives.
async function assertInside(abs) {
  const real = await realpath(abs).catch(() => null);
  if (real && outside(path.relative(realRoot, real))) throw fail(403, 'Outside the served folder');
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
// The file's text, or null if it isn't valid UTF-8 (such pages are served as-is, never edited).
function asUtf8(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}
// One read-modify-write at a time per file, so simultaneous saves can't interleave.
const locks = new Map();
function exclusive(abs, fn) {
  const run = (locks.get(abs) ?? Promise.resolve()).then(fn);
  locks.set(abs, run.catch(() => {}));
  return run;
}
function display(abs) {
  const rel = path.relative(process.cwd(), abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel;
}

// ---------- file watching: tell open pages when the agent (not us) changes a file ----------
const pages = new Set(); // open SSE responses
const served = new Set(); // files a page depends on
const selfWrites = new Map(); // abs -> content we last wrote (null = deleted)
const watchedDirs = new Set();
const timers = new Map();

function track(abs) {
  served.add(abs);
  const dir = path.dirname(abs);
  if (watchedDirs.has(dir)) return;
  watchedDirs.add(dir);
  // Watch the folder, not the file: editors and agents often save via rename, which ends a file watch.
  watch(dir, (_, name) => {
    const abs = name && path.join(dir, name.toString());
    if (!served.has(abs)) return;
    clearTimeout(timers.get(abs));
    timers.set(abs, setTimeout(() => changed(abs), 60));
  }).on('error', () => {});
}

async function changed(abs) {
  if (selfWrites.has(abs)) {
    const now = await readFile(abs, 'utf8').catch(() => null);
    if (now === selfWrites.get(abs)) return;
    selfWrites.delete(abs);
  }
  for (const page of pages) page.write(`data: ${JSON.stringify({ path: toUrl(abs) })}\n\n`);
}

// Keep idle SSE streams open through proxies (Cloudflare drops them after ~100s of silence).
setInterval(() => pages.forEach((page) => page.write(': ping\n\n')), 25_000).unref();

function postToConductor(text) {
  return new Promise((resolve, reject) => {
    const args = ['message', 'create', '--session', process.env.CONDUCTOR_SESSION_ID, '--message-file', '-'];
    const child = spawn('conductor', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `conductor exited with ${code}`)),
    );
    child.stdin.end(text);
  });
}

async function writeOwn(abs, content) {
  selfWrites.set(abs, content);
  await writeFile(abs, content);
}

async function readComments(sidecar) {
  const saved = await readFile(sidecar, 'utf8').catch(() => '[]');
  let list;
  try {
    list = JSON.parse(saved);
  } catch {}
  if (!Array.isArray(list)) throw fail(409, `${path.basename(sidecar)} isn't a valid list. Fix or delete it.`);
  return list;
}

// ---------- HTTP ----------
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    if ((size += chunk.length) > 20e6) throw fail(413, 'Request too large');
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')); // decode once: chunks split characters
}

function inject(html, abs) {
  const attrs = {
    file: toUrl(abs),
    display: abs, // absolute, so an agent in any working directory finds the right file
    send: SEND === 'copy' ? 'copy' : 'agent',
    agent: AGENT,
  };
  const data = Object.entries(attrs).map(([k, v]) => ` data-${k}="${escAttr(v)}"`).join('');
  const tag = `<script src="/__htmlpen/client.js"${data}></script>`;
  const i = html.toLowerCase().lastIndexOf('</body');
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

async function listing(dir, urlPath) {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .filter((e) => e.isDirectory() || isHtml(e.name))
    .sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
  const items = entries.map((e) => {
    const name = e.name + (e.isDirectory() ? '/' : '');
    return `<li><a href="${escAttr(encodeURIComponent(e.name) + (e.isDirectory() ? '/' : ''))}">${escAttr(name)}</a></li>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>htmlpen</title>
<style>body{font:15px/1.6 system-ui;max-width:640px;margin:48px auto;padding:0 16px}a{color:#2563eb}</style>
<h1>${escAttr(decodeURIComponent(urlPath))}</h1><ul>${items.join('') || '<li>No HTML files here.</li>'}</ul>`;
}

async function serveFile(res, urlPath) {
  let abs = toAbs(urlPath);
  let info = await stat(abs).catch(() => null);
  if (info?.isDirectory()) {
    if (!urlPath.endsWith('/')) {
      res.writeHead(302, { location: `${urlPath}/` });
      return res.end();
    }
    const index = path.join(abs, 'index.html');
    if (!(await stat(index).catch(() => null))) return send(res, 200, await listing(abs, urlPath), TYPES['.html']);
    abs = index;
    info = true;
  }
  if (!info) return send(res, 404, 'Not found');
  await assertInside(abs);
  track(abs);
  const body = await readFile(abs);
  const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  if (!isHtml(abs)) return send(res, 200, body, type);
  const text = asUtf8(body);
  if (text !== null) return send(res, 200, inject(text, abs), type);
  // Not UTF-8: latin1 maps bytes 1:1, so the page keeps its bytes and its own <meta charset>.
  send(res, 200, Buffer.from(inject(body.toString('latin1'), abs), 'latin1'), 'text/html');
}

async function api(req, res, url) {
  const route = url.pathname.slice('/__htmlpen/'.length);
  if (route === 'client.js') return send(res, 200, CLIENT, TYPES['.js']);
  if (route === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(': connected\n\n');
    pages.add(res);
    req.on('close', () => pages.delete(res));
    return;
  }

  const file = toAbs(url.searchParams.get('file') ?? '');
  if (!isHtml(file) || !(await stat(file).catch(() => null))) throw fail(404, 'Not an HTML file');
  await assertInside(file);
  // The custom header forces a CORS preflight we never answer, so other sites can't write.
  if (req.method === 'POST') {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') throw fail(403, 'Forbidden');
    if (req.headers['x-htmlpen'] !== EDIT_KEY) throw fail(403, 'This link is view-only. Ask for the edit link.');
  }

  if (route === 'send' && req.method === 'POST') {
    const { prompt } = await readJson(req);
    if (typeof prompt !== 'string' || !prompt.trim()) throw fail(400, 'Nothing to send');
    if (SEND === 'copy') throw fail(400, 'Start htmlpen with --agent to send to an agent');
    if (SEND === 'conductor') {
      await postToConductor(prompt);
      return sendJson(res, 200, { ok: true });
    }
    // Print the review for the agent that started us in the background, then exit to wake it.
    res.once('finish', () => process.stdout.write(`\n${prompt}\n`, () => process.exit(0)));
    return sendJson(res, 200, { ok: true, exiting: true });
  }

  if (route === 'comments') {
    const sidecar = `${file}.comments.json`;
    track(sidecar);
    await assertInside(sidecar);
    if (req.method !== 'POST') return sendJson(res, 200, await readComments(sidecar));
    // Tabs, reviewers and agents all change this file, so apply one change rather than a whole list.
    const op = await readJson(req);
    const comments = await exclusive(sidecar, async () => {
      let list = await readComments(sidecar);
      if (op.op === 'add' && typeof op.comment?.id === 'string') list.push(op.comment);
      else if (op.op === 'resolve') list = list.map((c) => (c.id === op.id ? { ...c, resolved: !!op.resolved } : c));
      else if (op.op === 'delete') list = list.filter((c) => c.id !== op.id);
      else if (op.op === 'clearResolved') list = list.filter((c) => !c.resolved);
      else throw fail(400, 'Unknown comment change');
      await (list.length ? writeFile(sidecar, `${JSON.stringify(list, null, 2)}\n`) : rm(sidecar, { force: true }));
      return list;
    });
    return sendJson(res, 200, comments);
  }

  if (route === 'edit' && req.method === 'POST') {
    const edit = await readJson(req);
    const valid =
      typeof edit.tag === 'string' &&
      typeof edit.before === 'string' &&
      typeof edit.after === 'string' &&
      Number.isInteger(edit.index) &&
      Number.isInteger(edit.count);
    if (!valid) throw fail(400, 'Malformed edit');
    await exclusive(file, async () => {
      const text = asUtf8(await readFile(file));
      if (text === null) throw fail(409, 'Only UTF-8 files can be edited in place.');
      let next;
      try {
        next = applyEdit(text, edit);
      } catch (err) {
        throw fail(409, err.message);
      }
      await writeOwn(file, next);
    });
    return sendJson(res, 200, { ok: true });
  }
  throw fail(404, 'Unknown route');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const isApi = url.pathname.startsWith('/__htmlpen/');
  try {
    // Only answer to localhost names, so a DNS-rebinding site can't reach the API. In Conductor
    // cloud the only way in is Conductor's signed-in preview proxy, whose Host we don't control.
    const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '');
    if (!localHost && !conductorCloud) throw fail(403, 'Forbidden host');
    await (isApi ? api(req, res, url) : serveFile(res, url.pathname));
  } catch (err) {
    const status = err.status ?? (err instanceof URIError || err instanceof SyntaxError ? 400 : 500);
    if (isApi) sendJson(res, status, { error: err.message });
    else send(res, status, err.message);
  }
});

function listen(port, tries = 20) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) =>
      err.code === 'EADDRINUSE' && tries ? resolve(listen(port + 1, tries - 1)) : reject(err),
    );
    server.listen(port, '127.0.0.1', () => resolve(port));
  });
}

const port = await listen(Number(opts.port));
let base = `http://localhost:${port}`;
if (conductorCloud) {
  const { stdout } = await promisify(execFile)('conductor', ['--json', 'preview', 'set', '--port', String(port)]);
  base = JSON.parse(stdout).preview.url.replace(/\/$/, '');
}
const startPath = targetStat.isDirectory() ? '/' : toUrl(target);
const url = `${base}${startPath}${conductorCloud ? `?htmlpen=${EDIT_KEY}` : ''}`;
console.log(`htmlpen  ${url}`);
console.log(
  targetStat.isDirectory()
    ? `         serving ${display(root) || '.'}`
    : `         comments save to ${display(target)}.comments.json`,
);
if (conductorCloud) console.log('         shared at this workspace\'s Conductor preview URL; the link above can edit');
console.log(
  {
    copy: '         C = comment, E = edit, Ctrl+C to quit',
    conductor: '         waiting for review: "Send" posts it to this Conductor chat',
    exit: '         waiting for review: "Send" prints it here and exits',
  }[SEND],
);

if (!opts['no-open'] && !conductorCloud) {
  const [cmd, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
