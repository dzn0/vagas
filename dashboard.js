'use strict';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.round(Math.random() * ms * 0.4);

const LI = 'https://www.linkedin.com';
const DEFAULT_SECTIONS = [
  { name: 'Recomendadas para você', url: `${LI}/jobs/collections/recommended/` },
  { name: 'Principais oportunidades', url: `${LI}/jobs/collections/top-applicant/` },
  { name: 'Candidatura simplificada', url: `${LI}/jobs/collections/easy-apply/` },
  { name: 'Remotas', url: `${LI}/jobs/collections/remote-jobs/` },
  { name: 'Vagas salvas', url: `${LI}/my-items/saved-jobs/` },
].map((s) => ({ ...s, enabled: true }));

const state = {
  sections: [],
  jobs: {},
  settings: { maxPages: 10, delayMs: 2500, fetchDetails: true, apiUrl: 'http://localhost:3777' },
};
let running = false;
let stopRequested = false;
let workerTabId = null;

// ---------- persistência ----------

async function load() {
  const d = await chrome.storage.local.get(['sections', 'jobs', 'settings']);
  state.sections = d.sections?.length ? d.sections : structuredClone(DEFAULT_SECTIONS);
  state.jobs = d.jobs || {};
  state.settings = { ...state.settings, ...d.settings };
}

let saveTimer;
function save(now = false) {
  clearTimeout(saveTimer);
  const write = () =>
    chrome.storage.local.set({ sections: state.sections, jobs: state.jobs, settings: state.settings });
  scheduleSync();
  if (now) return write();
  saveTimer = setTimeout(write, 1000);
}

// ---------- sincronização com o banco local (server/) ----------

const dirty = new Set();
let apiOnline = null;
let syncTimer;

function markDirty(id) {
  dirty.add(String(id));
}

function toApiJob(j) {
  return {
    id: j.id, url: j.url, title: j.title, company: j.company,
    location: j.location, location_full: j.locationFull, card_text: j.cardText,
    description: j.description, criteria: j.criteria,
    posted_text: j.postedAt, applicants_text: j.applicants, salary_text: j.salary,
    sections: j.sections, detail_status: j.detailStatus,
  };
}

function setApiOnline(online) {
  if (apiOnline === online) return;
  if (apiOnline !== null) {
    log(online ? 'Banco de vagas conectado.' : 'Banco de vagas offline: rode "npm start" em server/. As vagas continuam salvas aqui e serão enviadas depois.', online ? 'ok' : 'error');
  }
  apiOnline = online;
  renderStats();
}

