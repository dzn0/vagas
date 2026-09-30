import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dupKey, enrich, parseApplicants, parseContract, parseFlags, parseLocation, parsePostedAt, parseSalary,
  parseSeniority, parseTechs, parseWorkplace, parseYearsMin,
} from './enrich.js';

const NOW = new Date('2026-09-17T12:00:00Z');

// Textos de cards reais da busca nova do LinkedIn.
const cards = {
  bairesRecife: {
    title: 'Desenvolvedor Node.js - Trabalho Remoto', company: 'BairesDev', location: 'Recife, PE (Remoto)',
    card_text: 'Desenvolvedor Node.js - Trabalho Remoto (Vaga verificada)\nBairesDev\nRecife, PE (Remoto)\n4 ex-alunos da instituição trabalham aqui\nVisto\n·\nSeja uma das primeiras pessoas a se candidatar\n·\nAnunciada há 16 horas',
  },
  bairesCuritiba: {
    title: 'Desenvolvedor Node.js - Trabalho Remoto', company: 'BairesDev', location: 'Curitiba e Região (Remoto)',
    card_text: 'Desenvolvedor Node.js - Trabalho Remoto\nBairesDev\nCuritiba e Região (Remoto)\nAnunciada há 16 horas',
  },
  jobgether: {
    title: 'Desenvolvedor .NET/ Angular - Júnior', company: 'Jobgether', location: 'Brasil (Remoto)',
    card_text: 'Desenvolvedor .NET/ Angular - Júnior\nJobgether\nBrasil (Remoto)\nAnunciada há 3 dias\n·\nCandidatura simplificada',
  },
  google: {
    title: 'Early Career Software Engineer, People with Disabilities', company: 'Google', location: 'Belo Horizonte, MG (Presencial)',
    card_text: 'Anunciada há 3 dias',
  },
  farmarcas: { title: 'DESENVOLVEDOR FULL STACK PL', company: 'Farmarcas', location: 'São Paulo, SP (Presencial)' },
  flex: { title: 'Analista de Desenvolvimento de Software II', company: 'Flex', location: 'Sorocaba, SP (Presencial)' },
  ey: { title: 'Banco de Talentos - Desenvolvedor (a) Front-end - Pleno', company: 'EY', location: 'Rio de Janeiro, RJ (Presencial)' },
  aprendiz: { title: 'JOVEM APRENDIZ - TÉCNOLOGIA DA INFORMAÇÃO', company: 'S.Magalhães & Essemaga', location: 'Santos, SP (Presencial)' },
  middle: { title: 'Middle Frontend Developer', company: 'Jobgether', location: 'Brasil (Remoto)' },
  atoms: { title: 'Software Engineer', company: 'Atoms', location: 'São Paulo, SP (Presencial)' },
};

test('local: cidade e UF do card e da página pública', () => {
  assert.deepEqual(parseLocation('Recife, PE (Remoto)'), { city: 'Recife', state: 'PE' });
  assert.deepEqual(parseLocation('Curitiba e Região (Remoto)'), { city: 'Curitiba', state: 'PR' });
  assert.deepEqual(parseLocation('Sorocaba e Região'), { city: 'Sorocaba', state: null });
  assert.deepEqual(parseLocation('Brasil (Remoto)'), { city: null, state: null });
  assert.deepEqual(parseLocation(null, 'Porto Alegre, Rio Grande do Sul, Brazil'), { city: 'Porto Alegre', state: 'RS' });
  assert.deepEqual(parseLocation('Greater Curitiba', 'Curitiba, Paraná, Brazil'), { city: 'Curitiba', state: 'PR' });
  assert.deepEqual(parseLocation('São Paulo, Brasil (Remoto)', 'São Paulo, Brazil'), { city: 'São Paulo', state: 'SP' });
  assert.deepEqual(parseLocation('Rio de Janeiro e Região (Híbrido)', 'Greater Rio de Janeiro'), { city: 'Rio de Janeiro', state: 'RJ' });
});

test('modalidade', () => {
  assert.equal(parseWorkplace(cards.bairesRecife), 'remoto');
  assert.equal(parseWorkplace({ location: 'Belo Horizonte e Região (Híbrido)' }), 'hibrido');
  assert.equal(parseWorkplace(cards.google), 'presencial');
  assert.equal(parseWorkplace({ title: 'Dev', description: 'Modelo de trabalho híbrido, 3x na semana' }), 'hibrido');
});

test('senioridade pelo título', () => {
  assert.equal(parseSeniority(cards.jobgether), 'junior');
  assert.equal(parseSeniority(cards.google), 'junior');
  assert.equal(parseSeniority(cards.farmarcas), 'pleno');
  assert.equal(parseSeniority(cards.flex), 'pleno');
  assert.equal(parseSeniority(cards.ey), 'pleno');
  assert.equal(parseSeniority(cards.aprendiz), 'aprendiz');
  assert.equal(parseSeniority(cards.middle), 'pleno');
  assert.equal(parseSeniority({ title: 'Estagiário de Engenharia de Software' }), 'estagio');
  assert.equal(parseSeniority({ title: 'Desenvolvedor PL/SQL' }), null);
});

