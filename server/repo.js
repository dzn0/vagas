import { createHash } from 'node:crypto';
import { enrich } from './enrich.js';

const RAW_FIELDS = [
  'url', 'title', 'company', 'location', 'location_full', 'card_text', 'description',
  'posted_text', 'applicants_text', 'salary_text',
];
const DERIVED_FIELDS = [
  'workplace', 'city', 'state', 'seniority', 'posted_at', 'applicants', 'few_applicants', 'easy_apply',
  'verified', 'viewed', 'techs', 'years_min', 'contract', 'language', 'english_required', 'salary_min',
  'salary_max', 'pcd_only', 'talent_pool', 'recruiter', 'dup_key', 'pre_score',
];
export const STATUSES = ['nova', 'interessante', 'descartada', 'aplicada', 'entrevista', 'encerrada'];

const filled = (v) => v != null && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

// Campo novo só substitui o antigo quando vem preenchido: uma coleta sem descrição
// não apaga a descrição já salva.
function merge(current, incoming) {
  const job = { id: String(incoming.id) };
  for (const f of RAW_FIELDS) job[f] = filled(incoming[f]) ? incoming[f] : current?.[f] ?? null;
  job.url ||= `https://www.linkedin.com/jobs/view/${job.id}/`;
  job.criteria = filled(incoming.criteria) ? incoming.criteria : current?.criteria ?? {};
  job.sections = [...new Set([...(current?.sections ?? []), ...(incoming.sections ?? [])])];
  job.detail_status = current?.detail_status === 'ok' && incoming.detail_status !== 'ok'
    ? 'ok'
    : incoming.detail_status || current?.detail_status || 'pending';
  return job;
}

const COLUMNS = ['id', ...RAW_FIELDS, 'criteria', 'sections', 'detail_status', ...DERIVED_FIELDS];
const UPSERT_SQL = `
  insert into jobs (${COLUMNS.join(', ')}, enriched_at, last_seen_at, updated_at)
  values (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}, now(), now(), now())
  on conflict (id) do update set
    ${COLUMNS.slice(1).map((c) => `${c} = excluded.${c}`).join(',\n    ')},
    enriched_at = now(), last_seen_at = now(), updated_at = now()
  returning (xmax = 0) as inserted`;

function rowValues(job, derived) {
  const all = { ...job, ...derived, criteria: JSON.stringify(job.criteria) };
  return COLUMNS.map((c) => all[c]);
}

