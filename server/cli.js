#!/usr/bin/env node
// CLI usada pela skill /vagas. Saídas curtas e pensadas para leitura por IA.
// Uso: node cli.js <comando> [args]   (node cli.js help)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, ensureServer, stopServer } from './ensure.js';
import { toCompactText } from './repo.js';
import {
  DEFAULT_CITY, idFromUrl, localLine, readCandidates, readSeen, searchLinkedIn, writeSeen,
} from './local.js';
import { collect, scopeFrom, windowDays } from './collect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(here, 'data', 'profile');
const DEFAULT_SITE = 'https://andrepieri.com.br';

const DEFAULT_HARD_FILTERS = {
  status: 'nova,interessante',
  exclude_seniority: 'pleno,senior,lead',
  pleno_senior_max_years: '2',
  pcd_only: '0',
  max_age_days: '7',
};

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

async function api(pathname, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}` : '';
  const r = await fetch(`${API}${pathname}${qs}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  if (!r.ok) throw new Error(`API ${r.status}: ${data?.error ?? text}`);
  return data;
}

async function requireServer() {
  const res = await ensureServer();
  if (!res.ok) throw new Error(res.error);
}

async function requireProfile() {
  const profile = await api('/profile');
  if (!profile.exists || !Object.keys(profile.data).length) {
    throw new Error('Perfil ainda não salvo. Rode "profile-fetch", estruture o perfil e salve com "profile-save".');
  }
  return profile;
}

function hardFilters(profile) {
  const prefs = profile.preferences ?? {};
  const filters = { ...DEFAULT_HARD_FILTERS, ...(prefs.hard_filters ?? {}) };
  if (prefs.empresas_bloqueadas?.length) filters.exclude_companies = prefs.empresas_bloqueadas.join(',');
  return filters;
}

// Aceita BOM: editores e o PowerShell no Windows costumam gravar UTF-8 com BOM.
const readJsonFile = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^﻿/, ''));

// ---------- perfil ----------

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/h\d|\/li|\/div|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (vagas-cli)' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function profileFetch() {
  const profile = await api('/profile');
  const site = (args[1] && !args[1].startsWith('--') ? args[1] : profile.preferences?.site_url || DEFAULT_SITE).replace(/\/$/, '');
  const origin = new URL(site).origin;

  const home = await fetchText(site);
  const hrefs = [...home.matchAll(/href="([^"#]+)"/g)].map((m) => new URL(m[1], origin));
  const sameSite = hrefs.filter((u) => u.origin === origin);
  const pages = [...new Set(sameSite
    .filter((u) => !u.pathname.startsWith('/_next') && !/\.[a-z0-9]{2,5}$/i.test(u.pathname) && u.pathname !== '/')
    .map((u) => `${origin}${u.pathname}`))].slice(0, 15);
  const pdfs = [...new Set(sameSite.filter((u) => /\.pdf$/i.test(u.pathname)).map((u) => u.href))];

  let siteText = `===== ${site}/\n${htmlToText(home)}\n`;
  for (const page of pages) {
    try {
      siteText += `\n===== ${page}\n${htmlToText(await fetchText(page))}\n`;
    } catch (e) {
      siteText += `\n===== ${page}\n(erro ao baixar: ${e.message})\n`;
    }
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const hash = createHash('sha256').update(siteText);
  const cvFiles = [];
  for (const [i, url] of pdfs.entries()) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) continue;
    const bytes = Buffer.from(await r.arrayBuffer());
    const file = path.join(PROFILE_DIR, i === 0 ? 'curriculo.pdf' : `curriculo-${i + 1}.pdf`);
    fs.writeFileSync(file, bytes);
    hash.update(bytes);
    cvFiles.push(file);
  }
  const siteFile = path.join(PROFILE_DIR, 'site.txt');
  fs.writeFileSync(siteFile, siteText);
  const sourceHash = hash.digest('hex').slice(0, 16);

  console.log(JSON.stringify({
    changed: sourceHash !== profile.source_hash,
    profile_exists: profile.exists && Object.keys(profile.data ?? {}).length > 0,
    source_hash: sourceHash,
    site_txt: siteFile,
    site_pages: [`${site}/`, ...pages],
    cv_pdfs: cvFiles,
    version: profile.version,
  }, null, 2));
}

