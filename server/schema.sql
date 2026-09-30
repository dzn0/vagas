-- Executado a cada inicialização: tudo precisa ser idempotente.

create table if not exists jobs (
  id               bigint primary key,
  url              text not null,

  -- dados brutos vindos da extensão
  title            text,
  company          text,
  location         text,          -- do card, ex.: "Recife, PE (Remoto)"
  location_full    text,          -- da página pública, ex.: "Recife, Pernambuco, Brazil"
  card_text        text,          -- texto completo do card (datas, "Visto", "Candidatura simplificada"…)
  description      text,
  criteria         jsonb not null default '{}',
  posted_text      text,
  applicants_text  text,
  salary_text      text,
  sections         text[] not null default '{}',
  detail_status    text not null default 'pending',

  -- campos derivados (enrich.js), recalculáveis a qualquer momento
  workplace        text,          -- remoto | hibrido | presencial
  city             text,
  state            text,          -- UF
  seniority        text,          -- estagio | aprendiz | trainee | junior | pleno | pleno_senior | senior | lead
  posted_at        timestamptz,
  applicants       int,
  few_applicants   boolean not null default false,
  easy_apply       boolean not null default false,
  verified         boolean not null default false,
  viewed           boolean not null default false,
  techs            text[] not null default '{}',
  years_min        int,
  contract         text[] not null default '{}',
  language         text,          -- pt | en
  english_required boolean not null default false,
  salary_min       numeric,
  salary_max       numeric,
  pcd_only         boolean not null default false,
  talent_pool      boolean not null default false,
  recruiter        boolean not null default false,
  dup_key          text,
  pre_score        int not null default 0,

  -- acompanhamento
  status           text not null default 'nova'
                   check (status in ('nova', 'interessante', 'descartada', 'aplicada', 'entrevista', 'encerrada')),
  discard_reason   text,
  notes            text,

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  enriched_at      timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists jobs_status_idx    on jobs (status);
create index if not exists jobs_seniority_idx on jobs (seniority);
create index if not exists jobs_posted_idx    on jobs (posted_at desc);
create index if not exists jobs_score_idx     on jobs (pre_score desc);
create index if not exists jobs_dup_idx       on jobs (dup_key);
create index if not exists jobs_techs_idx     on jobs using gin (techs);

-- ---------- avaliação por IA (skill /vagas) ----------
-- ai_profile_hash guarda a versão do perfil usada: mudou o perfil, a vaga volta a ficar pendente.
alter table jobs add column if not exists ai_stage        text;   -- triagem | avaliada
alter table jobs add column if not exists ai_verdict      text;   -- descartar | avaliar | forte
alter table jobs add column if not exists ai_score        int;
alter table jobs add column if not exists ai_reason       text;
alter table jobs add column if not exists ai_summary      text;
alter table jobs add column if not exists ai_gaps         text[] not null default '{}';
alter table jobs add column if not exists ai_highlights   text[] not null default '{}';
alter table jobs add column if not exists ai_profile_hash text;
alter table jobs add column if not exists ai_evaluated_at timestamptz;
create index if not exists jobs_ai_idx on jobs (ai_profile_hash, ai_stage, ai_verdict);

create table if not exists profile (
  id          int primary key default 1 check (id = 1),
  source_hash text,                               -- hash do site + PDF do currículo
  data        jsonb not null default '{}',        -- perfil estruturado extraído pela IA
  preferences jsonb not null default '{}',        -- respostas e regras do usuário
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);

-- ---------- data da última mudança de status (só o André muda) ----------
-- updated_at também muda em coleta e avaliação da IA; a cobrança de retorno usa esta coluna.
alter table jobs add column if not exists status_changed_at timestamptz;
update jobs set status_changed_at = updated_at where status_changed_at is null and status <> 'nova';