export async function upsertJobs(pool, incoming) {
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query('begin');
    for (const item of incoming) {
      if (!/^\d+$/.test(String(item?.id ?? ''))) continue;
      const { rows: [current] } = await client.query('select * from jobs where id = $1 for update', [item.id]);
      const job = merge(current, item);
      const derived = enrich(job, { previousPostedAt: current?.posted_at ?? null });
      const { rows: [r] } = await client.query(UPSERT_SQL, rowValues(job, derived));
      if (r.inserted) inserted++; else updated++;
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { inserted, updated };
}

export async function reenrichAll(pool) {
  const { rows } = await pool.query('select * from jobs');
  for (const job of rows) {
    const derived = enrich(job, { previousPostedAt: job.posted_at });
    await pool.query(UPSERT_SQL, rowValues(job, derived));
  }
  return { reenriched: rows.length };
}

// `status_changed_at` só vem no corpo quando a página desfaz uma mudança: aí o relógio da
// cobrança volta ao valor anterior (pode ser null) em vez de recomeçar.
export async function updateTracking(pool, id, { status, discard_reason, notes, ...rest }) {
  if (status != null && !STATUSES.includes(status)) throw Object.assign(new Error(`status inválido: ${status}`), { http: 400 });
  const restore = Object.hasOwn(rest, 'status_changed_at');
  const { rows } = await pool.query(
    `update jobs set
       status_changed_at = case
         when $5 then $6::timestamptz
         when $2::text is not null and $2::text <> status then now()
         else status_changed_at end,
       status = coalesce($2, status),
       discard_reason = coalesce($3, discard_reason),
       notes = coalesce($4, notes),
       updated_at = now()
     where id = $1
     returning id, status, discard_reason, notes, status_changed_at`,
    [id, status ?? null, discard_reason ?? null, notes ?? null, restore, restore ? rest.status_changed_at : null],
  );
  return rows[0] ?? null;
}

const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
const bool = (v) => (v == null ? null : ['1', 'true', 'sim'].includes(String(v).toLowerCase()));

const TRIAGE_DEFAULTS = {
  status: 'nova,interessante',
  exclude_seniority: 'pleno,pleno_senior,senior,lead',
  pcd_only: '0',
  max_age_days: '7',
  hide_dups: '1',
};

// Filtros aceitos (query string): status, seniority, exclude_seniority, workplace, state, techs (qualquer uma),
// max_age_days, max_years, easy_apply, pcd_only, talent_pool, english_required, min_score, q, hide_dups, limit, full.
export async function queryJobs(pool, params, { triage = false } = {}) {
  const p = triage ? { ...TRIAGE_DEFAULTS, ...params } : params;
  const where = [];
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };

  if (list(p.status)) where.push(`status = any(${arg(list(p.status))})`);
  if (list(p.seniority)) where.push(`seniority = any(${arg(list(p.seniority))})`);
  if (list(p.exclude_seniority)) where.push(`(seniority is null or seniority <> all(${arg(list(p.exclude_seniority))}))`);
  if (list(p.workplace)) where.push(`workplace = any(${arg(list(p.workplace))})`);
  if (list(p.state)) where.push(`state = any(${arg(list(p.state))})`);
  if (list(p.techs)) where.push(`techs && ${arg(list(p.techs))}`);
  if (p.max_age_days) where.push(`(posted_at is null or posted_at >= now() - make_interval(days => ${arg(Number(p.max_age_days))}))`);
  if (p.max_years) where.push(`(years_min is null or years_min <= ${arg(Number(p.max_years))})`);
  if (p.min_score) where.push(`pre_score >= ${arg(Number(p.min_score))}`);
  for (const flag of ['easy_apply', 'pcd_only', 'talent_pool', 'english_required', 'recruiter']) {
    if (bool(p[flag]) != null) where.push(`${flag} = ${arg(bool(p[flag]))}`);
  }
  if (p.q) {
    const q = arg(`%${p.q}%`);
    where.push(`(title ilike ${q} or company ilike ${q} or description ilike ${q})`);
  }
  // "Mid-Senior" é o nível padrão do LinkedIn: só descarta quando os anos exigidos confirmam.
  if (p.pleno_senior_max_years) {
    where.push(`not (seniority = 'pleno_senior' and coalesce(years_min, 0) > ${arg(Number(p.pleno_senior_max_years))})`);
  }
  if (list(p.ids)) where.push(`id = any(${arg(list(p.ids))}::bigint[])`);
  if (p.detail_status) where.push(`detail_status = ${arg(p.detail_status)}`);
  if (list(p.exclude_companies)) where.push(`lower(company) <> all(${arg(list(p.exclude_companies).map((c) => c.toLowerCase()))})`);
  // Vagas ainda não analisadas pela IA com esta versão do perfil.
  if (p.ai_pending) where.push(`ai_profile_hash is distinct from ${arg(p.ai_pending)}`);
  if (p.ai_profile) where.push(`ai_profile_hash = ${arg(p.ai_profile)}`);
  if (list(p.ai_stage)) where.push(`ai_stage = any(${arg(list(p.ai_stage))})`);
  if (list(p.ai_verdict)) where.push(`ai_verdict = any(${arg(list(p.ai_verdict))})`);

  const cols = bool(p.full)
    ? '*'
    : 'id, url, title, company, location, city, state, workplace, seniority, posted_at, applicants, few_applicants, ' +
      'easy_apply, verified, viewed, techs, years_min, contract, language, english_required, salary_min, salary_max, ' +
      'pcd_only, talent_pool, recruiter, pre_score, status, sections, detail_status, dup_key, updated_at, ' +
      'ai_stage, ai_verdict, ai_score, ai_reason, ai_summary, ai_gaps, ai_highlights, ' +
      'notes, discard_reason, first_seen_at, salary_text, status_changed_at';
  const limit = arg(Math.min(Number(p.limit) || 200, 2000));
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const order = p.order === 'ai'
    ? 'order by ai_score desc nulls last, pre_score desc'
    : 'order by pre_score desc, posted_at desc nulls last';

  const sql = bool(p.hide_dups)
    ? `select * from (
         select distinct on (coalesce(dup_key, id::text)) ${cols},
                count(*) over (partition by coalesce(dup_key, id::text)) as dup_count
         from jobs ${whereSql}
         order by coalesce(dup_key, id::text), pre_score desc, posted_at desc nulls last
       ) t ${order} limit ${limit}`
    : `select ${cols} from jobs ${whereSql} ${order} limit ${limit}`;
  const { rows } = await pool.query(sql, args);
  return rows;
}

