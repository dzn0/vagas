// Extração determinística (sem IA) de campos úteis para triagem.
// Tudo aqui trabalha sobre texto "normalizado": minúsculo e sem acentos.

export const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const UF_BY_NAME = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'federal district': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
const COUNTRY_WORDS = /^(brasil|brazil|latin america|america latina|latam)$/;
// Para "São Paulo, Brazil" / "Greater Curitiba", que não trazem UF.
const UF_BY_CITY = {
  'sao paulo': 'SP', campinas: 'SP', 'rio de janeiro': 'RJ', 'belo horizonte': 'MG', curitiba: 'PR',
  'porto alegre': 'RS', florianopolis: 'SC', recife: 'PE', salvador: 'BA', fortaleza: 'CE', brasilia: 'DF',
  goiania: 'GO', manaus: 'AM', belem: 'PA', vitoria: 'ES', natal: 'RN', 'joao pessoa': 'PB', maceio: 'AL',
  aracaju: 'SE', teresina: 'PI', 'sao luis': 'MA', 'campo grande': 'MS', cuiaba: 'MT', 'porto velho': 'RO',
  palmas: 'TO', 'boa vista': 'RR', macapa: 'AP', 'rio branco': 'AC',
};

export function parseLocation(location, locationFull) {
  const out = { city: null, state: null };
  for (const raw of [location, locationFull]) {
    if (!raw) continue;
    const parts = raw.replace(/\(.*?\)/g, '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    if (!out.city) {
      const city = parts[0]
        .replace(/\s+e regi[aã]o$/i, '')
        .replace(/^greater\s+/i, '')
        .replace(/\s+(metropolitan\s+)?area$/i, '')
        .trim();
      if (!COUNTRY_WORDS.test(norm(city))) out.city = city;
    }
    if (!out.state && parts[1]) {
      if (/^[A-Z]{2}$/.test(parts[1])) out.state = parts[1];
      else out.state = UF_BY_NAME[norm(parts[1])] || null;
    }
  }
  if (out.city && !out.state) out.state = UF_BY_CITY[norm(out.city)] || null;
  return out;
}

export function parseWorkplace({ location, card_text: card, title, description }) {
  const paren = norm(`${location ?? ''} ${card ?? ''}`).match(/\((remoto|remote|hibrido|hybrid|presencial|on-site)\)/);
  const map = { remoto: 'remoto', remote: 'remoto', hibrido: 'hibrido', hybrid: 'hibrido', presencial: 'presencial', 'on-site': 'presencial' };
  if (paren) return map[paren[1]];
  for (const text of [title, description]) {
    const t = norm(text);
    if (/\bhibrid|\bhybrid\b/.test(t)) return 'hibrido';
    if (/100% remot|totalmente remot|trabalho remoto|home office|fully remote|\bremote\b|\bremoto\b/.test(t)) return 'remoto';
    if (/\bpresencial\b|\bon-?site\b/.test(t)) return 'presencial';
  }
  return null;
}

const TITLE_SENIORITY = [
  ['estagio', /\bestagi|\bintern(ship)?\b/],
  ['aprendiz', /\baprendiz|\bapprentice/],
  ['trainee', /\btrainee\b/],
  ['lead', /\b(tech ?lead|lider|lead|principal|staff|head|coordenador|gerente|manager|arquitet\w*|architect)\b/],
  ['senior', /\b(senior|sr|iii|especialista)\b/],
  ['pleno', /\b(pleno|pl(?! sql)|mid|middle|mid-level|ii)\b/],
  ['junior', /\b(junior|jr|early career|entry level|entry-level)\b|\si$/],
];

// "Nível de experiência" do LinkedIn (a página pública costuma vir em inglês).
const CRITERIA_SENIORITY = [
  ['estagio', /internship|estagio/],
  ['junior', /entry level|associate|assistente|junior/],
  ['pleno_senior', /mid-senior|pleno-senior/],
  ['lead', /director|executive|diretor|executivo/],
];

