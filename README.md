# Coletor de Vagas LinkedIn

Extensão local para Chrome/Edge que percorre as seções de vagas do LinkedIn (recomendadas, candidatura simplificada, remotas, salvas, buscas próprias…), junta tudo sem duplicar e exporta em Markdown/JSON/CSV para colar numa IA.

## Instalar

1. Abra `brave://extensions` (Chrome: `chrome://extensions`, Edge: `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha esta pasta.
4. Fixe o ícone da extensão na barra.

## Usar

1. Esteja logado no LinkedIn nesse navegador.
2. Clique no ícone da extensão: abre o painel numa aba.
3. (Opcional) **Descobrir seções no LinkedIn** — lê `linkedin.com/jobs` e adiciona todas as coleções que aparecerem para você.
4. (Opcional) Adicione URLs de buscas próprias (faça a busca no LinkedIn com os filtros e copie a URL).
5. **Coletar todas as seções marcadas**. Uma aba em segundo plano visita cada seção e página; depois a descrição completa de cada vaga é baixada.
6. **Copiar Markdown** e colar na IA (ou baixar .md/.json/.csv).

Os dados ficam salvos na extensão (`chrome.storage.local`); rodar de novo só adiciona vagas novas e busca descrições pendentes.

## Banco de vagas (PostgreSQL local)

### Início automático (recomendado)

Uma vez só, com a extensão já carregada no navegador:

```
cd server
npm install
node install-native-host.js
```

Depois recarregue a extensão. Toda vez que o painel abrir, ele sobe o banco em segundo plano (sem janela) se ainda não estiver rodando. O log fica em `server/data/server.log`. O servidor continua ligado até você reiniciar o computador ou encerrar o processo `node` pelo Gerenciador de Tarefas.

Se a pasta do projeto mudar de lugar, o ID da extensão muda: rode `node install-native-host.js` de novo. Para remover: `node install-native-host.js --uninstall`.

### Início manual

Dê dois cliques em `iniciar-banco.cmd` (ou rode `npm start` dentro de `server/`) e deixe a janela aberta. Na primeira vez ele instala as dependências e cria o banco em `server/data/`. Para parar, use Ctrl+C.

Com o banco ligado, o painel mostra **Banco: conectado** e envia cada vaga coletada automaticamente. O servidor calcula campos para triagem: modalidade, cidade/UF, senioridade, data real de publicação, nº de candidatos, candidatura simplificada, tecnologias, anos de experiência, tipo de contrato, inglês, salário, vaga PcD, banco de talentos, recrutadora, grupo de duplicatas e uma pontuação prévia (0–100).

- **Copiar triagem do banco**: uma linha por vaga, já sem pleno/sênior, PcD, duplicatas e vagas com mais de 30 dias, ordenada pela pontuação.
- Conexão direta (DBeaver, pgAdmin, psql): `postgres://postgres:postgres@127.0.0.1:5433/vagas`

API em `http://localhost:3777`:

| Rota | Uso |
|---|---|
| `GET /health` | Status e contagens |
| `GET /triage` | Vagas filtradas para triagem (aceita os mesmos filtros de `/jobs` para sobrescrever os padrões) |
| `GET /export/compact` | Triagem em texto, uma linha por vaga (`?all=1` sem filtros padrão) |
| `GET /jobs?…` | Filtros: `status`, `seniority`, `exclude_seniority`, `workplace`, `state`, `techs`, `max_age_days`, `max_years`, `easy_apply`, `pcd_only`, `talent_pool`, `english_required`, `recruiter`, `min_score`, `q`, `hide_dups`, `limit`, `full=1` (inclui descrição) |
| `GET /jobs/:id` | Vaga completa |
| `PATCH /jobs/:id` | `{ "status": "interessante" \| "descartada" \| "aplicada" \| "entrevista" \| "encerrada", "discard_reason": "...", "notes": "..." }` |
| `POST /jobs` | `{ "jobs": [...] }` — usado pela extensão |
| `POST /shutdown` | Desligamento limpo (API, conexões e Postgres). Só aceita o cabeçalho `X-Vagas-CLI: 1`, usado por `node cli.js restart` |
| `POST /reenrich` | Recalcula os campos derivados de todas as vagas (após mudar regras em `enrich.js`) |

Testes das regras de extração: `npm test` em `server/`.

## Skill `/vagas` (Claude Code)

A skill fica em `~/.claude/skills/vagas/` e usa `server/cli.js` (`node server/cli.js help`). A cada execução ela:
sobe o banco → relê andrepieri.com.br e o currículo PDF (só reestrutura o perfil se algo mudou) → triagem por
linha → avaliação completa só das aprovadas → ranking com o que destacar e as lacunas. Toda decisão fica no banco
(`ai_*`) marcada com a versão do perfil, então execuções seguintes só processam vagas novas.

A coleta do LinkedIn também é automática: `node server/cli.js collect` roda as buscas do escopo
(`preferences.busca` no perfil; `node server/cli.js scope` mostra o que vale) na busca pública do LinkedIn,
sem login e sem abrir a extensão, e grava só as vagas novas. O `/vagas` faz isso sozinho no começo de cada
execução; para mudar o que é buscado, use `/vagas escopo`. A extensão fica opcional, útil para as seções
que só aparecem logado (Recomendadas, Principais oportunidades, Vagas salvas).

### Página de vagas

Ao fim de cada `/vagas`, a skill abre `http://localhost:3777/` (`node server/cli.js open`): a página em
`server/public/`, servida pelo mesmo servidor do banco. Lista no estilo GitHub Issues com abas (Recomendadas,
Aplicadas, Cobrar retorno…), filtros e qualificadores na busca (`status:aplicada ia:forte modalidade:remoto`),
painel com a avaliação da IA e a descrição, notas e motivo de descarte, e quadro por status (arrastar muda o
status). Toda mudança grava direto no banco, com "Desfazer". Atalhos: `/` busca, `j`/`k` navega, `Enter` abre,
`s` muda status, `x` seleciona, `Esc` fecha. Os descartes feitos ali (`node server/cli.js discards`) viram
regras na próxima execução.

Variações: `/vagas perfil`, `/vagas escopo`, `/vagas relatorio`, `/vagas aplicar <id>`, `/vagas status`, `/vagas mercado`.

## Observações

- Mantenha a aba do painel aberta durante a coleta.
- O LinkedIn muda o HTML com frequência; se alguma seção passar a vir com 0 vagas, os seletores ficam em `pageCollector` dentro de `dashboard.js`.
- Automatizar o LinkedIn vai contra os termos de uso dele. Use intervalos generosos (padrão 2,5 s) e poucas páginas para não chamar atenção na sua conta.
