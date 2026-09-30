import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDatabase, PG } from './db.js';
import {
  getJob, getProfile, knownIds, pipeline, queryJobs, reenrichAll, saveAiResults, saveProfile, stats, toCompactText,
  updateTracking, upsertJobs,
} from './repo.js';

const PORT = Number(process.env.PORT || 3777);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

// Página de vagas (public/): "/" é o index; qualquer outro arquivo só se existir lá dentro.
function serveStatic(pathname, res) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('JSON inválido'), { http: 400 });
  }
}

const { server: pgServer, pool } = await startDatabase();

const routes = [
  ['GET', /^\/health$/, async () => ({ ok: true, pid: process.pid, ...(await stats(pool)) })],
  // Desligamento limpo pedido pela CLI (`restart`): fecha a API, o pool e o Postgres antes de sair.
  // O cabeçalho próprio força preflight de CORS, que não o autoriza: página de outro site não consegue chamar.
  ['POST', /^\/shutdown$/, (req) => {
    if (req.headers['x-vagas-cli'] !== '1') throw Object.assign(new Error('só a CLI pode desligar o servidor'), { http: 403 });
    setImmediate(shutdown);
    return { ok: true, pid: process.pid };
  }],
  ['POST', /^\/jobs$/, async (req) => {
    const body = await readJson(req);
    const jobs = Array.isArray(body) ? body : body.jobs;
    if (!Array.isArray(jobs)) throw Object.assign(new Error('envie { "jobs": [...] }'), { http: 400 });
    return upsertJobs(pool, jobs);
  }],
  ['GET', /^\/jobs$/, (req, url) => queryJobs(pool, Object.fromEntries(url.searchParams))],
  ['GET', /^\/triage$/, (req, url) => queryJobs(pool, Object.fromEntries(url.searchParams), { triage: true })],
  ['GET', /^\/export\/compact$/, async (req, url) => {
    const rows = await queryJobs(pool, Object.fromEntries(url.searchParams), { triage: url.searchParams.get('all') !== '1' });
    return { text: toCompactText(rows) };
  }],
  ['GET', /^\/jobs\/(\d+)$/, async (req, url, [, id]) => {
    const job = await getJob(pool, id);
    if (!job) throw Object.assign(new Error('vaga não encontrada'), { http: 404 });
    return job;
  }],
  ['PATCH', /^\/jobs\/(\d+)$/, async (req, url, [, id]) => {
    const job = await updateTracking(pool, id, await readJson(req));
    if (!job) throw Object.assign(new Error('vaga não encontrada'), { http: 404 });
    return job;
  }],
  ['POST', /^\/reenrich$/, () => reenrichAll(pool)],
  ['GET', /^\/profile$/, () => getProfile(pool)],
  ['PUT', /^\/profile$/, async (req) => saveProfile(pool, await readJson(req))],
  ['POST', /^\/ai$/, async (req) => {
    const body = await readJson(req);
    const { version } = await getProfile(pool);
    return saveAiResults(pool, Array.isArray(body) ? body : body.results ?? [], version);
  }],
  ['GET', /^\/pipeline$/, () => pipeline(pool)],
  ['POST', /^\/known$/, async (req) => ({ known: await knownIds(pool, (await readJson(req)).ids ?? []) })],
];

const api = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  for (const [method, re, handler] of routes) {
    const match = url.pathname.match(re);
    if (!match || method !== req.method) continue;
    try {
      const result = await handler(req, url, match);
      if (typeof result?.text === 'string' && url.pathname.startsWith('/export')) {
        return send(res, 200, result.text, 'text/plain; charset=utf-8');
      }
      return send(res, 200, result);
    } catch (e) {
      if (!e.http) console.error(e);
      return send(res, e.http || 500, { error: e.message });
    }
  }
  if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
  send(res, 404, { error: 'rota não encontrada' });
});

api.listen(PORT, '127.0.0.1', () => {
  console.log(`API de vagas em http://localhost:${PORT}`);
  console.log(`PostgreSQL em postgres://${PG.user}:${PG.password}@${PG.host}:${PG.port}/${PG.database}`);
  console.log('Ctrl+C para parar.');
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nParando…');
  api.close();
  await pool.end().catch(() => {});
  await pgServer.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