test('senioridade por critério do LinkedIn e por anos de experiência', () => {
  assert.equal(parseSeniority({ title: 'Software Engineer', criteria: { 'Seniority level': 'Entry level' } }), 'junior');
  assert.equal(parseSeniority({ title: 'Software Engineer', criteria: { 'Seniority level': 'Mid-Senior level' } }), 'pleno_senior');
  assert.equal(parseSeniority(cards.atoms, 5), 'senior');
  assert.equal(parseSeniority(cards.atoms, null), null);
});

test('data de publicação relativa', () => {
  assert.equal(parsePostedAt('Anunciada há 16 horas', NOW).toISOString(), '2026-09-16T20:00:00.000Z');
  assert.equal(parsePostedAt('2 weeks ago', NOW).toISOString(), '2026-09-03T12:00:00.000Z');
  assert.equal(parsePostedAt('4 ex-alunos trabalham aqui', NOW), null);
});

test('candidatos', () => {
  assert.deepEqual(parseApplicants(null, cards.bairesRecife.card_text), { applicants: null, few: true });
  assert.deepEqual(parseApplicants('Mais de 100 candidatos'), { applicants: 100, few: false });
  assert.deepEqual(parseApplicants('Over 200 applicants'), { applicants: 200, few: false });
  assert.deepEqual(parseApplicants('Be among the first 25 applicants'), { applicants: null, few: true });
  assert.deepEqual(parseApplicants('12 applicants'), { applicants: 12, few: true });
  assert.deepEqual(parseApplicants('4 ex-alunos da instituição trabalham aqui'), { applicants: null, few: false });
  // A página da vaga é lida depois do card: se ela já mostra 155, o "seja das primeiras" do card ficou velho.
  assert.deepEqual(parseApplicants('155 applicants', cards.bairesRecife.card_text), { applicants: 155, few: false });
});

test('recrutadora: cliente singular sim, "our clients" não', () => {
  const flags = (description, company = 'X') => parseFlags({ title: 'Dev', company, description }).recruiter;
  assert.equal(flags('We are hiring for our client, a fintech in São Paulo'), true);
  assert.equal(flags('Vaga para nosso cliente do setor financeiro'), true);
  assert.equal(flags('We build software for our clients across the world'), false);
  assert.equal(flags('Focados em entregar valor aos nossos clientes'), false);
  assert.equal(flags('', 'Jobgether'), true);
});

test('tecnologias', () => {
  const techs = parseTechs({
    title: 'Desenvolvedor Full Stack',
    description: 'Experiência com React, Node.js, TypeScript e PostgreSQL. Desejável React Native, Docker e C#/.NET. Conhecimento em Java.',
  });
  assert.deepEqual(techs.sort(), ['.NET', 'C#', 'Docker', 'Java', 'Node.js', 'PostgreSQL', 'React', 'React Native', 'TypeScript'].sort());
  assert.ok(!parseTechs({ description: 'Conhecimento em JavaScript' }).includes('Java'));
});

test('anos de experiência', () => {
  assert.equal(parseYearsMin('Mínimo de 3 anos de experiência com desenvolvimento web'), 3);
  assert.equal(parseYearsMin('3+ years of professional experience'), 3);
  assert.equal(parseYearsMin('Experiência de 2 anos em React; 5 anos de experiência em Java é diferencial'), 2);
  assert.equal(parseYearsMin('Empresa com 30 anos de mercado'), null);
});

test('contrato e salário', () => {
  assert.deepEqual(parseContract({ title: 'Dev', description: 'Contratação CLT, benefícios' }), ['CLT']);
  assert.deepEqual(parseSalary({ description: 'Salário: R$ 3.500,00 a R$ 4.500,00 + VR' }), { min: 3500, max: 4500 });
  assert.deepEqual(parseSalary({ description: 'Vale refeição de R$ 30 por dia' }), { min: null, max: null });
});

test('duplicatas agrupam mesma vaga em cidades diferentes', () => {
  assert.equal(dupKey(cards.bairesRecife), dupKey(cards.bairesCuritiba));
  assert.notEqual(dupKey(cards.bairesRecife), dupKey(cards.jobgether));
  const blacksmith = (title) => dupKey({ title, company: 'Blacksmith Agency' });
  assert.equal(blacksmith('AI Developer (Remote, Porto Alegre)'), blacksmith('AI Developer (Remote, Vitoria)'));
  const fullstack = (title) => dupKey({ title, company: 'Fullstack' });
  assert.notEqual(fullstack('Software Engineer (.NET + Angular) - Remote'), fullstack('Software Engineer (Python + React) - Remote'));
});

test('enrich completo: sinais do card e pontuação', () => {
  const baires = enrich(cards.bairesRecife, { now: NOW });
  assert.equal(baires.viewed, true);
  assert.equal(baires.verified, true);
  assert.equal(baires.few_applicants, true);
  assert.equal(baires.workplace, 'remoto');

  const jobgether = enrich(cards.jobgether, { now: NOW });
  assert.equal(jobgether.easy_apply, true);
  assert.equal(jobgether.recruiter, true);
  assert.equal(jobgether.seniority, 'junior');

  const google = enrich(cards.google, { now: NOW });
  assert.equal(google.pcd_only, true);

  const ey = enrich(cards.ey, { now: NOW });
  assert.equal(ey.talent_pool, true);
  assert.ok(ey.pre_score < jobgether.pre_score);

  const kept = new Date('2026-09-01T00:00:00Z');
  assert.equal(enrich(cards.bairesRecife, { now: NOW, previousPostedAt: kept }).posted_at, kept);
});