async function api(path, options = {}) {
  const r = await fetch(`${state.settings.apiUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => flushSync(), 2000);
}

async function flushSync({ all = false } = {}) {
  const ids = all ? Object.keys(state.jobs) : [...dirty];
  let sent = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).filter((id) => state.jobs[id]);
    try {
      await api('/jobs', { method: 'POST', body: JSON.stringify({ jobs: batch.map((id) => toApiJob(state.jobs[id])) }) });
      batch.forEach((id) => dirty.delete(id));
      sent += batch.length;
      setApiOnline(true);
    } catch (e) {
      // Mantém as pendentes em `dirty` para a próxima tentativa.
      if (all) ids.slice(i).forEach(markDirty);
      setApiOnline(false);
      break;
    }
  }
  return sent;
}

async function checkApi() {
  try {
    await api('/health');
    setApiOnline(true);
    return true;
  } catch {
    setApiOnline(false);
    return false;
  }
}

// Pede ao host nativo (server/native-host.js) que suba o servidor, se ainda não estiver no ar.
async function ensureApi() {
  if (await checkApi()) return;
  log('Iniciando o banco de vagas…');
  try {
    const reply = await chrome.runtime.sendNativeMessage('com.vagas.banco', { cmd: 'ensure' });
    if (!reply?.ok) throw new Error(reply?.error || 'resposta vazia do host');
  } catch (e) {
    const notInstalled = /not found|não encontrado|forbidden/i.test(e.message);
    log(notInstalled
      ? 'Início automático não instalado: rode "node install-native-host.js" em server/ (ou inicie com iniciar-banco.cmd).'
      : `Não consegui iniciar o banco: ${e.message}`, 'error');
    return;
  }
  if (await checkApi()) {
    log('Banco de vagas iniciado.', 'ok');
    flushSync({ all: true });
  }
}

// ---------- log / progresso ----------

function log(msg, type = '') {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  if (type) li.className = type;
  const ol = $('#log');
  ol.appendChild(li);
  ol.scrollTop = ol.scrollHeight;
}

function setProgress(text, fraction) {
  $('#progressText').textContent = text;
  if (fraction != null) $('#bar').style.width = `${Math.min(100, fraction * 100)}%`;
}

// ---------- aba de trabalho ----------

async function navigate(url) {
  if (workerTabId != null) {
    try { await chrome.tabs.get(workerTabId); } catch { workerTabId = null; }
  }
  if (workerTabId == null) {
    workerTabId = (await chrome.tabs.create({ url, active: false })).id;
  } else {
    await chrome.tabs.update(workerTabId, { url });
  }
  await sleep(800);
  for (let i = 0; i < 90; i++) {
    const t = await chrome.tabs.get(workerTabId);
    if (t.status === 'complete') break;
    await sleep(500);
  }
  await sleep(jitter(state.settings.delayMs));
  const t = await chrome.tabs.get(workerTabId);
  if (/\/(login|authwall|checkpoint|uas\/login|signup)/.test(t.url || '')) {
    throw new Error('O LinkedIn pediu login. Entre na sua conta numa aba normal e tente de novo.');
  }
  return workerTabId;
}

async function runInTab(tabId, func, args = []) {
  for (let attempt = 0; ; attempt++) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
      return res?.result;
    } catch (e) {
      // "Frame with ID 0 was removed": a página recarregou no meio da leitura.
      if (attempt >= 2 || !/frame|removed|navigat/i.test(e.message)) throw e;
      await sleep(3000);
    }
  }
}

async function closeWorker() {
  if (workerTabId == null) return;
  try { await chrome.tabs.remove(workerTabId); } catch {}
  workerTabId = null;
}

// ---------- funções injetadas na página do LinkedIn (precisam ser autocontidas) ----------

async function pageCollector() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ANY = '[componentkey^="job-card-component-ref-"],[data-occludable-job-id],[data-job-id],a[href*="/jobs/view/"]';
  // Painel de detalhes à direita costuma ter "vagas semelhantes": ignorar.
  const DETAIL = '.jobs-search__job-details,.scaffold-layout__detail,.jobs-details,.job-view-layout,aside';
  const inList = (el) => !el.closest(DETAIL);
  const listEls = () => [...document.querySelectorAll(ANY)].filter(inList);

  for (let i = 0; i < 40 && !listEls().length; i++) await sleep(500);

  // Rola a lista para forçar o carregamento preguiçoso dos cards.
  const first = listEls()[0];
  let scroller = null;
  for (let el = first?.parentElement; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 20) { scroller = el; break; }
  }
  for (const t of [scroller, document.scrollingElement].filter(Boolean)) {
    t.scrollTop = 0;
    let stuck = 0;
    for (let i = 0; i < 60 && stuck < 3; i++) {
      const before = t.scrollTop;
      t.scrollTop += Math.max(400, t.clientHeight * 0.8);
      await sleep(300);
      stuck = t.scrollTop === before ? stuck + 1 : 0;
    }
  }
  await sleep(1000);

  const firstLine = (el) =>
    (el?.innerText || el?.textContent || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  const pick = (root, sels) => {
    for (const s of sels) {
      const el = root.matches?.(s) ? root : root.querySelector(s);
      const v = el && firstLine(el);
      if (v) return v;
    }
    return '';
  };

  const items = new Map();
  const add = (id, root) => {
    if (!id || !/^\d+$/.test(id)) return;
    const cur = items.get(id) || { id };
    if (root) {
      cur.title ||= pick(root, [
        '.job-card-list__title--link strong', '.job-card-list__title', '.artdeco-entity-lockup__title',
        '.entity-result__title-text a', 'a[href*="/jobs/view/"]',
      ]);
      cur.company ||= pick(root, [
        '.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description',
        '.job-card-container__company-name', '.entity-result__primary-subtitle',
      ]);
      cur.location ||= pick(root, [
        '.artdeco-entity-lockup__caption', '.job-card-container__metadata-item',
        '.entity-result__secondary-subtitle',
      ]);
      cur.cardText ||= (root.innerText || '').trim();
    }
    items.set(id, cur);
  };

  for (const el of document.querySelectorAll('[data-occludable-job-id]')) {
    if (inList(el)) add(el.getAttribute('data-occludable-job-id'), el);
  }
  for (const el of document.querySelectorAll('[data-job-id]')) {
    if (inList(el)) add(el.getAttribute('data-job-id'), el.closest('li') || el);
  }
  for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) {
    if (!inList(a)) continue;
    const m = a.href.match(/\/jobs\/view\/(?:[^/?]*?-)?(\d{6,})/);
    if (m) add(m[1], a.closest('li, [data-job-id], .job-card-container, .entity-result') || a.parentElement);
  }
  // Busca nova (/jobs/search-results/): cards linkam para ?currentJobId=ID.
  for (const a of document.querySelectorAll('a[href*="currentJobId="]')) {
    if (!inList(a)) continue;
    const m = a.href.match(/[?&]currentJobId=(\d{6,})/);
    if (m) add(m[1], a.closest('li, [data-job-id], [role="listitem"], .job-card-container') || a.parentElement);
  }
  // Busca nova: cards com componentkey="job-card-component-ref-<ID>" e classes CSS embaralhadas.
  // Título, empresa e local são os três primeiros <p> do card.
  const newCards = document.querySelectorAll('[componentkey^="job-card-component-ref-"]');
  if (newCards.length) {
    items.clear(); // os links currentJobId encontrados acima vêm do painel de detalhes
    for (const card of newCards) {
      const id = card.getAttribute('componentkey').replace('job-card-component-ref-', '');
      if (items.has(id)) continue;
      const ps = [...card.querySelectorAll('p')].map(firstLine).filter(Boolean);
      items.set(id, {
        id, title: ps[0] || '', company: ps[1] || '', location: ps[2] || '', cardText: (card.innerText || '').trim(),
      });
    }
  }
  if (!items.size) {
    for (const m of document.documentElement.innerHTML.matchAll(/urn:li:fsd_jobPosting:(\d{6,})/g)) add(m[1]);
  }
  return { items: [...items.values()], url: location.href };
}

async function clickNextPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const firstId = () => {
    const e = document.querySelector('[componentkey^="job-card-component-ref-"],[data-occludable-job-id],[data-job-id]');
    return e?.getAttribute('componentkey') || e?.getAttribute('data-occludable-job-id') || e?.getAttribute('data-job-id') ||
      document.querySelector('a[href*="/jobs/view/"]')?.href || '';
  };
  let btn = document.querySelector([
    'button.jobs-search-pagination__button--next',
    '.artdeco-pagination__button--next',
    'button[aria-label="View next page"]',
    'button[aria-label*="próxima página" i]',
    'button[aria-label*="next page" i]',
  ].join(','));
  if (!btn) {
    const active = document.querySelector(
      '.artdeco-pagination__indicator--number.active, .artdeco-pagination__indicator--number.selected');
    btn = active?.nextElementSibling?.querySelector('button');
  }
  if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
  const before = firstId();
  btn.click();
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const now = firstId();
    if (now && now !== before) break;
  }
  return true;
}

async function sectionDiscoverer() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 25; i++) {
    window.scrollBy(0, 800);
    await sleep(400);
  }
  const genericLink = /^(mostrar tudo|ver tudo|ver todas|show all|see all|mais)/i;
  const out = new Map();
  for (const a of document.querySelectorAll('a[href*="/jobs/collections/"]')) {
    const u = new URL(a.href, location.origin);
    const m = u.pathname.match(/^\/jobs\/collections\/([^/]+)/);
    if (!m) continue;
    const url = `${u.origin}/jobs/collections/${m[1]}/`;
    let name = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\n')[0];
    if (!name || genericLink.test(name) || name.length > 80) {
      const h = a.closest('section, [class*="module"], [class*="card"]')?.querySelector('h2, h3');
      name = h?.innerText.trim().split('\n')[0] || m[1];
    }
    if (!out.has(url)) out.set(url, name);
  }
  return [...out].map(([url, name]) => ({ url, name }));
}

async function pageDiagnoser() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(4000);
  const MARK = /anunciada h[áa]|posted|há \d+ (hora|dia|semana|minuto)/i;
  const leaves = [...document.querySelectorAll('body *')]
    .filter((e) => e.children.length === 0 && MARK.test(e.textContent || ''));
  const attrs = (el) => [...el.attributes].map((a) => `${a.name}=${a.value.slice(0, 150)}`).join(' | ');
  const samples = leaves.slice(0, 3).map((leaf) => {
    const chain = [];
    let card = null;
    for (let el = leaf, i = 0; el && el !== document.body && i < 15; el = el.parentElement, i++) {
      const sib = el.parentElement ? el.parentElement.children.length : 0;
      chain.push({ tag: el.tagName, sib, attrs: attrs(el) });
      if (!card && sib >= 5) card = el;
    }
    return {
      chain,
      cardHtml: card ? card.outerHTML.slice(0, 6000) : '',
      cardLinks: card ? [...card.querySelectorAll('a')].map((a) => a.href) : [],
    };
  });
  const counts = {};
  for (const sel of ['[data-occludable-job-id]', '[data-job-id]', 'a[href*="/jobs/view/"]', 'a[href*="currentJobId="]',
    '[componentkey]', '[data-view-tracking-scope]', '[role="button"]', '[role="listitem"]', 'li']) {
    counts[sel] = document.querySelectorAll(sel).length;
  }
  const html = document.documentElement.innerHTML;
  const idPatterns = {};
  for (const [name, re] of Object.entries({
    fsd_jobPosting: /fsd_jobPosting[:%3A]+(\d{9,})/g,
    jobPosting: /jobPosting[:%3A]+(\d{9,})/gi,
    currentJobId: /currentJobId[=%3D]+(\d{9,})/g,
    jobId: /"jobId"\s*:\s*"?(\d{9,})/g,
  })) {
    idPatterns[name] = [...new Set([...html.matchAll(re)].map((m) => m[1]))].length;
  }
  return { url: location.href, markerLeaves: leaves.length, counts, idPatterns, samples };
}

async function detailPageExtractor() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DESC = '#job-details, .jobs-description__content, .jobs-box__html-content';
  for (let i = 0; i < 30 && !document.querySelector(DESC); i++) await sleep(500);
  const el = document.querySelector(DESC);
  if (!el) return null;
  const t = (s) => document.querySelector(s)?.innerText.trim().split('\n')[0] || '';
  return {
    title: t('h1'),
    company: t('.job-details-jobs-unified-top-card__company-name'),
    location: t('.job-details-jobs-unified-top-card__primary-description-container span, .job-details-jobs-unified-top-card__tertiary-description-container span'),
    description: el.innerText.trim(),
  };
}

// ---------- coleta ----------

function upsertJob(item, sectionName) {
  const existing = state.jobs[item.id];
  if (!existing) {
    state.jobs[item.id] = {
      id: item.id,
      url: `${LI}/jobs/view/${item.id}/`,
      title: item.title || '',
      company: item.company || '',
      location: item.location || '',
      cardText: item.cardText || '',
      sections: [sectionName],
      collectedAt: new Date().toISOString(),
      detailStatus: 'pending',
    };
    markDirty(item.id);
    return true;
  }
  for (const k of ['title', 'company', 'location']) existing[k] ||= item[k] || '';
  // O card muda ("Visto", nº de candidatos): guarda sempre a leitura mais recente.
  if (item.cardText) existing.cardText = item.cardText;
  if (!existing.sections.includes(sectionName)) existing.sections.push(sectionName);
  markDirty(item.id);
  return false;
}

async function collectSection(section) {
  const { maxPages, delayMs } = state.settings;
  const seen = new Set();
  let start = 0;
  let tabId = await navigate(section.url);

  for (let page = 1; page <= maxPages && !stopRequested; page++) {
    const res = await runInTab(tabId, pageCollector);
    const items = res?.items || [];
    let fresh = 0;
    let added = 0;
    for (const it of items) {
      if (!seen.has(it.id)) { seen.add(it.id); fresh++; }
      if (upsertJob(it, section.name)) added++;
    }
    log(`${section.name} · pág. ${page}: ${items.length} vagas, ${added} inéditas`);
    save();
    render();
    if (!items.length || !fresh || page === maxPages) break;

    if (await runInTab(tabId, clickNextPage)) {
      await sleep(jitter(delayMs));
      continue;
    }
    // Sem botão de paginação: tenta o parâmetro ?start= (funciona em buscas e coleções).
    if (!new URL(section.url).pathname.startsWith('/jobs/')) break;
    start += items.length;
    const next = new URL(section.url);
    next.searchParams.set('start', String(start));
    tabId = await navigate(next.toString());
  }
  log(`${section.name}: ${seen.size} vagas encontradas`, 'ok');
}

function htmlToText(root) {
  let out = '';
  const walk = (n) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { out += '\n'; return; }
    const block = /^(p|div|ul|ol|h[1-6]|section)$/.test(tag);
    if (tag === 'li') out += '\n- ';
    else if (block) out += '\n';
    n.childNodes.forEach(walk);
    if (block) out += '\n';
  };
  walk(root);
  return out.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Endpoint público de vaga do LinkedIn: não precisa de aba, é bem mais rápido.
async function fetchGuestDetail(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${LI}/jobs-guest/jobs/api/jobPosting/${id}`, { credentials: 'omit' });
    if (r.status === 429) {
      const wait = 20000 * (attempt + 1);
      log(`Limite de requisições atingido, aguardando ${wait / 1000}s…`, 'error');
      await sleep(wait);
      if (stopRequested) break;
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const q = (s, root = doc) => root.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '';
    const descEl = doc.querySelector('.show-more-less-html__markup, .description__text');
    if (!descEl) throw new Error('descrição não encontrada');
    const criteria = {};
    for (const li of doc.querySelectorAll('.description__job-criteria-item')) {
      const k = q('h3', li);
      if (k) criteria[k] = q('span', li);
    }
    return {
      title: q('.top-card-layout__title, .topcard__title'),
      company: q('.topcard__org-name-link, .top-card-layout__second-subline a'),
      location: q('.topcard__flavor--bullet'),
      postedAt: q('.posted-time-ago__text'),
      applicants: q('.num-applicants__caption, .num-applicants__figure'),
      salary: q('.salary, .compensation__salary'),
      criteria,
      description: htmlToText(descEl),
    };
  }
  throw new Error('limite de requisições (429)');
}