// ---------- perfil e avaliações da IA ----------

const stableJson = (v) => JSON.stringify(v, (k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((key) => [key, val[key]]))
    : val);

// A versão muda só quando o perfil estruturado ou as preferências mudam de fato,
// não a cada ajuste de layout no site.
// Preferências que só filtram via SQL (ou são metadados) ficam fora da versão: adicionar uma
// empresa bloqueada não deve mandar centenas de vagas de volta para a triagem.
const PREFS_OUTSIDE_VERSION = ['empresas_bloqueadas', 'hard_filters', 'site_url', 'regras', 'busca', 'contato'];

export function profileVersion(row) {
  const prefs = Object.fromEntries(Object.entries(row.preferences ?? {}).filter(([k]) => !PREFS_OUTSIDE_VERSION.includes(k)));
  return createHash('sha256').update(stableJson({ d: row.data ?? {}, p: prefs })).digest('hex').slice(0, 16);
}

export async function getProfile(pool) {
  const { rows: [row] } = await pool.query('select * from profile where id = 1');
  if (!row) return { exists: false, source_hash: null, data: {}, preferences: {}, version: null };
  return { exists: true, ...row, version: profileVersion(row) };
}

export async function saveProfile(pool, { source_hash, data, preferences }) {
  await pool.query(
    `insert into profile (id, source_hash, data, preferences, fetched_at, updated_at)
     values (1, $1, coalesce($2::jsonb, '{}'), coalesce($3::jsonb, '{}'), case when $1::text is null then null else now() end, now())
     on conflict (id) do update set
       source_hash = coalesce(excluded.source_hash, profile.source_hash),
       data        = coalesce($2::jsonb, profile.data),
       preferences = coalesce($3::jsonb, profile.preferences),
       fetched_at  = coalesce(excluded.fetched_at, profile.fetched_at),
       updated_at  = now()`,
    [source_hash ?? null, data ? JSON.stringify(data) : null, preferences ? JSON.stringify(preferences) : null],
  );
  return getProfile(pool);
}

const AI_STAGES = ['triagem', 'avaliada'];
const AI_VERDICTS = ['descartar', 'avaliar', 'forte'];

// A decisão vale para todas as cópias da mesma vaga (mesmo dup_key).
export async function saveAiResults(pool, items, version) {
  if (!version) throw Object.assign(new Error('perfil ainda não salvo'), { http: 400 });
  // Valida o lote inteiro antes de gravar qualquer item.
  for (const it of items) {
    if (!/^\d+$/.test(String(it.id ?? ''))) throw Object.assign(new Error(`id inválido: ${it.id}`), { http: 400 });
    if (!AI_STAGES.includes(it.stage)) throw Object.assign(new Error(`stage inválido em ${it.id}: ${it.stage}`), { http: 400 });
    if (!AI_VERDICTS.includes(it.verdict)) throw Object.assign(new Error(`verdict inválido em ${it.id}: ${it.verdict}`), { http: 400 });
  }
  let updated = 0;
  for (const it of items) {
    const { rowCount } = await pool.query(
      `update jobs set
         ai_stage = $2, ai_verdict = $3, ai_score = $4, ai_reason = $5, ai_summary = $6,
         ai_gaps = $7, ai_highlights = $8, ai_profile_hash = $9, ai_evaluated_at = now(), updated_at = now()
       where id = $1 or dup_key = (select dup_key from jobs where id = $1)`,
      [it.id, it.stage, it.verdict, it.score ?? null, it.reason ?? null, it.summary ?? null,
        it.gaps ?? [], it.highlights ?? [], version],
    );
    updated += rowCount;
  }
  return { updated };
}