async function profileShow() {
  const p = await api('/profile');
  console.log(JSON.stringify({ exists: p.exists, version: p.version, source_hash: p.source_hash, fetched_at: p.fetched_at, data: p.data, preferences: p.preferences }, null, 2));
}

async function profileSave() {
  if (!args[1]) throw new Error('uso: profile-save <arquivo.json>  ({ data?, preferences?, source_hash? })');
  const body = readJsonFile(args[1]);
  const saved = await api('/profile', { method: 'PUT', body });
  console.log(`Perfil salvo. Versão ${saved.version}.`);
}

// ---------- triagem e avaliação ----------

async function screen() {
  const profile = await requireProfile();
  const limit = Number(flag('limit', 80));
  const rows = await api('/jobs', {
    query: { ...hardFilters(profile), ai_pending: profile.version, hide_dups: '1', limit: '2000' },
  });
  if (!rows.length) return console.log('Nenhuma vaga pendente de triagem para esta versão do perfil.');
  console.log(`Perfil ${profile.version} · ${rows.length} vagas pendentes de triagem (mostrando ${Math.min(limit, rows.length)}).`);
  console.log(toCompactText(rows.slice(0, limit)));
}

const condense = (text, max) => {
  const t = String(text ?? '').replace(/\n{2,}/g, '\n').trim();
  return t.length > max ? `${t.slice(0, max)}\n[…cortado, ${t.length - max} caracteres]` : t;
};

async function evaluate() {
  const profile = await requireProfile();
  const limit = Number(flag('limit', 6));
  const maxChars = Number(flag('chars', 3500));
  const rows = await api('/jobs', {
    query: {
      status: 'nova,interessante', ai_profile: profile.version, ai_stage: 'triagem', ai_verdict: 'avaliar',
      hide_dups: '1', full: '1', limit: '2000',
    },
  });
  if (!rows.length) return console.log('Nenhuma vaga aguardando avaliação completa.');
  console.log(`${rows.length} vagas aguardando avaliação completa (mostrando ${Math.min(limit, rows.length)}).\n`);
  for (const j of rows.slice(0, limit)) {
    const criteria = Object.entries(j.criteria ?? {}).map(([k, v]) => `${k}: ${v}`).join(' | ');
    console.log(`### ${j.id}\n${toCompactText([j]).split('\n')[1]}`);
    if (criteria) console.log(`Critérios: ${criteria}`);
    if (j.ai_reason) console.log(`Nota da triagem: ${j.ai_reason}`);
    console.log(`Descrição:\n${condense(j.description, maxChars)}\n`);
  }
}

async function aiSave() {
  if (!args[1]) throw new Error('uso: ai-save <arquivo.json>  ([{ id, stage, verdict, score?, reason?, summary?, gaps?, highlights? }])');
  const results = readJsonFile(args[1]);
  const { updated } = await api('/ai', { method: 'POST', body: { results } });
  console.log(`${results.length} decisões salvas (${updated} vagas atualizadas, contando duplicatas).`);
}

// ---------- resultados e acompanhamento ----------