// Vagas cuja descrição o banco já tem (ex.: depois de limpar a lista local) não precisam
// ser baixadas de novo do LinkedIn.
async function reuseDescriptionsFromDb(pending) {
  let reused = 0;
  try {
    for (let i = 0; i < pending.length; i += 50) {
      const ids = pending.slice(i, i + 50).map((j) => j.id);
      const rows = await api(`/jobs?full=1&detail_status=ok&limit=50&ids=${ids.join(',')}`);
      for (const row of rows) {
        const job = state.jobs[row.id];
        if (!job || !row.description) continue;
        Object.assign(job, {
          title: job.title || row.title, company: job.company || row.company,
          location: job.location || row.location, locationFull: job.locationFull || row.location_full,
          postedAt: job.postedAt || row.posted_text, applicants: job.applicants || row.applicants_text,
          salary: job.salary || row.salary_text, criteria: job.criteria || row.criteria,
          description: row.description, detailStatus: 'ok',
        });
        reused++;
      }
    }
    setApiOnline(true);
  } catch {
    setApiOnline(false); // banco offline: segue baixando do LinkedIn
  }
  if (reused) { log(`${reused} descrições reaproveitadas do banco.`, 'ok'); save(); }
  return reused;
}

async function fetchPendingDetails() {
  let pending = Object.values(state.jobs).filter((j) => j.detailStatus === 'pending');
  if (pending.length) {
    await reuseDescriptionsFromDb(pending);
    pending = Object.values(state.jobs).filter((j) => j.detailStatus === 'pending');
  }
  if (!pending.length) { log('Nenhuma descrição pendente.'); return; }
  log(`Buscando descrição de ${pending.length} vagas…`);

  for (const [i, job] of pending.entries()) {
    if (stopRequested) break;
    setProgress(`Descrições: ${i + 1}/${pending.length} — ${job.title || job.id}`, i / pending.length);
    try {
      let d;
      try {
        d = await fetchGuestDetail(job.id);
      } catch (guestErr) {
        // Vaga fechada/privada no endpoint público: tenta pela página logada.
        const tabId = await navigate(job.url);
        d = await runInTab(tabId, detailPageExtractor);
        if (!d) throw guestErr;
      }
      for (const k of ['title', 'company']) if (d[k]) job[k] = d[k];
      // O local do card traz a modalidade ("Recife, PE (Remoto)"); o da página pública fica separado.
      if (d.location) {
        job.locationFull = d.location;
        job.location ||= d.location;
      }
      markDirty(job.id);
      Object.assign(job, {
        postedAt: d.postedAt || job.postedAt || '',
        applicants: d.applicants || job.applicants || '',
        salary: d.salary || job.salary || '',
        criteria: d.criteria || job.criteria || {},
        description: d.description,
        detailStatus: 'ok',
      });
      delete job.detailError;
    } catch (e) {
      job.detailStatus = 'error';
      job.detailError = e.message;
      log(`Falha em ${job.title || job.id}: ${e.message}`, 'error');
    }
    save();
    if (i % 5 === 0) render();
    await sleep(jitter(state.settings.delayMs / 2));
  }
}

