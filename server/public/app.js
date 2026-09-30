// Página de vagas: lê e grava direto na API local (server/index.js).
import { ICONS } from './icons.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="octicon ${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

// ---------- vocabulário ----------

const STATUSES = [
  { id: 'nova', label: 'Nova', icon: 'issue-opened' },
  { id: 'interessante', label: 'Interessante', icon: 'star' },
  { id: 'aplicada', label: 'Aplicada', icon: 'check-circle' },
  { id: 'entrevista', label: 'Entrevista', icon: 'comment-discussion' },
  { id: 'encerrada', label: 'Encerrada', icon: 'issue-closed' },
  // Cinza, como o "closed as not planned" do GitHub: descartar é arquivar, não erro.
  { id: 'descartada', label: 'Descartada', icon: 'skip' },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

const VERDICTS = [
  { id: 'forte', label: 'Forte', cls: 'label-success' },
  { id: 'avaliar', label: 'Avaliar', cls: 'label-attention' },
  { id: 'fila', label: 'Na fila da IA', cls: 'label-outline' },
  { id: 'descartar', label: 'IA descartou', cls: 'label-outline' },
  { id: 'sem', label: 'Sem avaliação', cls: 'label-outline' },
];
const VERDICT = Object.fromEntries(VERDICTS.map((v) => [v.id, v]));

const WORKPLACES = { remoto: 'Remoto', hibrido: 'Híbrido', presencial: 'Presencial' };
const LEVELS = {
  estagio: 'Estágio', aprendiz: 'Aprendiz', trainee: 'Trainee', junior: 'Júnior',
  pleno: 'Pleno', pleno_senior: 'Pleno/Sênior', senior: 'Sênior', lead: 'Liderança',
};
const SORTS = [
  { id: 'ai', label: 'Nota da IA' },
  { id: 'recentes', label: 'Publicadas mais recentemente' },
  { id: 'coletadas', label: 'Coletadas mais recentemente' },
  { id: 'atualizadas', label: 'Status mudado mais recentemente' },
  { id: 'candidatos', label: 'Menos candidatos' },
];
const TABS = [
  { id: 'recomendadas', label: 'Recomendadas', test: (j) => ['nova', 'interessante'].includes(j.status) && ['forte', 'avaliar'].includes(verdictOf(j)) },
  { id: 'interessantes', label: 'Interessantes', test: (j) => j.status === 'interessante' },
  { id: 'aplicadas', label: 'Aplicadas', test: (j) => j.status === 'aplicada' },
  { id: 'entrevistas', label: 'Entrevistas', test: (j) => j.status === 'entrevista' },
  { id: 'cobrar', label: 'Cobrar retorno', test: (j) => S.followUp.has(String(j.id)), attention: true },
  { id: 'todas', label: 'Todas', test: () => true },
];
const FILTERS = [
  { key: 'status', label: 'Status', options: () => STATUSES.map((s) => ({ value: s.id, label: s.label, icon: s.icon, cls: `state-${s.id}` })) },
  { key: 'verdict', label: 'IA', options: () => VERDICTS.map((v) => ({ value: v.id, label: v.label })) },
  { key: 'workplace', label: 'Modalidade', options: () => [...Object.entries(WORKPLACES), ['?', 'Não informada']].map(([value, label]) => ({ value, label })) },
  { key: 'seniority', label: 'Nível', options: () => [...Object.entries(LEVELS), ['?', 'Não informado']].map(([value, label]) => ({ value, label })) },
  { key: 'section', label: 'Busca', options: () => sectionOptions() },
];

// Qualificadores na busca, como no GitHub: status:aplicada ia:forte,avaliar busca:"Dev júnior"
const QUALIFIERS = { status: 'status', ia: 'verdict', modalidade: 'workplace', nivel: 'seniority', busca: 'section' };
const QUALIFIER_OF = Object.fromEntries(Object.entries(QUALIFIERS).map(([q, key]) => [key, q]));

function verdictOf(j) {
  if (!j.ai_verdict) return 'sem';
  if (j.ai_stage === 'triagem' && j.ai_verdict !== 'descartar') return 'fila';
  return j.ai_verdict;
}

// ---------- estado ----------

const PAGE = 60;
const emptyFilters = () => Object.fromEntries(FILTERS.map((f) => [f.key, new Set()]));
const S = {
  jobs: [],
  byId: new Map(),
  followUp: new Set(),
  health: null,
  tab: 'recomendadas',
  q: '',
  filters: emptyFilters(),
  sort: 'ai',
  view: 'list',
  openId: null,
  selected: new Set(),
  shown: PAGE,
  cursor: -1,
  visible: [],
  loadedAt: 0,
  loading: true,
  error: null,
  details: new Map(),
};

function parseQuery(text) {
  const filters = emptyFilters();
  const free = [];
  for (const m of text.matchAll(/(\w+):(?:"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/g)) {
    const key = m[1] && QUALIFIERS[m[1].toLowerCase()];
    if (key) {
      for (const v of (m[2] ?? m[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) filters[key].add(v);
    } else {
      free.push(m[4] ?? m[5] ?? m[0]);
    }
  }
  return { filters, free: free.join(' ').trim() };
}

function queryText() {
  const parts = [];
  for (const f of FILTERS) {
    const joined = [...S.filters[f.key]].join(',');
    if (!joined) continue;
    parts.push(/[\s"]/.test(joined) ? `${QUALIFIER_OF[f.key]}:"${joined}"` : `${QUALIFIER_OF[f.key]}:${joined}`);
  }
  if (S.q) parts.push(S.q);
  return parts.join(' ');
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  if (TABS.some((t) => t.id === p.get('tab'))) S.tab = p.get('tab');
  S.q = p.get('q') ?? '';
  if (SORTS.some((s) => s.id === p.get('sort'))) S.sort = p.get('sort');
  if (p.get('view') === 'board') S.view = 'board';
  S.openId = p.get('id');
  for (const f of FILTERS) S.filters[f.key] = new Set((p.get(f.key) ?? '').split(',').filter(Boolean));
}

function writeUrl() {
  const p = new URLSearchParams();
  if (S.tab !== 'recomendadas') p.set('tab', S.tab);
  if (S.q) p.set('q', S.q);
  if (S.sort !== 'ai') p.set('sort', S.sort);
  if (S.view === 'board') p.set('view', 'board');
  for (const f of FILTERS) if (S.filters[f.key].size) p.set(f.key, [...S.filters[f.key]].join(','));
  if (S.openId) p.set('id', S.openId);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---------- API ----------

async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function load({ quiet = false } = {}) {
  if (!quiet) { S.loading = true; render(); }
  try {
    const [jobs, pipeline, health] = await Promise.all([
      api('/jobs?hide_dups=1&limit=2000'),
      api('/pipeline'),
      api('/health'),
    ]);
    S.jobs = jobs;
    S.byId = new Map(jobs.map((j) => [String(j.id), j]));
    S.followUp = new Set(pipeline.followUp.map((f) => String(f.id)));
    S.health = health;
    S.error = null;
    S.loadedAt = Date.now();
    for (const id of S.selected) if (!S.byId.has(id)) S.selected.delete(id);
  } catch (e) {
    S.error = e.message;
  }
  S.loading = false;
  render();
}

// ---------- utilidades ----------

function ago(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date);
  const h = Math.floor(ms / 36e5);
  if (h < 1) return 'agora há pouco';
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 45) return `há ${d} dias`;
  return `há ${Math.round(d / 30)} meses`;
}

const place = (j) => [j.city, j.state].filter(Boolean).join('/') || j.location || 'Local não informado';

function applicantsText(j) {
  if (j.few_applicants) return 'poucos candidatos';
  if (j.applicants != null) return `${j.applicants} candidatos`;
  return null;
}

function money(j) {
  const f = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  if (j.salary_min && j.salary_max && j.salary_min !== j.salary_max) return `${f(j.salary_min)} – ${f(j.salary_max)}`;
  if (j.salary_min || j.salary_max) return f(j.salary_min || j.salary_max);
  return j.salary_text || null;
}

function sectionOptions() {
  const counts = new Map();
  for (const j of S.jobs) for (const s of j.sections ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: value, n }));
  list.push({ value: '?', label: 'Sem busca (sites locais)', n: S.jobs.filter((j) => !(j.sections ?? []).length).length });
  return list;
}

// O texto do LinkedIn vem com linha em branco entre todas as linhas e os botões "Show more/less" no fim.
function cleanDescription(text) {
  const t = String(text ?? '').replace(/\s*Show more\s*Show less\s*$/i, '').replace(/\n\s*\n+/g, '\n').trim();
  return t || 'Sem descrição salva.';
}

// Corpo da vaga como corpo de issue: "Rótulo: texto" ganha rótulo em negrito, e rótulos colados
// ("Descrição:Estamos", ". Requisitos:Cursando") viram linha própria, com espaço depois dos dois-pontos.
const LABEL = '[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9/()\\- ]{1,38}';
const LABEL_INLINE = new RegExp(`([.!?;])\\s*(${LABEL}):(?=\\S)`, 'g');
const LABEL_GLUED = new RegExp(`^(${LABEL}):(?=\\S)`, 'gm');
const LABEL_LINE = new RegExp(`^(${LABEL}):\\s*(.*)$`);

// Seções comuns em anúncios brasileiros: quebram linha onde aparecerem, com ou sem pontuação antes.
const KNOWN_SECTION = /\s*\b(Descrição|Responsabilidades|Requisitos|Benefícios|Atividades|Diferenciais|Qualificações|Sobre a vaga|Sobre nós|Local de trabalho|Horário|Remuneração)\s*:\s*/g;
// Campos da ficha que sites de vaga põem no fim do anúncio, um rótulo por linha e o valor abaixo.
const FACT_KEYS = new Set([
  'formação acadêmica', 'formação', 'escolaridade', 'salário', 'remuneração', 'cargo', 'empresa', 'ramo', 'área',
  'local', 'cidade', 'contrato', 'tipo de contrato', 'regime', 'jornada', 'horário', 'modalidade', 'nível',
  'benefícios', 'vagas', 'quantidade de vagas', 'setor', 'segmento',
]);
const isFactKey = (l) => FACT_KEYS.has(l.toLowerCase().replace(/:$/, ''));
const SHORT_LINE = (l) => l.length <= 60 && !/:$/.test(l);

function renderDescription(text) {
  const t = text
    .replace(KNOWN_SECTION, (_, label) => `\n${label}: `)
    .replace(LABEL_INLINE, (_, punct, label) => `${punct}\n${label}: `)
    .replace(LABEL_GLUED, (_, label) => `${label}: `)
    .trim();
  // Códigos soltos de fonte no fim ("(FB)") não são conteúdo.
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l && !/^\(\w{1,5}\)$/.test(l));

  // Ficha no fim ("Salário" / "A combinar" / "Empresa" / "X" / "Desenvolvimento de softwares." …):
  // do primeiro rótulo conhecido em diante, se só houver linhas curtas, vira lista de definição.
  const facts = [];
  const first = lines.findIndex(isFactKey);
  if (first >= 0 && lines.slice(first).every(SHORT_LINE) && lines.slice(first).filter(isFactKey).length >= 2) {
    for (const line of lines.splice(first)) {
      if (isFactKey(line)) facts.push([line.replace(/:$/, ''), []]);
      else facts.at(-1)[1].push(line);
    }
  }

  const body = lines.map((line) => {
    const m = line.match(LABEL_LINE);
    if (m) return `<p><strong>${esc(m[1])}:</strong> ${esc(m[2])}</p>`;
    if (/^[-•*]\s/.test(line)) return `<p class="bullet">${esc(line.replace(/^[-•*]\s*/, ''))}</p>`;
    return `<p>${esc(line)}</p>`;
  }).join('');
  if (!facts.length) return body;
  const pairs = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v.join(' — ') || '—')}</dd>`);
  return `${body}<dl class="fields description-facts">${pairs.join('')}</dl>`;
}

// ---------- filtro e ordem ----------

function matchesFilters(j) {
  const f = S.filters;
  if (f.status.size && !f.status.has(j.status)) return false;
  if (f.verdict.size && !f.verdict.has(verdictOf(j))) return false;
  if (f.workplace.size && !f.workplace.has(j.workplace ?? '?')) return false;
  if (f.seniority.size && !f.seniority.has(j.seniority ?? '?')) return false;
  if (f.section.size) {
    const secs = j.sections?.length ? j.sections : ['?'];
    if (!secs.some((s) => f.section.has(s))) return false;
  }
  if (S.q) {
    const hay = `${j.title} ${j.company} ${j.city ?? ''} ${j.state ?? ''} ${j.location ?? ''} ${(j.techs ?? []).join(' ')} ${j.id}`.toLowerCase();
    if (!S.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const time = (d) => (d ? new Date(d).getTime() : 0);
const SORTERS = {
  ai: (a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1) || b.pre_score - a.pre_score,
  recentes: (a, b) => time(b.posted_at) - time(a.posted_at),
  coletadas: (a, b) => time(b.first_seen_at) - time(a.first_seen_at),
  atualizadas: (a, b) => time(b.status_changed_at) - time(a.status_changed_at),
  candidatos: (a, b) => (a.few_applicants ? 0 : a.applicants ?? 1e6) - (b.few_applicants ? 0 : b.applicants ?? 1e6),
};

function computeVisible() {
  const tab = TABS.find((t) => t.id === S.tab);
  const base = S.jobs.filter(matchesFilters).sort(SORTERS[S.sort]);
  S.tabCounts = Object.fromEntries(TABS.map((t) => [t.id, base.filter(t.test).length]));
  S.visible = base.filter(tab.test);
  S.boardSet = base;
}

// ---------- renderização ----------

function render() {
  computeVisible();
  renderMeta();
  renderFollowUp();
  renderTabs();
  renderFilters();
  $('#listBox').hidden = S.view !== 'list';
  $('#board').hidden = S.view !== 'board';
  for (const b of document.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(b.dataset.view === S.view));
  if (S.view === 'list') renderRows(); else renderBoard();
  renderPanel();
  renderBulk();
  const input = $('#q');
  if (document.activeElement !== input) input.value = queryText();
  writeUrl();
}

function renderMeta() {
  const el = $('#meta');
  if (S.error) { el.innerHTML = `<span style="color:var(--danger)">Banco indisponível: ${esc(S.error)}</span>`; return; }
  if (!S.health) { el.textContent = 'Carregando…'; return; }
  const count = (test) => S.jobs.filter(test).length;
  el.innerHTML = `<b>${S.jobs.length}</b> vagas · <b>${count(TABS[0].test)}</b> recomendadas · <b>${count((j) => j.status === 'aplicada')}</b> aplicadas · última coleta ${esc(ago(S.health.ultima_coleta) ?? 'nunca')}`;
}

function renderFollowUp() {
  const el = $('#followup');
  const n = S.followUp.size;
  el.hidden = !n || S.tab === 'cobrar';
  if (el.hidden) return;
  el.innerHTML = `${icon('clock')}<span><strong>${n} ${n === 1 ? 'candidatura está' : 'candidaturas estão'}</strong> sem mudança de status há mais de 7 dias. Vale cobrar retorno.</span>
    <button class="btn btn-sm" type="button" data-tab="cobrar">Ver candidaturas</button>`;
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map((t) => {
    const n = S.tabCounts[t.id];
    return `<button class="tab ${t.attention && n ? 'attention' : ''}" role="tab" type="button" data-tab="${t.id}" aria-selected="${S.tab === t.id}">
      ${t.label}<span class="count">${n}</span></button>`;
  }).join('');
}

function renderFilters() {
  $('#filters').innerHTML = FILTERS.map((f) => {
    const n = S.filters[f.key].size;
    return `<button class="filter-btn ${n ? 'active' : ''}" type="button" data-filter="${f.key}" aria-haspopup="menu">
      ${f.label}${n ? ` (${n})` : ''}${icon('triangle-down')}</button>`;
  }).join('') + `<button class="filter-btn" type="button" data-sort aria-haspopup="menu">${icon('sort-desc')}${esc(SORTS.find((s) => s.id === S.sort).label)}${icon('triangle-down')}</button>`;
}

function labelsFor(j, { compact = false } = {}) {
  const v = VERDICT[verdictOf(j)];
  const out = [];
  if (!compact || ['forte', 'avaliar'].includes(v.id)) out.push(`<span class="label ${v.cls}">${esc(v.label)}</span>`);
  if (S.followUp.has(String(j.id))) out.push(`<span class="label label-severe">${icon('clock')}cobrar retorno</span>`);
  if (j.workplace) out.push(`<span class="label label-outline">${esc(WORKPLACES[j.workplace])}</span>`);
  if (!compact && j.seniority) out.push(`<span class="label label-outline">${esc(LEVELS[j.seniority] ?? j.seniority)}</span>`);
  if (!compact && j.easy_apply) out.push('<span class="label label-accent">candidatura simplificada</span>');
  return out.join('');
}

function stateIcon(j) {
  const s = STATUS[j.status] ?? STATUS.nova;
  return `<span class="state state-${s.id}" title="${s.label}">${icon(s.icon)}</span>`;
}

function scoreBlock(j) {
  const v = verdictOf(j);
  if (j.ai_score != null && ['forte', 'avaliar', 'descartar'].includes(v)) {
    return `<span class="score score-${v}" title="Nota da IA">${j.ai_score}</span>`;
  }
  return `<span class="score score-none" title="Pré-nota das regras; a IA ainda não avaliou">${j.pre_score}</span><span class="score-caption">pré-nota</span>`;
}

function rowMeta(j) {
  const parts = [esc(j.company || 'Empresa não informada'), esc(place(j))];
  const posted = ago(j.posted_at);
  if (posted) parts.push(`publicada ${esc(posted)}`);
  const cand = applicantsText(j);
  if (cand) parts.push(esc(cand));
  if (j.dup_count > 1) parts.push(`${j.dup_count} anúncios iguais`);
  if (j.techs?.length) parts.push(esc(j.techs.slice(0, 5).join(', ')));
  return parts.join('<span class="sep">·</span>');
}

function renderRows() {
  const rows = $('#rows');
  const blank = $('#blank');
  const more = $('#more');
  rows.classList.toggle('selecting', S.selected.size > 0);

  if (S.loading && !S.jobs.length) {
    rows.innerHTML = Array.from({ length: 6 }, () => `<li class="row" aria-hidden="true"><span></span><span></span>
      <div><div class="skeleton" style="width:45%"></div><div class="skeleton" style="width:70%;margin-top:8px"></div></div><span></span></li>`).join('');
    blank.hidden = true; more.hidden = true;
    return;
  }
  if (S.error && !S.jobs.length) {
    rows.innerHTML = '';
    blank.hidden = false;
    blank.innerHTML = `${icon('alert')}<h3>Não consegui falar com o banco</h3>
      <p>${esc(S.error)}. Rode <code>node server/cli.js ensure</code> e recarregue a página.</p>`;
    more.hidden = true;
    return;
  }
  if (!S.visible.length) {
    rows.innerHTML = '';
    blank.hidden = false;
    const filtered = S.q || FILTERS.some((f) => S.filters[f.key].size);
    const empty = {
      recomendadas: ['Nenhuma recomendação pendente', 'Tudo que a IA aprovou já tem status. Rode /vagas para buscar e avaliar vagas novas.'],
      cobrar: ['Nenhuma candidatura para cobrar', 'Toda candidatura aplicada ou em entrevista mudou de status nos últimos 7 dias.'],
    }[S.tab] ?? ['Nada por aqui', 'Quando alguma vaga chegar a este status, ela aparece aqui.'];
    blank.innerHTML = filtered
      ? `${icon('search')}<h3>Nenhuma vaga com esses filtros</h3><p>Tente outra aba ou <a href="#" data-clear>limpe os filtros</a>.</p>`
      : `${icon('inbox')}<h3>${empty[0]}</h3><p>${empty[1]}</p>`;
    more.hidden = true;
    return;
  }
  blank.hidden = true;
  const list = S.visible.slice(0, S.shown);
  rows.innerHTML = list.map((j, i) => {
    const id = String(j.id);
    return `<li class="row ${S.openId === id ? 'active' : ''} ${S.cursor === i ? 'cursor' : ''}" role="option" data-id="${id}" data-index="${i}" aria-selected="${S.openId === id}">
      <input class="row-check" type="checkbox" aria-label="Selecionar ${esc(j.title)}" ${S.selected.has(id) ? 'checked' : ''}>
      ${stateIcon(j)}
      <div class="row-main">
        <a class="row-title" href="?id=${id}" data-open>${esc(j.title)}</a><span class="labels">${labelsFor(j)}</span>
        <div class="row-meta">${rowMeta(j)}</div>
        ${j.ai_summary && ['forte', 'avaliar'].includes(verdictOf(j)) ? `<p class="row-summary">${esc(j.ai_summary)}</p>` : ''}
      </div>
      <div class="row-side">${scoreBlock(j)}</div>
    </li>`;
  }).join('');
  const rest = S.visible.length - list.length;
  more.hidden = rest <= 0;
  more.textContent = `Mostrar mais ${Math.min(rest, PAGE)} de ${rest} restantes`;
}

function renderBoard() {
  const COL_MAX = 60;
  $('#board').innerHTML = STATUSES.map((s) => {
    const items = S.boardSet.filter((j) => j.status === s.id);
    return `<div class="column" data-status="${s.id}">
      <div class="column-head"><span class="state state-${s.id}">${icon(s.icon)}</span>${s.label}<span class="count">${items.length}</span></div>
      ${items.length ? '' : '<p class="column-empty">Nenhuma vaga neste status. Arraste um cartão para cá.</p>'}
      <ul class="column-list">${items.slice(0, COL_MAX).map((j) => {
        const id = String(j.id);
        const score = j.ai_score != null && ['forte', 'avaliar'].includes(verdictOf(j)) ? `<span class="label ${VERDICT[verdictOf(j)].cls}">${j.ai_score}</span>` : '';
        return `<li class="card ${S.openId === id ? 'active' : ''}" draggable="true" data-id="${id}" tabindex="0">
          <div class="card-title">${stateIcon(j)}<span>${esc(j.title)}</span></div>
          <div class="card-meta">${esc(j.company || '')} · ${esc(place(j))}</div>
          <div class="card-foot">${score}${labelsFor(j, { compact: true })}</div>
        </li>`;
      }).join('')}</ul>
      ${items.length > COL_MAX ? `<div class="column-more">+ ${items.length - COL_MAX} (refine os filtros)</div>` : ''}
    </div>`;
  }).join('');
}

function renderBulk() {
  const n = S.selected.size;
  $('#bulkbar').hidden = !n || S.view !== 'list';
  $('#boxHeader').hidden = n > 0 && S.view === 'list';
  $('#selectAll').disabled = !S.visible.length;
  if (!n) return;
  // "Marcar todas" vale para a aba e os filtros atuais inteiros, não só para as linhas já carregadas.
  const ids = S.visible.map((j) => String(j.id));
  const allSelected = ids.length > 0 && ids.every((id) => S.selected.has(id));
  const tab = TABS.find((t) => t.id === S.tab).label;
  const filtered = S.q || FILTERS.some((f) => S.filters[f.key].size);
  $('#bulkCount').textContent = allSelected && ids.length > 1
    ? `Todas as ${n} vagas da aba ${tab}${filtered ? ', com os filtros atuais,' : ''} selecionadas`
    : `${n} ${n === 1 ? 'selecionada' : 'selecionadas'}`;
  const all = $('#bulkAll');
  all.checked = allSelected;
  all.indeterminate = !allSelected && ids.some((id) => S.selected.has(id));
}

function selectAllInTab(on) {
  for (const j of S.visible) {
    if (on) S.selected.add(String(j.id)); else S.selected.delete(String(j.id));
  }
  render();
}

// ---------- painel ----------

let panelFor = null;

function renderPanel() {
  const panel = $('#panel');
  const j = S.openId ? S.byId.get(S.openId) : null;
  $('#layout').classList.toggle('has-panel', Boolean(j));
  if (!j) { panel.hidden = true; panelFor = null; return; }
  panel.hidden = false;

  // Não reconstrói o painel enquanto o André digita nele.
  if (panelFor === S.openId && panel.contains(document.activeElement) && document.activeElement.matches('textarea, input')) {
    updatePanelStatus(j);
    return;
  }
  const scroll = panelFor === S.openId ? panel.scrollTop : 0;
  panelFor = S.openId;
  const detail = S.details.get(S.openId);
  const v = VERDICT[verdictOf(j)];
  const cand = applicantsText(j);
  const fields = [
    ['Empresa', esc(j.company || '—')],
    ['Local', esc(detail?.location_full || place(j))],
    ['Modalidade', esc(WORKPLACES[j.workplace] ?? 'Não informada')],
    ['Nível', esc(LEVELS[j.seniority] ?? 'Não informado')],
    ['Publicada', esc(ago(j.posted_at) ?? 'data desconhecida')],
    ['Candidatos', esc(cand ?? '—')],
    ['Contrato', esc(j.contract?.join(', ') || '—')],
    ['Salário', esc(money(j) ?? '—')],
    ['Experiência', j.years_min ? `${j.years_min}+ anos` : '—'],
    ['Tecnologias', j.techs?.length ? j.techs.map((t) => `<span class="label label-outline">${esc(t)}</span>`).join('') : '—'],
    ['Encontrada por', esc(j.sections?.join(', ') || 'busca em sites locais')],
    ['Coletada', esc(ago(j.first_seen_at) ?? '—')],
    ['Status desde', esc(ago(j.status_changed_at) ?? '—')],
    ['ID', `<span class="muted-id">${esc(j.id)}</span>`],
  ];
  const aiBlock = j.ai_verdict ? `
    <div class="panel-section">
      <h3>${icon('cpu')}Avaliação da IA <span class="aside">${j.ai_score != null ? `nota ${j.ai_score} · ` : ''}<span class="label ${v.cls}">${esc(v.label)}</span></span></h3>
      ${j.ai_summary ? `<p class="ai-summary">${esc(j.ai_summary)}</p>` : ''}
      ${j.ai_highlights?.length ? `<p class="ai-kicker">O que destacar</p><ul class="ai-list good">${j.ai_highlights.map((h) => `<li>${icon('check')}${esc(h)}</li>`).join('')}</ul>` : ''}
      ${j.ai_gaps?.length ? `<p class="ai-kicker">Lacunas</p><ul class="ai-list gap">${j.ai_gaps.map((g) => `<li>${icon('alert')}${esc(g)}</li>`).join('')}</ul>` : ''}
      ${j.ai_reason ? `<p class="ai-reason">Triagem: ${esc(j.ai_reason)}</p>` : ''}
    </div>` : `
    <div class="panel-section"><h3>${icon('cpu')}Avaliação da IA</h3><p class="ai-reason">Ainda não avaliada. Ela entra na próxima execução do /vagas se passar nos filtros.</p></div>`;

  panel.innerHTML = `
    <div class="panel-head">
      <div class="panel-toolbar">
        <span class="spacer"></span>
        <a class="btn btn-sm" href="${esc(j.url)}" target="_blank" rel="noopener">${icon('link-external')}Abrir anúncio</a>
        <button class="btn btn-sm btn-invisible btn-icon" type="button" data-close title="Fechar (Esc)" aria-label="Fechar">${icon('x')}</button>
      </div>
      <h2 class="panel-title">${esc(j.title)}</h2>
      <p class="panel-sub">${esc(j.company || '')} · ${esc(place(j))}</p>
      <div class="panel-actions" id="panelActions"></div>
      <div id="discardSlot"></div>
    </div>
    <div class="panel-body">
      ${aiBlock}
      <div class="panel-section"><h3>${icon('briefcase')}Detalhes</h3>
        <dl class="fields">${fields.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
      </div>
      <div class="panel-section">
        <h3>${icon('note')}Notas</h3>
        <textarea class="input" id="notes" placeholder="Ex.: falei com a recrutadora em 23/09, retorno até sexta">${esc(j.notes ?? '')}</textarea>
        <p class="field-hint" id="notesHint">Salva ao sair do campo ou com Ctrl+Enter.</p>
      </div>
      <div class="panel-section" id="reasonSection" ${j.status === 'descartada' || j.discard_reason ? '' : 'hidden'}>
        <h3>${icon('skip')}Motivo do descarte</h3>
        <input class="input" id="reason" value="${esc(j.discard_reason ?? '')}" placeholder="Ex.: body shop, stack Java, presencial longe">
        <p class="field-hint" id="reasonHint">A skill /vagas aprende com esses motivos.</p>
      </div>
      <div class="panel-section">
        <h3>${icon('issue-opened')}Descrição</h3>
        ${detail ? `<div class="description">${renderDescription(cleanDescription(detail.description))}</div>` : '<div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:80%;margin-top:8px"></div><div class="skeleton" style="width:85%;margin-top:8px"></div>'}
      </div>
    </div>`;
  updatePanelStatus(j);
  panel.scrollTop = scroll;
  if (!detail) loadDetail(S.openId);
}

function updatePanelStatus(j) {
  const s = STATUS[j.status];
  const quick = j.status === 'aplicada'
    ? '<button class="btn" type="button" data-set="entrevista"><span class="long">Marcar entrevista</span><span class="short">Entrevista</span></button>'
    : ['nova', 'interessante'].includes(j.status)
      ? '<button class="btn btn-primary" type="button" data-set="aplicada"><span class="long">Marquei que me candidatei</span><span class="short">Candidatei</span></button>'
      : '';
  $('#panelActions').innerHTML = `
    <button class="btn status-btn" type="button" data-status-menu aria-haspopup="menu"><span class="state state-${s.id}">${icon(s.icon)}</span>${s.label}${icon('triangle-down')}</button>
    ${quick}
    ${j.status !== 'descartada' ? '<button class="btn btn-danger" type="button" data-set="descartada">Descartar</button>' : ''}`;
}

async function loadDetail(id) {
  try {
    const d = await api(`/jobs/${id}`);
    S.details.set(id, d);
  } catch {
    S.details.set(id, { description: 'Não consegui carregar a descrição.' });
  }
  if (S.openId === id) { panelFor = null; renderPanel(); }
}

function openJob(id) {
  S.openId = id ? String(id) : null;
  const idx = S.visible.findIndex((j) => String(j.id) === S.openId);
  if (idx >= 0) S.cursor = idx;
  render();
}

function showDiscard(id) {
  const slot = $('#discardSlot');
  const j = S.byId.get(id);
  slot.innerHTML = `<div class="discard-box">
    <label for="discardReason">Por que descartar? <span style="font-weight:400;color:var(--fg-muted)">(opcional)</span></label>
    <input class="input" id="discardReason" value="${esc(j.discard_reason ?? '')}" placeholder="Ex.: body shop, stack Java, presencial longe">
    <div class="row-btns">
      <button class="btn btn-danger" type="button" data-confirm-discard>Descartar vaga</button>
      <button class="btn btn-invisible" type="button" data-cancel-discard>Cancelar</button>
    </div></div>`;
  $('#discardReason').focus();
}

// ---------- gravação ----------

async function setStatus(ids, status, { reason } = {}) {
  ids = ids.map(String).filter((id) => S.byId.get(id) && (S.byId.get(id).status !== status || reason != null));
  if (!ids.length) return;
  const before = ids.map((id) => {
    const j = S.byId.get(id);
    return { id, status: j.status, discard_reason: j.discard_reason, status_changed_at: j.status_changed_at, followUp: S.followUp.has(id) };
  });
  const now = new Date().toISOString();
  for (const id of ids) {
    const j = S.byId.get(id);
    if (j.status !== status) j.status_changed_at = now;
    j.status = status;
    if (reason != null) j.discard_reason = reason;
    S.followUp.delete(id);
  }
  render();
  try {
    await inChunks(ids, (id) => api(`/jobs/${id}`, { method: 'PATCH', body: { status, ...(reason != null ? { discard_reason: reason } : {}) } }));
    const label = STATUS[status].label.toLowerCase();
    toast(ids.length === 1 ? `Vaga marcada como ${label}.` : `${ids.length} vagas marcadas como ${label}.`, {
      action: 'Desfazer',
      onAction: () => undoStatus(before),
    });
  } catch (e) {
    restore(before);
    render();
    toast(`Não salvou: ${e.message}. Nada foi alterado.`, { error: true });
  }
}

function restore(before) {
  for (const b of before) {
    Object.assign(S.byId.get(b.id), { status: b.status, discard_reason: b.discard_reason, status_changed_at: b.status_changed_at });
    if (b.followUp) S.followUp.add(b.id);
  }
}

// "Marcar todas" pode mandar centenas de vagas: grava de 20 em 20 para não afogar o servidor.
async function inChunks(items, fn, size = 20) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function undoStatus(before) {
  // Só reenvia o motivo quando a alteração mexeu nele.
  const bodies = before.map((b) => ({
    id: b.id,
    body: {
      status: b.status,
      status_changed_at: b.status_changed_at ?? null,
      ...(S.byId.get(b.id).discard_reason !== b.discard_reason ? { discard_reason: b.discard_reason ?? '' } : {}),
    },
  }));
  restore(before);
  render();
  try {
    await inChunks(bodies, ({ id, body }) => api(`/jobs/${id}`, { method: 'PATCH', body }));
    toast('Alteração desfeita.');
    load({ quiet: true });
  } catch (e) {
    toast(`Não consegui desfazer: ${e.message}`, { error: true });
  }
}

async function saveField(id, field, value, hintEl) {
  const j = S.byId.get(id);
  if (!j || (j[field] ?? '') === value) return;
  hintEl.className = 'field-hint';
  hintEl.textContent = 'Salvando…';
  try {
    await api(`/jobs/${id}`, { method: 'PATCH', body: { [field]: value } });
    j[field] = value;
    hintEl.className = 'field-hint ok';
    hintEl.textContent = 'Salvo.';
  } catch (e) {
    hintEl.className = 'field-hint err';
    hintEl.textContent = `Não salvou: ${e.message}. O texto continua aqui; tente de novo.`;
  }
}

// ---------- menus ----------

let menuEl = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

function openMenu(anchor, { title, items, multi = false, onPick }) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = (title ? `<div class="menu-title">${esc(title)}</div>` : '') + items.map((it, i) => `
    <button class="menu-item" type="button" role="${multi ? 'menuitemcheckbox' : 'menuitemradio'}" aria-checked="${Boolean(it.checked)}" data-i="${i}">
      <span class="tick">${icon('check')}</span>${it.icon ? `<span class="state ${it.cls ?? ''}">${icon(it.icon)}</span>` : ''}${esc(it.label)}${it.n != null ? `<span class="n">${it.n}</span>` : ''}
    </button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  const below = r.bottom + 4;
  m.style.top = `${below + m.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - m.offsetHeight - 4) : below}px`;
  menuEl = m;
  m.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    if (multi) {
      it.checked = !it.checked;
      b.setAttribute('aria-checked', String(it.checked));
      onPick(it);
    } else {
      closeMenu();
      onPick(it);
    }
  });
  m.addEventListener('keydown', (e) => {
    const all = [...m.querySelectorAll('.menu-item')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); }
  });
  (m.querySelector('[aria-checked="true"]') ?? m.querySelector('.menu-item'))?.focus();
}

