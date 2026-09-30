// Coleta automática: roda as buscas do escopo (preferences.busca) no LinkedIn público, sem login
// e sem a extensão. Só baixa a descrição das vagas que ainda não estão no banco e cujo título não
// é claramente de nível acima (o filtro SQL descartaria de qualquer jeito).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDetail, get, parseCards } from './local.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(here, 'data', 'collect-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms + Math.round(Math.random() * ms * 0.4)));

// A busca pública ignora os filtros de nível (f_E) e modalidade (f_WT): nível e modalidade
// entram pelos termos, e o resto fica para o enriquecimento + filtros SQL. O país precisa ir
// por geo_id (location=Brasil em texto é ignorado e volta vaga dos EUA); `local` numa busca
// (ex.: "Presidente Prudente, São Paulo, Brasil") troca o país por cidade + raio de 25 km.
export const DEFAULT_SCOPE = {
  geo_id: '106057199',
  paginas: 4,
  dias_max: 7,
  max_detalhes: 200,
  ignorar_titulos: [
    'pleno', 'senior', 'sr', 'lead', 'lider', 'especialista', 'staff', 'principal', 'coordenador',
    'gerente', 'head', 'arquiteto', 'manager', 'supervisor', 'ii', 'iii',
  ],
  buscas: [
    { nome: 'Front-end júnior', termos: ['desenvolvedor front-end júnior', 'front end react júnior'] },
    { nome: 'Full stack júnior', termos: ['desenvolvedor full stack júnior'] },
    { nome: 'Dev júnior', termos: ['desenvolvedor júnior', 'programador júnior'] },
    { nome: 'Estágio dev', termos: ['estágio desenvolvimento de software', 'estágio programação', 'estágio front-end'] },
    { nome: 'Trainee dev', termos: ['trainee desenvolvedor'] },
  ],
};

export const scopeFrom = (prefs) => ({ ...DEFAULT_SCOPE, ...(prefs?.busca ?? {}) });

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ENTRY = /\b(junior|jr|estagi|trainee|aprendiz|iniciante)/;

function titleBlocked(title, words) {
  const t = norm(title);
  if (ENTRY.test(t)) return false;
  return words.some((w) => new RegExp(`\\b${norm(w)}\\b`).test(t));
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Janela da busca: desde a última coleta automática (+1 dia de folga), limitada a dias_max.
export function windowDays(scope, override) {
  if (override) return Number(override);
  const last = readState().last_run;
  if (!last) return scope.dias_max;
  const since = Math.ceil((Date.now() - new Date(last)) / 864e5) + 1;
  return Math.min(scope.dias_max, Math.max(1, since));
}

// isKnown(ids) → Set dos ids já no banco. save(jobs) grava um lote.
// advance: false quando a janela pedida é menor que a automática (não marca como coletado).
export async function collect(scope, { days, advance = true, isKnown, save, progress = () => {} }) {
  const cards = new Map(); // id → card com .sections
  const perSearch = [];

  for (const search of scope.buscas) {
    const where = search.local
      ? { location: search.local, distance: '25' }
      : { geoId: search.geo_id ?? scope.geo_id };
    const pages = search.paginas ?? scope.paginas;
    let found = 0;
    let blocked = 0;
    for (const kw of search.termos) {
      for (let page = 0; page < pages; page++) {
        const qs = new URLSearchParams({ keywords: kw, ...where, f_TPR: `r${days * 86400}`, start: String(page * 10) });
        const list = parseCards(await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${qs}`));
        await sleep(800);
        for (const c of list) {
          found++;
          if (titleBlocked(c.title, search.ignorar_titulos ?? scope.ignorar_titulos)) { blocked++; continue; }
          const prev = cards.get(c.id);
          if (prev) prev.sections.add(search.nome);
          else cards.set(c.id, { ...c, sections: new Set([search.nome]) });
        }
        if (list.length < 10) break;
      }
    }
    perSearch.push({ nome: search.nome, found, blocked });
    progress(`${search.nome}: ${found} vagas, ${blocked} ignoradas pelo título`);
  }

  const known = await isKnown([...cards.keys()]);
  const fresh = [...cards.values()].filter((c) => !known.has(c.id));
  const toFetch = fresh.slice(0, scope.max_detalhes);
  progress(`${cards.size} vagas únicas, ${known.size} já no banco, ${fresh.length} novas; baixando ${toFetch.length} descrições…`);

  let inserted = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    inserted += (await save(batch)).inserted;
    batch = [];
  };
  for (const [i, card] of toFetch.entries()) {
    const job = await fetchDetail(card);
    await sleep(800);
    if (!job) continue;
    delete job.source;
    batch.push({ ...job, sections: [...card.sections] });
    if (batch.length >= 20) {
      await flush();
      progress(`${i + 1}/${toFetch.length} descrições`);
    }
  }
  await flush();

  // Com sobra, a janela não avança: a próxima execução ainda alcança as que ficaram.
  if (advance && fresh.length <= toFetch.length) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ last_run: new Date().toISOString() }));
  }

  return {
    days, perSearch, unique: cards.size, known: known.size, fresh: fresh.length,
    fetched: toFetch.length, inserted, leftover: fresh.length - toFetch.length,
  };
}