export function parseSeniority({ title, criteria }, yearsMin) {
  const t = ` ${norm(title).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim()}`;
  for (const [level, re] of TITLE_SENIORITY) if (re.test(t)) return level;
  for (const [key, value] of Object.entries(criteria || {})) {
    if (!/seniority|nivel|experience level/.test(norm(key))) continue;
    for (const [level, re] of CRITERIA_SENIORITY) if (re.test(norm(value))) return level;
  }
  if (yearsMin >= 5) return 'senior';
  if (yearsMin >= 3) return 'pleno';
  return null;
}

const UNIT_MS = {
  minuto: 6e4, minute: 6e4, hora: 36e5, hour: 36e5, dia: 864e5, day: 864e5,
  semana: 6048e5, week: 6048e5, mes: 2592e6, month: 2592e6,
};

export function parsePostedAt(text, ref = new Date()) {
  const t = norm(text);
  const m = t.match(/\bha (\d+) (minuto|hora|dia|semana|mes)|(\d+) (minute|hour|day|week|month)s? ago/);
  if (m) {
    const n = Number(m[1] ?? m[3]);
    return new Date(ref.getTime() - n * UNIT_MS[m[2] ?? m[4]]);
  }
  if (/\bagora\b|just now|moments ago/.test(t)) return ref;
  return null;
}

const FEW = /seja uma das primeiras|be among the first/;
const COUNT = /(?:mais de|over)\s+(\d+)\s+(?:candidat|applicant)|(\d+)\s+(?:candidat|applicant|pessoas clicaram|people clicked)/;

// `detailText` (página da vaga, lida depois) tem prioridade sobre o card, que fica desatualizado.
export function parseApplicants(detailText, cardText = '') {
  for (const raw of [detailText, cardText]) {
    const t = norm(raw);
    if (FEW.test(t)) return { applicants: null, few: true }; // "Be among the first 25 applicants" não é uma contagem
    const m = t.match(COUNT);
    if (m) {
      const applicants = Number(m[1] ?? m[2]);
      return { applicants, few: applicants <= 25 };
    }
  }
  return { applicants: null, few: false };
}