async function report() {
  const profile = await requireProfile();
  const limit = Number(flag('limit', 15));
  const minScore = Number(flag('min', 0));
  const rows = (await api('/jobs', {
    query: {
      status: flag('status', 'nova,interessante'), ai_profile: profile.version, ai_stage: 'avaliada',
      ai_verdict: 'forte,avaliar', hide_dups: '1', order: 'ai', limit: String(limit),
    },
  })).filter((j) => (j.ai_score ?? 0) >= minScore);
  if (!rows.length) return console.log('Nenhuma vaga avaliada ainda para esta versão do perfil.');
  const now = Date.now();
  for (const [i, j] of rows.entries()) {
    const age = j.posted_at ? `${Math.floor((now - new Date(j.posted_at)) / 864e5)}d` : '?';
    const competition = j.few_applicants ? 'poucos candidatos' : j.applicants != null ? `${j.applicants} candidatos` : 'candidatos ?';
    console.log(`${i + 1}. [${j.ai_score}] ${j.title} — ${j.company}  (id ${j.id}, ${j.ai_verdict}, status ${j.status})`);
    console.log(`   ${[j.city, j.state].filter(Boolean).join('/') || 'Brasil'} · ${j.workplace ?? 'modalidade ?'} · ${age} · ${competition}${j.easy_apply ? ' · candidatura simplificada' : ''}${j.dup_count > 1 ? ` · ${j.dup_count} cópias` : ''}`);
    console.log(`   ${j.url}`);
    if (j.ai_summary) console.log(`   Por quê: ${j.ai_summary}`);
    if (j.ai_highlights?.length) console.log(`   Destacar: ${j.ai_highlights.join('; ')}`);
    if (j.ai_gaps?.length) console.log(`   Lacunas: ${j.ai_gaps.join('; ')}`);
  }
}

async function job() {
  if (!args[1]) throw new Error('uso: job <id>');
  const j = await api(`/jobs/${args[1]}`);
  const keep = [
    'id', 'url', 'title', 'company', 'location', 'workplace', 'seniority', 'posted_at', 'applicants', 'easy_apply',
    'techs', 'years_min', 'contract', 'english_required', 'salary_min', 'salary_max', 'criteria', 'status',
    'discard_reason', 'notes', 'ai_stage', 'ai_verdict', 'ai_score', 'ai_reason', 'ai_summary', 'ai_gaps', 'ai_highlights',
  ];
  console.log(JSON.stringify(Object.fromEntries(keep.map((k) => [k, j[k]])), null, 2));
  console.log(`\nDescrição:\n${condense(j.description, Number(flag('chars', 8000)))}`);
}

async function status() {
  const [, id, newStatus, ...reason] = args;
  if (!id || !newStatus) throw new Error('uso: status <id> <nova|interessante|descartada|aplicada|entrevista|encerrada> [motivo ou nota]');
  const body = { status: newStatus };
  if (reason.length) body[newStatus === 'descartada' ? 'discard_reason' : 'notes'] = reason.join(' ');
  const r = await api(`/jobs/${id}`, { method: 'PATCH', body });
  console.log(`Vaga ${r.id}: ${r.status}${r.discard_reason ? ` (motivo: ${r.discard_reason})` : ''}`);
}

async function pipelineCmd() {
  const [health, p] = await Promise.all([api('/health'), api('/pipeline')]);
  const lastDays = health.ultima_coleta ? Math.floor((Date.now() - new Date(health.ultima_coleta)) / 864e5) : null;
  console.log(`Banco: ${health.total} vagas, ${health.sem_duplicatas} únicas. Última coleta: ${lastDays == null ? 'nunca' : `há ${lastDays} dia(s)`}.`);
  console.log(`Por status: ${p.byStatus.map((s) => `${s.status} ${s.n}`).join(' · ')}`);
  const profile = await api('/profile');
  if (profile.version) {
    const pending = await api('/jobs', { query: { ...hardFilters(profile), ai_pending: profile.version, hide_dups: '1', limit: '2000' } });
    const waiting = await api('/jobs', { query: { status: 'nova,interessante', ai_profile: profile.version, ai_stage: 'triagem', ai_verdict: 'avaliar', hide_dups: '1', limit: '2000' } });
    console.log(`IA (perfil ${profile.version}): ${pending.length} pendentes de triagem · ${waiting.length} aguardando avaliação completa.`);
  }
  if (p.followUp.length) {
    console.log('\nSem atualização há mais de 7 dias (vale cobrar retorno):');
    for (const j of p.followUp) console.log(`- ${j.id} ${j.title} — ${j.company} (${j.status} desde ${j.updated_at.slice(0, 10)}) ${j.url}`);
  }
}