function statusMenu(anchor, ids) {
  const current = ids.length === 1 ? S.byId.get(ids[0])?.status : null;
  openMenu(anchor, {
    title: ids.length === 1 ? 'Mudar status' : `Mudar status de ${ids.length} vagas`,
    items: STATUSES.map((s) => ({ value: s.id, label: s.label, icon: s.icon, cls: `state-${s.id}`, checked: s.id === current })),
    onPick: (it) => {
      if (it.value === 'descartada' && ids.length === 1 && S.openId === ids[0]) showDiscard(ids[0]);
      else setStatus(ids, it.value);
    },
  });
}

// ---------- avisos ----------

function toast(text, { error = false, action, onAction } = {}) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'err' : ''}`;
  t.setAttribute('role', error ? 'alert' : 'status');
  t.innerHTML = `${icon(error ? 'alert' : 'check-circle')}<span class="grow">${esc(text)}</span>${action ? `<button class="btn btn-sm" type="button">${esc(action)}</button>` : ''}`;
  $('#toasts').append(t);
  const kill = () => t.remove();
  t.querySelector('button')?.addEventListener('click', () => { kill(); onAction?.(); });
  setTimeout(kill, action ? 10000 : 4000);
}

// ---------- eventos ----------

function bind() {
  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

  const q = $('#q');
  q.value = queryText();
  let qTimer;
  q.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const { filters, free } = parseQuery(q.value);
      S.filters = filters;
      S.q = free;
      S.shown = PAGE;
      S.cursor = -1;
      render();
    }, 150);
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (menuEl && !menuEl.contains(t) && !t.closest('[aria-haspopup="menu"]')) closeMenu();

    const tab = t.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; S.shown = PAGE; S.cursor = -1; S.selected.clear(); S.view = 'list'; render(); return; }

    const view = t.closest('[data-view]');
    if (view) { S.view = view.dataset.view; S.selected.clear(); render(); return; }

    const fb = t.closest('[data-filter]');
    if (fb) {
      const f = FILTERS.find((x) => x.key === fb.dataset.filter);
      const set = S.filters[f.key];
      openMenu(fb, {
        title: `Filtrar por ${f.label.toLowerCase()}`,
        items: f.options().map((o) => ({ ...o, checked: set.has(o.value) })),
        multi: true,
        onPick: (it) => { if (it.checked) set.add(it.value); else set.delete(it.value); S.shown = PAGE; render(); },
      });
      return;
    }
    const sb = t.closest('[data-sort]');
    if (sb) {
      openMenu(sb, { title: 'Ordenar por', items: SORTS.map((s) => ({ value: s.id, label: s.label, checked: s.id === S.sort })), onPick: (it) => { S.sort = it.value; render(); } });
      return;
    }
    if (t.closest('[data-clear]')) {
      e.preventDefault();
      S.filters = emptyFilters();
      S.q = '';
      q.value = '';
      render();
      return;
    }

    if (t.matches('.row-check')) {
      const id = t.closest('.row').dataset.id;
      if (t.checked) S.selected.add(id); else S.selected.delete(id);
      renderBulk();
      $('#rows').classList.toggle('selecting', S.selected.size > 0);
      return;
    }
    const row = t.closest('.row[data-id]');
    if (row) {
      e.preventDefault();
      openJob(S.openId === row.dataset.id && !t.closest('[data-open]') ? null : row.dataset.id);
      return;
    }
    const card = t.closest('.card[data-id]');
    if (card) { openJob(card.dataset.id); return; }

    if (t.closest('#more')) { S.shown += PAGE; render(); return; }
    if (t.closest('#bulkClear')) { S.selected.clear(); render(); return; }
    if (t.closest('#bulkStatus')) { statusMenu($('#bulkStatus'), [...S.selected]); return; }
    if (t.closest('#refresh')) { load(); return; }
    if (t.closest('#theme')) { toggleTheme(); return; }

    if (t.closest('[data-close]')) { openJob(null); return; }
    if (t.closest('[data-status-menu]')) { statusMenu(t.closest('[data-status-menu]'), [S.openId]); return; }
    const set = t.closest('[data-set]');
    if (set) {
      if (set.dataset.set === 'descartada') showDiscard(S.openId);
      else setStatus([S.openId], set.dataset.set);
      return;
    }
    if (t.closest('[data-confirm-discard]')) { setStatus([S.openId], 'descartada', { reason: $('#discardReason').value.trim() }); return; }
    if (t.closest('[data-cancel-discard]')) { $('#discardSlot').innerHTML = ''; }
  });

  $('#bulkAll').addEventListener('change', (e) => selectAllInTab(e.target.checked));
  $('#selectAll').addEventListener('change', (e) => { selectAllInTab(e.target.checked); e.target.checked = false; });

  const panel = $('#panel');
  panel.addEventListener('focusout', (e) => {
    if (e.target.id === 'notes') saveField(S.openId, 'notes', e.target.value, $('#notesHint'));
    if (e.target.id === 'reason') saveField(S.openId, 'discard_reason', e.target.value.trim(), $('#reasonHint'));
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'notes') saveField(S.openId, 'notes', e.target.value, $('#notesHint'));
    if (e.key === 'Enter' && e.target.id === 'reason') saveField(S.openId, 'discard_reason', e.target.value.trim(), $('#reasonHint'));
    if (e.key === 'Enter' && e.target.id === 'discardReason') setStatus([S.openId], 'descartada', { reason: e.target.value.trim() });
  });

  // Quadro: arrastar muda o status.
  const board = $('#board');
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', (e) => e.target.closest('.card')?.classList.remove('dragging'));
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    for (const c of board.querySelectorAll('.column.drop')) if (c !== col) c.classList.remove('drop');
    col.classList.add('drop');
  });
  board.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget?.closest?.('.column')) for (const c of board.querySelectorAll('.drop')) c.classList.remove('drop');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop');
    setStatus([e.dataTransfer.getData('text/plain')], col.dataset.status);
  });

  document.addEventListener('keydown', onKey);
  addEventListener('focus', () => { if (Date.now() - S.loadedAt > 60000) load({ quiet: true }); });
}

function onKey(e) {
  const typing = e.target.matches('input, textarea, select') || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (menuEl) { closeMenu(); return; }
    if (typing) { e.target.blur(); return; }
    if (S.openId) { openJob(null); return; }
    if (S.selected.size) { S.selected.clear(); render(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || menuEl) return;
  const list = S.view === 'list' ? S.visible.slice(0, S.shown) : [];
  const move = (d) => {
    if (!list.length) return;
    S.cursor = Math.max(0, Math.min(list.length - 1, S.cursor + d));
    const id = String(list[S.cursor].id);
    if (S.openId) S.openId = id;
    render();
    document.querySelector(`.row[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  switch (e.key) {
    case '/': e.preventDefault(); $('#q').focus(); break;
    case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
    case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
    case 'Enter': case 'o': if (list[S.cursor]) openJob(list[S.cursor].id); break;
    case 'x': if (list[S.cursor]) {
      const id = String(list[S.cursor].id);
      if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
      render();
    } break;
    case 's': {
      const ids = S.selected.size ? [...S.selected] : S.openId ? [S.openId] : list[S.cursor] ? [String(list[S.cursor].id)] : [];
      const anchor = S.selected.size ? $('#bulkStatus') : S.openId ? $('[data-status-menu]') : document.querySelector('.row.cursor');
      if (ids.length && anchor) statusMenu(anchor, ids);
      break;
    }
    case 'r': load(); break;
    default:
  }
}

function isDark() {
  const root = document.documentElement;
  return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function toggleTheme() {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('vagas-theme', document.documentElement.dataset.theme); } catch {}
  paintThemeIcon();
}

function paintThemeIcon() {
  $('.theme-glyph').innerHTML = icon(isDark() ? 'sun' : 'moon');
}

readUrl();
bind();
paintThemeIcon();
render();
load();