async function start(mode) {
  if (running) return;
  running = true;
  stopRequested = false;
  setRunningUI(true);
  try {
    if (mode === 'all') {
      const secs = state.sections.filter((s) => s.enabled);
      if (!secs.length) log('Nenhuma seção marcada.', 'error');
      for (const [i, s] of secs.entries()) {
        if (stopRequested) break;
        setProgress(`Seção ${i + 1}/${secs.length}: ${s.name}`, i / secs.length);
        try {
          await collectSection(s);
        } catch (e) {
          log(`Erro em "${s.name}": ${e.message}`, 'error');
          if (/login/i.test(e.message)) break;
        }
      }
    }
    if (!stopRequested && (mode === 'details' || state.settings.fetchDetails)) await fetchPendingDetails();
    log(stopRequested ? 'Coleta interrompida.' : 'Coleta concluída!', stopRequested ? '' : 'ok');
    setProgress(stopRequested ? 'Interrompido.' : 'Concluído.', stopRequested ? null : 1);
  } catch (e) {
    log(`Erro: ${e.message}`, 'error');
  } finally {
    running = false;
    await closeWorker();
    await save(true);
    await flushSync();
    setRunningUI(false);
    render();
  }
}

async function discover() {
  if (running) return;
  running = true;
  setRunningUI(true);
  try {
    log('Procurando seções em linkedin.com/jobs…');
    const tabId = await navigate(`${LI}/jobs/`);
    const found = (await runInTab(tabId, sectionDiscoverer)) || [];
    let added = 0;
    for (const f of found) {
      if (state.sections.some((s) => s.url === f.url)) continue;
      state.sections.push({ ...f, enabled: true });
      added++;
    }
    log(`${found.length} seções encontradas, ${added} novas adicionadas.`, 'ok');
    save(true);
  } catch (e) {
    log(`Erro ao descobrir seções: ${e.message}`, 'error');
  } finally {
    running = false;
    await closeWorker();
    setRunningUI(false);
    render();
  }
}

