# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS with no build step, served by the existing local Node server (`server/index.js`, `http://localhost:3777`). Data and writes go through that server's JSON API; the database is the embedded PostgreSQL in `server/data/pg`.

## Users

One user: André Pieri, a junior full-stack developer (strongest in front-end) looking for his first job in software as fast as possible. He runs `/vagas` in Claude Code, which collects LinkedIn jobs, screens them with AI and ranks them. He then decides, per job, whether to apply, discard or follow up.

## Product Purpose

A personal job-hunt system: collect jobs automatically, screen them against André's profile (site andrepieri.com.br + CV), and turn the result into decisions. Success is getting hired soon. The system spends his time and tokens only on jobs he can realistically get.

## Positioning

Every AI decision is stored in the database with a reason, a score, highlights and gaps. The ranking reflects his real chance of being hired, not how appealing a job is. Status is his call; AI judgement lives in separate `ai_*` fields.

## Operating Context

- `/vagas` (Claude Code skill in `~/.claude/skills/vagas`) runs collection, screening and evaluation, then reports. It also searches Presidente Prudente/SP (where he is moving) on the web.
- CLI: `server/cli.js`. API: `server/index.js` (`/jobs`, `/jobs/:id` PATCH, `/pipeline`, `/profile`…).
- Optional browser extension (`dashboard.html`) for logged-in LinkedIn sections.
- The results page opens in the browser at the end of `/vagas` screening. It is the place to view everything and act.

## Capabilities and Constraints

- The page shows all jobs, with filters; it opens on the AI recommendations (`forte`/`avaliar`) by default.
- Actions: change status (`nova`, `interessante`, `descartada`, `aplicada`, `entrevista`, `encerrada`), which is saved to the database immediately; write notes and a discard reason; read the full description with the AI summary, highlights and gaps; see applications with no update for 7+ days.
- Jobs carry: title, company, location, workplace, seniority, age, applicant count, techs, salary, pre-score, AI verdict/score/reason/summary/highlights/gaps, sections (which search found them), duplicate group, LinkedIn URL.
- Local only (127.0.0.1); single user; no auth.
- Content is Portuguese (pt-BR).

## Brand Commitments

- Results page: the category standard on purpose (chosen 2026-09-23). Quality bar: GitHub Issues/Projects — dense issue-style list, labels, filter bar with qualifiers, side panel for the item, board view by status. Conventions played straight, no metaphor.
- Language: Portuguese (pt-BR) throughout.

## Evidence on Hand

Real data in the local database (~1500 jobs, ~46 applied). No fabricated content.

## Product Principles

- Decisions over browsing: every view should lead to "apply, discard or follow up".
- The AI's reasoning is visible next to its verdict, so it can be trusted or overruled quickly.
- Status belongs to André; the page never changes it without his action.
- Never lose work: a status or note change is saved at once and confirmed.