const TECHS = [
  ['JavaScript', /\bjavascript\b/], ['TypeScript', /\btypescript\b/],
  ['React Native', /\breact[ -]?native\b/], ['React', /\breact(\.?js)?\b(?![ -]?native)/],
  ['Next.js', /\bnext\.?js\b/], ['Vue', /\bvue(\.?js)?\b/], ['Angular', /\bangular(js)?\b/], ['Svelte', /\bsvelte/],
  ['HTML', /\bhtml5?\b/], ['CSS', /\bcss3?\b/], ['Tailwind', /\btailwind/], ['Sass', /\bsass\b|\bscss\b/],
  ['Node.js', /\bnode(\.?js)?\b/], ['NestJS', /\bnest\.?js\b/], ['Express', /\bexpress(\.?js)?\b/],
  ['Python', /\bpython\b/], ['Django', /\bdjango\b/], ['Flask', /\bflask\b/], ['FastAPI', /\bfastapi\b/],
  ['Java', /\bjava\b/], ['Spring', /\bspring( ?boot)?\b/], ['Kotlin', /\bkotlin\b/],
  ['C#', /(^|[^\w])c#/], ['.NET', /(^|[^\w])\.net\b|\bdotnet\b|\basp\.net\b/],
  ['PHP', /\bphp\b/], ['Laravel', /\blaravel\b/], ['Ruby', /\bruby\b/], ['Rails', /\brails\b/],
  ['Go', /\bgolang\b/], ['Rust', /\brust\b/], ['Swift', /\bswift\b/], ['Flutter', /\bflutter\b/], ['Dart', /\bdart\b/],
  ['SQL', /\bsql\b/], ['PostgreSQL', /\bpostgres(ql)?\b/], ['MySQL', /\bmysql\b/], ['SQL Server', /\bsql server\b/],
  ['MongoDB', /\bmongo(db)?\b/], ['Redis', /\bredis\b/], ['GraphQL', /\bgraphql\b/],
  ['REST', /\brest(ful)?\b/], ['Microsserviços', /\bmicro-?servi/],
  ['Docker', /\bdocker\b/], ['Kubernetes', /\bkubernetes\b|\bk8s\b/],
  ['AWS', /\baws\b|amazon web services/], ['Azure', /\bazure\b/], ['GCP', /\bgcp\b|google cloud/],
  ['Git', /\bgit\b|\bgithub\b|\bgitlab\b/], ['CI/CD', /\bci\s*\/\s*cd\b/], ['Linux', /\blinux\b/],
  ['Jest', /\bjest\b/], ['Cypress', /\bcypress\b/],
];

export function parseTechs({ title, description }) {
  const t = norm(`${title ?? ''}\n${description ?? ''}`);
  return TECHS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

export function parseYearsMin(description) {
  const t = norm(description);
  const years = [];
  const patterns = [
    /(\d{1,2})\s*\+?\s*(?:anos?|years?)(?:\s+\S+){0,4}?\s+(?:de\s+)?(?:experiencia|experience)/g,
    /(?:experiencia|experience)[^.\n]{0,40}?(\d{1,2})\s*\+?\s*(?:anos?|years?)/g,
  ];
  for (const re of patterns) for (const m of t.matchAll(re)) years.push(Number(m[1]));
  const valid = years.filter((n) => n > 0 && n <= 15);
  return valid.length ? Math.min(...valid) : null;
}

export function parseContract({ title, description, criteria }) {
  const t = norm(`${title ?? ''}\n${description ?? ''}`);
  const crit = norm(Object.values(criteria || {}).join(' '));
  const out = new Set();
  if (/\bclt\b/.test(t)) out.add('CLT');
  if (/\bpj\b|pessoa juridica/.test(t)) out.add('PJ');
  if (/\bestagi/.test(norm(title)) || /internship|estagio/.test(crit)) out.add('Estágio');
  if (/\baprendiz\b/.test(t)) out.add('Aprendiz');
  if (/temporari|temporary/.test(t + crit)) out.add('Temporário');
  if (/\bfreela|freelanc/.test(t)) out.add('Freelancer');
  if (/\bcontract\b|contrato por projeto/.test(crit)) out.add('Contrato');
  return [...out];
}

export function detectLanguage(description) {
  const t = ` ${String(description ?? '').toLowerCase()} `;
  const count = (words) => words.reduce((n, w) => n + (t.split(` ${w} `).length - 1), 0);
  const pt = count(['de', 'que', 'para', 'com', 'uma', 'você', 'não', 'experiência', 'conhecimento']);
  const en = count(['the', 'and', 'with', 'you', 'for', 'experience', 'we', 'our', 'will']);
  if (pt + en < 5) return null;
  return en > pt ? 'en' : 'pt';
}

export function parseEnglishRequired(description, language) {
  if (language === 'en') return true;
  return /ingles (avancado|fluente|intermediario|tecnico)|fluencia em ingles|ingles fluente|english (fluent|advanced|proficien|intermediate)|(fluent|advanced|good|strong) english/
    .test(norm(description));
}

const toNumber = (s) => Number(s.replace(/\./g, '').replace(',', '.'));

export function parseSalary({ salary_text: salaryText, description }) {
  let scope = salaryText || '';
  if (!scope) {
    const m = norm(description).match(/(salario|remuneracao|faixa salarial|bolsa)[^\n]{0,80}/);
    scope = m ? m[0] : '';
  }
  const m = norm(scope).match(/r\$\s*([\d.]+(?:,\d{1,2})?)(?:\s*(?:a|-|–|ate|to)\s*(?:r\$)?\s*([\d.]+(?:,\d{1,2})?))?/);
  if (!m) return { min: null, max: null };
  const min = toNumber(m[1]);
  const max = m[2] ? toNumber(m[2]) : null;
  if (!(min >= 300)) return { min: null, max: null };
  return { min, max };
}

// Empresas que republicam vagas de terceiros ou funcionam como marketplace.
const RECRUITERS = [
  'jobgether', 'turing', 'crossing hurdles', 'micro1', 'toptal', 'remotebase', 'andela', 'revelo',
  'bebee', 'jooble', 'talent.com', 'hays', 'michael page', 'robert half', 'randstad', 'adecco',
  'manpower', 'luandre', 'jobbol', 'confidencial', 'confidential', 'wellfound', 'braintrust',
];

export function parseFlags({ title, company, description, card_text: card }) {
  const t = norm(title);
  const d = norm(description);
  const c = norm(company);
  const cardNorm = norm(card);
  return {
    pcd_only: /\bpcd\b|pessoas? com deficiencia|people with disabilit|\bpwd\b/.test(t)
      || /(exclusiva|exclusivamente|afirmativa)[^.\n]{0,40}(pcd|pessoas com deficiencia)/.test(d),
    talent_pool: /banco de talentos|talent pool|cadastro reserva/.test(t),
    // Singular de propósito: "for our clients" é a empresa falando dos próprios clientes.
    recruiter: RECRUITERS.some((r) => c.includes(r))
      || /(para|pelo|junto ao) nosso cliente\b(?!s)|empresa cliente|cliente confidencial|(for|on behalf of) (our|a) client\b(?!s)/.test(d),
    easy_apply: /candidatura simplificada|easy apply/.test(cardNorm),
    verified: /vaga verificada|verified/.test(cardNorm),
    viewed: /(^|\n)\s*(visto|viewed)\s*($|\n)/.test(cardNorm),
  };
}

export function dupKey({ title, company }) {
  // Parênteses só são descartados quando falam de local/modalidade: "(Remote, Porto Alegre)" some,
  // mas "(.NET + Angular)" e "(Python)" distinguem vagas diferentes.
  const cleanTitle = norm(title)
    .replace(/\(([^)]*)\)/g, (m, inner) => (/remot|hibrid|hybrid|presencial|on-?site|verificada|,/.test(inner) ? ' ' : m))
    .replace(/vaga verificada|with verification/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${cleanTitle}|${norm(company).replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

const DAY = 864e5;

export function preScore(job, now = new Date()) {
  let score = 50;
  if (job.posted_at) {
    const age = (now - new Date(job.posted_at)) / DAY;
    score += age <= 1 ? 20 : age <= 3 ? 12 : age <= 7 ? 5 : age > 21 ? -15 : 0;
  }
  if (job.few_applicants) score += 10;
  if (job.applicants >= 100) score -= 10;
  if (job.easy_apply) score += 5;
  if (job.verified) score += 3;
  if (job.viewed) score -= 3;
  if (['estagio', 'trainee', 'junior'].includes(job.seniority)) score += 10;
  if (['pleno', 'pleno_senior'].includes(job.seniority)) score -= 15;
  if (['senior', 'lead'].includes(job.seniority)) score -= 40;
  if (job.years_min >= 3) score -= 10;
  if (job.pcd_only) score -= 40;
  if (job.talent_pool) score -= 15;
  if (job.recruiter) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Recebe a vaga já mesclada (bruta) e devolve só os campos derivados.
export function enrich(job, { now = new Date(), previousPostedAt = null } = {}) {
  const { city, state } = parseLocation(job.location, job.location_full);
  const years_min = parseYearsMin(job.description);
  const language = detectLanguage(job.description);
  const { applicants, few } = parseApplicants(job.applicants_text, job.card_text);
  const salary = parseSalary(job);
  const derived = {
    workplace: parseWorkplace(job),
    city,
    state,
    seniority: parseSeniority(job, years_min),
    // Datas relativas ("há 2 dias") perdem precisão com o tempo: a primeira leitura vale.
    posted_at: previousPostedAt
      ?? parsePostedAt(job.card_text, now)
      ?? parsePostedAt(job.posted_text, now),
    applicants,
    few_applicants: few,
    techs: parseTechs(job),
    years_min,
    contract: parseContract(job),
    language,
    english_required: parseEnglishRequired(job.description, language),
    salary_min: salary.min,
    salary_max: salary.max,
    ...parseFlags(job),
    dup_key: dupKey(job),
  };
  derived.pre_score = preScore(derived, now);
  return derived;
}