async function diagnose() {
  const section = state.sections.find((s) => s.enabled);
  if (!section || running) { if (!section) log('Marque uma seção para diagnosticar.', 'error'); return; }
  running = true;
  setRunningUI(true);
  try {
    log(`Diagnosticando "${section.name}"…`);
    const tabId = await navigate(section.url);
    const result = await runInTab(tabId, pageDiagnoser);
    download(JSON.stringify(result, null, 1), `diagnostico-${stamp()}.json`, 'application/json');
    log(`Diagnóstico baixado (${result.markerLeaves} cards detectados pelo texto "Anunciada há").`, 'ok');
  } catch (e) {
    log(`Erro no diagnóstico: ${e.message}`, 'error');
  } finally {
    running = false;
    await closeWorker();
    setRunningUI(false);
  }
}

// ---------- exportação ----------

function visibleJobs() {
  const f = $('#filter').value.trim().toLowerCase();
  const all = Object.values(state.jobs).sort((a, b) => (b.collectedAt || '').localeCompare(a.collectedAt || ''));
  if (!f) return all;
  return all.filter((j) =>
    [j.title, j.company, j.location, j.sections.join(' '), j.description].join(' ').toLowerCase().includes(f));
}

function toMarkdown(jobs, withDesc) {
  const lines = [
    `# Vagas do LinkedIn (${jobs.length})`,
    `Exportado em ${new Date().toLocaleString('pt-BR')}.`,
    '',
  ];
  jobs.forEach((j, i) => {
    lines.push(`## ${i + 1}. ${j.title || '(sem título)'} — ${j.company || '?'}`);
    if (j.location) lines.push(`- Local: ${j.location}`);
    lines.push(`- Link: ${j.url}`);
    lines.push(`- Seções: ${j.sections.join(', ')}`);
    if (j.postedAt) lines.push(`- Publicada: ${j.postedAt}`);
    if (j.applicants) lines.push(`- Candidatos: ${j.applicants}`);
    if (j.salary) lines.push(`- Salário: ${j.salary}`);
    for (const [k, v] of Object.entries(j.criteria || {})) lines.push(`- ${k}: ${v}`);
    if (withDesc && j.description) lines.push('', '### Descrição', '', j.description);
    lines.push('', '---', '');
  });
  return lines.join('\n');
}