export async function pipeline(pool) {
  const { rows: byStatus } = await pool.query('select status, count(*)::int n from jobs group by 1 order by 2 desc');
  const { rows: followUp } = await pool.query(`
    select id, title, company, url, status, coalesce(status_changed_at, updated_at) as updated_at from jobs
    where status in ('aplicada', 'entrevista') and coalesce(status_changed_at, updated_at) < now() - interval '7 days'
    order by 6`);
  return { byStatus, followUp };
}

export async function getJob(pool, id) {
  const { rows } = await pool.query('select * from jobs where id = $1', [id]);
  return rows[0] ?? null;
}

export async function stats(pool) {
  const { rows: [r] } = await pool.query(`
    select count(*)::int as total,
           count(*) filter (where detail_status = 'ok')::int as com_descricao,
           count(*) filter (where status = 'nova')::int as novas,
           count(*) filter (where status = 'interessante')::int as interessantes,
           count(*) filter (where status = 'aplicada')::int as aplicadas,
           count(distinct coalesce(dup_key, id::text))::int as sem_duplicatas,
           max(last_seen_at) as ultima_coleta
    from jobs`);
  return r;
}

const SENIORITY_LABEL = {
  estagio: 'estágio', aprendiz: 'aprendiz', trainee: 'trainee', junior: 'júnior',
  pleno: 'pleno', pleno_senior: 'pleno/sênior', senior: 'sênior', lead: 'lead',
};

// Uma linha por vaga: o mínimo para uma IA escolher quais merecem leitura completa.
export function toCompactText(rows, now = new Date()) {
  const lines = rows.map((j) => {
    const age = j.posted_at ? `${Math.max(0, Math.floor((now - new Date(j.posted_at)) / 864e5))}d` : '?d';
    const place = [j.city && j.state ? `${j.city}/${j.state}` : j.city || j.state || 'Brasil', j.workplace].filter(Boolean).join(' · ');
    const applicants = j.few_applicants ? 'poucos candidatos' : j.applicants != null ? `${j.applicants} candidatos` : null;
    const salary = j.salary_min ? `R$${Number(j.salary_min)}${j.salary_max ? `-${Number(j.salary_max)}` : ''}` : null;
    const flags = [
      j.easy_apply && 'simplificada', j.english_required && 'inglês', j.years_min && `${j.years_min}+ anos`,
      j.recruiter && 'recrutadora', j.talent_pool && 'banco de talentos', j.dup_count > 1 && `${j.dup_count} cópias`,
      ...(j.contract ?? []),
    ].filter(Boolean);
    return [
      j.id, j.pre_score, `${j.title} — ${j.company}`, place, SENIORITY_LABEL[j.seniority] ?? 'nível ?', age,
      applicants, salary, (j.techs ?? []).join(', ') || null, flags.join(', ') || null,
    ].filter((v) => v != null && v !== '').join(' | ');
  });
  return [
    `# ${rows.length} vagas (id | pontuação | vaga — empresa | local | nível | idade | candidatos | salário | techs | sinais)`,
    ...lines,
  ].join('\n');
}

export async function knownIds(pool, ids) {
  const valid = ids.map(String).filter((id) => /^\d+$/.test(id));
  if (!valid.length) return [];
  const { rows } = await pool.query('select id::text from jobs where id = any($1::bigint[])', [valid]);
  return rows.map((r) => r.id);
}