async function insights() {
  const profile = await requireProfile();
  const rows = await api('/jobs', {
    query: { ai_profile: profile.version, ai_stage: 'avaliada', ai_verdict: 'forte,avaliar', hide_dups: '1', limit: '2000' },
  });
  const discarded = await api('/jobs', { query: { ai_profile: profile.version, ai_verdict: 'descartar', hide_dups: '1', limit: '2000' } });
  const skills = JSON.stringify(profile.data).toLowerCase();

  const count = (items) => {
    const m = new Map();
    for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const techs = count(rows.flatMap((j) => j.techs ?? []));
  const missing = techs.filter(([t]) => !skills.includes(t.toLowerCase()));
  const gaps = count(rows.flatMap((j) => (j.ai_gaps ?? []).map((g) => g.toLowerCase().trim())));
  const reasons = count(discarded.map((j) => (j.ai_reason ?? 'sem motivo').split(/[:—-]/)[0].trim().toLowerCase()));

  console.log(`Base: ${rows.length} vagas aprovadas pela IA, ${discarded.length} descartadas.`);
  console.log(`\nTecnologias mais pedidas nas vagas aprovadas: ${techs.slice(0, 15).map(([t, n]) => `${t} (${n})`).join(', ')}`);
  console.log(`Pedidas e ausentes do perfil: ${missing.slice(0, 10).map(([t, n]) => `${t} (${n})`).join(', ') || 'nenhuma'}`);
  console.log(`\nLacunas mais citadas: ${gaps.slice(0, 12).map(([g, n]) => `${g} (${n})`).join('; ') || 'nenhuma'}`);
  console.log(`\nMotivos de descarte: ${reasons.slice(0, 10).map(([r, n]) => `${r} (${n})`).join('; ') || 'nenhum'}`);
}


// ---------- vagas locais (Presidente Prudente) ----------

async function isKnown(id) {
  try {
    await api(`/jobs/${id}`);
    return true;
  } catch {
    return false;
  }
}

async function localSearch() {
  const city = flag('city', DEFAULT_CITY);
  const days = Number(flag('days', 7));
  const keywords = flag('keywords', null)?.split(',').map((k) => k.trim()).filter(Boolean);
  const { total, known, fresh } = await searchLinkedIn({ city, days, isKnown, ...(keywords ? { keywords } : {}) });
  console.log(`LinkedIn · ${city} · últimos ${days} dias: ${total} vagas encontradas, ${known} já conhecidas, ${fresh.length} novas para triagem.`);
  if (!fresh.length) return;
  console.log('# id | vaga — empresa | local · modalidade | nível | idade | candidatos | contrato | techs | trecho da descrição');
  for (const j of fresh) console.log(localLine(j));
}

// Recebe URLs de outros sites e diz quais ainda não foram vistas (banco ou descartes).
async function localKnown() {
  const urls = args.slice(1);
  if (!urls.length) throw new Error('uso: local-known <url> [url...]');
  const seen = readSeen();
  for (const url of urls) {
    const id = idFromUrl(url);
    const state = seen[id] ? `descartada antes (${seen[id].reason})` : (await isKnown(id)) ? 'já no banco' : 'NOVA';
    console.log(`${state} · ${url}`);
  }
}

// [{ id, verdict, reason }] para vagas do local-search, ou
// [{ url, title, company, location, description, posted_text?, salary_text?, verdict, reason }] para outros sites.
async function localSave() {
  if (!args[1]) throw new Error('uso: local-save <arquivo.json>');
  const items = readJsonFile(args[1]);
  const cache = readCandidates();
  const seen = readSeen();
  const jobs = [];
  const results = [];
  let discarded = 0;
  for (const item of items) {
    const id = String(item.id ?? idFromUrl(item.url));
    const base = cache[id] ?? {};
    const job = { ...base, ...item, id, detail_status: (item.description ?? base.description) ? 'ok' : 'pending' };
    delete job.verdict; delete job.reason;
    if (!job.url || !job.title) throw new Error(`vaga ${id} sem url/título (não está no cache do local-search?)`);
    if (item.verdict === 'descartar') {
      seen[id] = { reason: item.reason ?? '', title: job.title, company: job.company, url: job.url, at: new Date().toISOString().slice(0, 10) };
      discarded++;
      continue;
    }
    jobs.push(job);
    results.push({ id, stage: 'triagem', verdict: 'avaliar', reason: item.reason ?? 'local: Presidente Prudente' });
  }
  writeSeen(seen);
  if (jobs.length) {
    const r = await api('/jobs', { method: 'POST', body: { jobs } });
    await api('/ai', { method: 'POST', body: { results } });
    console.log(`${jobs.length} vagas locais no banco (${r.inserted} novas, ${r.updated} atualizadas), já marcadas para avaliação completa.`);
  }
  console.log(`${discarded} descartadas lembradas em data/local-seen.json (não voltam na próxima busca).`);
}

// ---------- coleta automática (escopo em preferences.busca) ----------

async function collectCmd() {
  const profile = await api('/profile');
  const scope = scopeFrom(profile.preferences);
  const auto = windowDays(scope);
  const days = Number(flag('days', auto));
  const r = await collect(scope, {
    days,
    advance: days >= auto,
    isKnown: async (ids) => new Set((await api('/known', { method: 'POST', body: { ids } })).known),
    save: (jobs) => api('/jobs', { method: 'POST', body: { jobs } }),
    progress: (msg) => console.error(`… ${msg}`),
  });
  console.log(`Coleta LinkedIn (últimos ${r.days} dias, ${scope.buscas.length} buscas): ${r.unique} vagas únicas, ${r.known} já no banco, ${r.inserted} novas gravadas.`);
  for (const p of r.perSearch) console.log(`- ${p.nome}: ${p.found} encontradas, ${p.blocked} ignoradas pelo título`);
  if (r.leftover > 0) console.log(`${r.leftover} novas ficaram para a próxima execução (limite max_detalhes = ${scope.max_detalhes}).`);
}

async function scopeCmd() {
  const profile = await api('/profile');
  const custom = Boolean(profile.preferences?.busca);
  console.log(`Escopo ${custom ? 'personalizado (preferences.busca)' : 'padrão (preferences.busca ainda não salvo)'}; próxima coleta: últimos ${windowDays(scopeFrom(profile.preferences))} dias.`);
  console.log(JSON.stringify(scopeFrom(profile.preferences), null, 2));
}

// Descartes que o André fez (página ou CLI) nos últimos N dias, com o motivo: matéria-prima do Passo 7.
async function discards() {
  const days = Number(flag('days', 14));
  const since = Date.now() - days * 864e5;
  const rows = (await api('/jobs', { query: { status: 'descartada', limit: '2000' } }))
    .filter((j) => new Date(j.updated_at) >= since)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (!rows.length) return console.log(`Nenhum descarte do André nos últimos ${days} dias.`);
  console.log(`${rows.length} descartes do André nos últimos ${days} dias:`);
  for (const j of rows) {
    const ai = j.ai_verdict ? ` · IA: ${j.ai_verdict}${j.ai_score != null ? ` ${j.ai_score}` : ''}` : '';
    console.log(`- ${j.id} ${j.title} — ${j.company}${ai} · motivo: ${j.discard_reason || '(sem motivo)'}`);
  }
}

// Abre a página de vagas (server/public) no navegador padrão.
async function openCmd() {
  const url = `${API.replace('127.0.0.1', 'localhost')}/${args[1] ? `?${args[1]}` : ''}`;
  const [cmdName, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmdName, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
  console.log(`Página de vagas: ${url}`);
}

const COMMANDS = {
  ensure: async () => {
    const r = await ensureServer();
    if (!r.ok) throw new Error(r.error);
    const h = await api('/health');
    console.log(`Banco ${r.started ? 'iniciado' : 'no ar'}: ${h.total} vagas (${h.sem_duplicatas} únicas), ${h.com_descricao} com descrição.`);
  },
  // Início de toda sessão /vagas: derruba com segurança o backend que estiver aberto e sobe um novo.
  restart: async () => {
    const stop = await stopServer();
    if (stop.stopped) console.log(`Backend anterior${stop.pid ? ` (PID ${stop.pid})` : ''} desligado ${stop.graceful ? 'com segurança (API, conexões e Postgres fechados)' : 'à força; o Postgres dele será parado com pg_ctl ao subir o novo'}.`);
    else console.log('Nenhum backend aberto.');
    const r = await ensureServer();
    if (!r.ok) throw new Error(r.error);
    const h = await api('/health');
    console.log(`Backend novo no ar (PID ${h.pid}): ${h.total} vagas (${h.sem_duplicatas} únicas).`);
  },
  'profile-fetch': profileFetch,
  'profile-show': profileShow,
  'profile-save': profileSave,
  screen,
  evaluate,
  'ai-save': aiSave,
  report,
  job,
  status,
  pipeline: pipelineCmd,
  insights,
  open: openCmd,
  discards,
  collect: collectCmd,
  scope: scopeCmd,
  'local-search': localSearch,
  'local-known': localKnown,
  'local-save': localSave,
};

const HELP = `Comandos:
  restart                        desliga com segurança o backend aberto e sobe um novo (início de toda sessão)
  ensure                         garante o servidor no ar
  open [filtros]                 abre a página de vagas no navegador (ex.: open tab=aplicadas)
  discards [--days 14]           descartes feitos pelo André, com motivo e o que a IA tinha dito
  collect [--days N]             roda as buscas do escopo no LinkedIn público e grava as vagas novas
  scope                          mostra o escopo de busca (preferences.busca ou o padrão)
  profile-fetch [url]            baixa site + currículo PDF e diz se mudou
  profile-show                   mostra perfil salvo, preferências e versão
  profile-save <arquivo.json>    salva { data?, preferences?, source_hash? }
  screen [--limit 80]            vagas pendentes de triagem (uma linha cada)
  evaluate [--limit 6] [--chars 3500]  vagas aprovadas na triagem, com descrição
  ai-save <arquivo.json>         grava decisões [{ id, stage, verdict, score, reason, summary, gaps, highlights }]
  report [--limit 15] [--min 0] [--status nova,interessante]  ranking final
  job <id> [--chars 8000]        vaga completa
  status <id> <status> [motivo]  nova|interessante|descartada|aplicada|entrevista|encerrada
  pipeline                       contagens, pendências e candidaturas para cobrar retorno
  insights                       tecnologias pedidas, lacunas e motivos de descarte
  local-search [--city \"...\"] [--days 7] [--keywords a,b]  vagas novas da cidade no LinkedIn (padrão Presidente Prudente)
  local-known <url> [url...]     diz quais links de outros sites ainda não foram vistos
  local-save <arquivo.json>      grava as aprovadas no banco e lembra as descartadas`;

try {
  if (!COMMANDS[cmd]) {
    console.log(HELP);
    process.exit(cmd && cmd !== 'help' ? 1 : 0);
  }
  if (!['ensure', 'restart'].includes(cmd)) await requireServer();
  await COMMANDS[cmd]();
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
}