function toCsv(jobs, withDesc) {
  const cols = ['id', 'title', 'company', 'location', 'url', 'sections', 'postedAt', 'applicants', 'salary', 'criteria'];
  if (withDesc) cols.push('description');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = jobs.map((j) => cols.map((c) => {
    if (c === 'sections') return cell(j.sections.join('; '));
    if (c === 'criteria') return cell(Object.entries(j.criteria || {}).map(([k, v]) => `${k}: ${v}`).join('; '));
    return cell(j[c]);
  }).join(','));
  return '﻿' + [cols.join(','), ...rows].join('\r\n');
}

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// ---------- UI ----------

function setRunningUI(on) {
  for (const id of ['startAll', 'startDetails', 'discover', 'diagnose', 'resetSections', 'clearJobs', 'retryErrors']) {
    $(`#${id}`).disabled = on;
  }
  $('#stop').disabled = !on;
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c) => c != null));
  return e;
}

function renderSections() {
  const ul = $('#sections');
  ul.replaceChildren(...state.sections.map((s, i) => {
    const cb = el('input', { type: 'checkbox', checked: s.enabled });
    cb.onchange = () => { s.enabled = cb.checked; save(); };
    const rm = el('button', { className: 'ghost remove', textContent: '×', title: 'Remover seção' });
    rm.onclick = () => { state.sections.splice(i, 1); save(); renderSections(); };
    return el('li', {},
      cb,
      el('span', { className: 'name', textContent: s.name }),
      el('a', { href: s.url, target: '_blank', textContent: s.url }),
      rm);
  }));
}

