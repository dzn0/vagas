// Busca de vagas locais (Presidente Prudente por padrão) fora da extensão.
// LinkedIn: endpoints públicos "jobs-guest" (sem login). Outros sites: a skill encontra e
// envia os dados prontos para `local-save`. Só entra no banco o que passou na triagem;
// o que foi descartado fica em data/local-seen.json para não ser reprocessado.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrich } from './enrich.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEEN_FILE = path.join(here, 'data', 'local-seen.json');
export const CANDIDATES_FILE = path.join(here, 'data', 'tmp', 'local-candidates.json');

export const DEFAULT_CITY = 'Presidente Prudente, São Paulo, Brasil';
export const DEFAULT_KEYWORDS = [
  'desenvolvedor', 'programador', 'estágio desenvolvimento', 'estágio TI', 'estágio sistemas',
  'front-end', 'full stack', 'software', 'web', 'tecnologia da informação', 'freelancer site',
  'suporte técnico', 'técnico de informática', 'analista de sistemas', 'analista de dados', 'infraestrutura TI', 'marketing digital',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const clean = (s) => decode(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const htmlToText = (html) => decode(String(html ?? '')
  .replace(/<(br|\/p|\/li|\/h\d|\/div|\/ul)[^>]*>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, ' '))
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// ---------- ids ----------

// Vaga do LinkedIn usa o id dele; qualquer outra URL vira um id numérico estável (≥ 1e18,
// longe da faixa do LinkedIn) para caber na coluna bigint.
export function idFromUrl(url) {
  const li = String(url).match(/linkedin\.com\/.*?(?:jobs\/view\/(?:[^/?]*-)?|jobPosting[:/])(\d{6,})/);
  if (li) return li[1];
  const normalized = String(url).trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const hex = createHash('sha256').update(normalized).digest('hex').slice(0, 15);
  return String(BigInt(`0x${hex}`) + 10n ** 18n);
}

// ---------- memória de descartes ----------

export function readSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeSeen(seen) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 1));
}

export function readCandidates() {
  try {
    return JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// ---------- LinkedIn público ----------

export async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (r.ok) return r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    if (r.status === 400 || r.status === 404) return '';
    throw new Error(`${url}: HTTP ${r.status}`);
  }
  return '';
}

export function parseCards(html) {
  return html.split(/<li>/).slice(1).map((li) => {
    const id = li.match(/urn:li:jobPosting:(\d+)/)?.[1];
    if (!id) return null;
    return {
      id,
      title: clean(li.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1]),
      company: clean(li.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1]),
      location: clean(li.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1]),
      posted_text: clean(li.match(/<time[^>]*>([\s\S]*?)<\/time>/)?.[1]),
      salary_text: clean(li.match(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/)?.[1]) || null,
    };
  }).filter(Boolean);
}

export async function fetchDetail(card) {
  const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.id}`);
  if (!html) return null;
  const criteria = {};
  for (const m of html.matchAll(/description__job-criteria-subheader">([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)) {
    criteria[clean(m[1])] = clean(m[2]);
  }
  const markup = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const applicants = clean(html.match(/num-applicants__caption[^>]*>([\s\S]*?)<\/(?:span|figcaption)>/)?.[1]);
  return {
    id: card.id,
    url: `https://www.linkedin.com/jobs/view/${card.id}/`,
    title: card.title,
    company: card.company,
    location: card.location,
    card_text: [card.title, card.company, card.location, card.posted_text].filter(Boolean).join('\n'),
    posted_text: card.posted_text || clean(html.match(/posted-time-ago__text[^>]*>([\s\S]*?)<\/span>/)?.[1]),
    applicants_text: applicants || null,
    salary_text: card.salary_text,
    description: htmlToText(markup),
    criteria,
    detail_status: markup ? 'ok' : 'pending',
    source: 'linkedin-local',
  };
}

// Devolve as vagas da cidade que ainda não estão no banco nem na memória de descartes.
export async function searchLinkedIn({ city = DEFAULT_CITY, keywords = DEFAULT_KEYWORDS, days = 7, pages = 2, isKnown }) {
  const seen = readSeen();
  const cards = new Map();
  for (const kw of keywords) {
    for (let page = 0; page < pages; page++) {
      const qs = new URLSearchParams({
        keywords: kw, location: city, distance: '25', f_TPR: `r${days * 86400}`, start: String(page * 10),
      });
      const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${qs}`);
      const found = parseCards(html);
      for (const c of found) if (!cards.has(c.id)) cards.set(c.id, c);
      await sleep(700);
      if (found.length < 10) break;
    }
  }

  const fresh = [];
  let known = 0;
  for (const card of cards.values()) {
    if (seen[card.id] || (await isKnown(card.id))) { known++; continue; }
    const job = await fetchDetail(card);
    if (job) fresh.push(job);
    await sleep(700);
  }

  const candidates = Object.fromEntries(fresh.map((j) => [j.id, j]));
  fs.mkdirSync(path.dirname(CANDIDATES_FILE), { recursive: true });
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify({ ...readCandidates(), ...candidates }, null, 1));
  return { total: cards.size, known, fresh };
}

// Linha de triagem no mesmo espírito de toCompactText, com um trecho da descrição
// (vagas locais costumam vir sem nível e sem modalidade no card).
export function localLine(job, snippet = 280) {
  const d = enrich({ ...job, criteria: job.criteria ?? {} });
  const age = d.posted_at ? `${Math.floor((Date.now() - new Date(d.posted_at)) / 864e5)}d` : '?';
  const cand = d.few_applicants ? 'poucos candidatos' : d.applicants != null ? `${d.applicants} candidatos` : '';
  const desc = String(job.description ?? '').replace(/\s+/g, ' ').slice(0, snippet);
  return [
    job.id, `${job.title} — ${job.company}`, `${job.location ?? '?'} · ${d.workplace ?? 'modalidade ?'}`,
    d.seniority ?? 'nível ?', age, cand, d.contract.join('/'), d.techs.slice(0, 8).join(', '), desc,
  ].filter(Boolean).join(' | ');
}