function renderStats() {
  const jobs = Object.values(state.jobs);
  const count = (st) => jobs.filter((j) => j.detailStatus === st).length;
  const stat = (label, n) => el('span', {}, `${label}: `, el('b', { textContent: n }));
  $('#stats').replaceChildren(
    stat('Vagas', jobs.length),
    stat('Com descrição', count('ok')),
    stat('Pendentes', count('pending')),
    stat('Erros', count('error')),
    el('span', { className: apiOnline ? 'api-on' : 'api-off' },
      apiOnline == null ? 'Banco: …' : apiOnline ? 'Banco: conectado' : 'Banco: offline'));
}

const STATUS_LABEL = { ok: '✓ ok', pending: 'pendente', error: 'erro' };
const MAX_ROWS = 500;

function renderJobs() {
  const jobs = visibleJobs();
  $('#jobs').replaceChildren(...jobs.slice(0, MAX_ROWS).map((j) => {
    const rm = el('button', { className: 'ghost remove', textContent: '×', title: 'Remover vaga' });
    rm.onclick = () => { delete state.jobs[j.id]; save(); render(); };
    return el('tr', {},
      el('td', {}, el('a', { href: j.url, target: '_blank', textContent: j.title || j.id })),
      el('td', { textContent: j.company }),
      el('td', { textContent: j.location }),
      el('td', {}, ...j.sections.map((s) => el('span', { className: 'chip', textContent: s }))),
      el('td', {
        className: `status-${j.detailStatus}`,
        textContent: STATUS_LABEL[j.detailStatus] || j.detailStatus,
        title: j.detailError || '',
      }),
      el('td', {}, rm));
  }));
  $('#tableNote').textContent = jobs.length > MAX_ROWS
    ? `Mostrando ${MAX_ROWS} de ${jobs.length} (a exportação inclui todas).`
    : `${jobs.length} vagas no filtro.`;
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    renderStats();
    renderJobs();
  });
}

function bind() {
  const { settings } = state;
  $('#maxPages').value = settings.maxPages;
  $('#delayMs').value = settings.delayMs;
  $('#fetchDetails').checked = settings.fetchDetails;
  $('#maxPages').onchange = (e) => { settings.maxPages = Math.max(1, +e.target.value || 1); save(); };
  $('#delayMs').onchange = (e) => { settings.delayMs = Math.max(500, +e.target.value || 2500); save(); };
  $('#fetchDetails').onchange = (e) => { settings.fetchDetails = e.target.checked; save(); };

  $('#startAll').onclick = () => start('all');
  $('#startDetails').onclick = () => start('details');
  $('#stop').onclick = () => { stopRequested = true; log('Parando após a ação atual…'); };
  $('#discover').onclick = discover;
  $('#diagnose').onclick = diagnose;
  $('#resetSections').onclick = () => {
    state.sections = structuredClone(DEFAULT_SECTIONS);
    save();
    renderSections();
  };
  $('#addSection').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#newUrl').value.trim();
    if (!/^https:\/\/www\.linkedin\.com\//.test(raw)) { alert('Use uma URL de https://www.linkedin.com/'); return; }
    // Remove parâmetros que só marcam a vaga aberta/paginação atual.
    const u = new URL(raw);
    for (const p of ['currentJobId', 'originToLandingJobPostings', 'start', 'refId', 'trackingId']) u.searchParams.delete(p);
    const url = u.toString();
    state.sections.push({ name: $('#newName').value.trim(), url, enabled: true });
    e.target.reset();
    save();
    renderSections();
  };

  $('#filter').oninput = render;
  const withDesc = () => $('#includeDesc').checked;
  $('#copyMd').onclick = async () => {
    await navigator.clipboard.writeText(toMarkdown(visibleJobs(), withDesc()));
    $('#copyMd').textContent = 'Copiado!';
    setTimeout(() => ($('#copyMd').textContent = 'Copiar Markdown'), 1500);
  };
  $('#dlMd').onclick = () => download(toMarkdown(visibleJobs(), withDesc()), `vagas-${stamp()}.md`, 'text/markdown');
  $('#dlJson').onclick = () => {
    const jobs = visibleJobs().map((j) => (withDesc() ? j : { ...j, description: undefined }));
    download(JSON.stringify(jobs, null, 2), `vagas-${stamp()}.json`, 'application/json');
  };
  $('#dlCsv').onclick = () => download(toCsv(visibleJobs(), withDesc()), `vagas-${stamp()}.csv`, 'text/csv');

  $('#syncAll').onclick = async () => {
    log('Enviando todas as vagas ao banco…');
    const sent = await flushSync({ all: true });
    log(apiOnline ? `${sent} vagas enviadas ao banco.` : 'Não foi possível falar com o banco.', apiOnline ? 'ok' : 'error');
  };
  $('#copyTriage').onclick = async () => {
    try {
      await flushSync();
      const text = await api('/export/compact');
      await navigator.clipboard.writeText(text);
      log(`Triagem copiada (${text.split('\n').length - 1} vagas, sem pleno/sênior, PcD, duplicatas e com mais de 30 dias).`, 'ok');
    } catch (e) {
      setApiOnline(false);
      log(`Triagem indisponível: ${e.message}`, 'error');
    }
  };

  $('#retryErrors').onclick = () => {
    let n = 0;
    for (const j of Object.values(state.jobs)) if (j.detailStatus === 'error') { j.detailStatus = 'pending'; n++; }
    log(`${n} vagas voltaram para pendente.`);
    save();
    render();
  };
  $('#clearJobs').onclick = () => {
    const msg = 'Limpar a lista desta tela?\n\nAs vagas continuam no banco, com as avaliações e os status. '
      + 'Ao coletar de novo, as mesmas vagas são atualizadas no banco (não duplicam) e as descrições já salvas são reaproveitadas.';
    if (!confirm(msg)) return;
    state.jobs = {};
    save(true);
    render();
  };

  window.addEventListener('beforeunload', (e) => { if (running) e.preventDefault(); });
}

(async () => {
  await load();
  bind();
  renderSections();
  render();
  ensureApi();
  // Outra aba do painel salvou algo: adota os dados em vez de sobrescrevê-los depois.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || running) return;
    if (changes.jobs) state.jobs = changes.jobs.newValue || {};
    if (changes.sections) { state.sections = changes.sections.newValue || []; renderSections(); }
    render();
  });
})();
