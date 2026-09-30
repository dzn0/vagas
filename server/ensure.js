// Sobe o servidor em segundo plano se ele ainda não responde. Usado pelo host nativo e pela CLI.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const API = `http://127.0.0.1:${process.env.PORT || 3777}`;
const LOG = path.join(here, 'data', 'server.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function apiUp() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// PID de quem escuta na porta da API (servidor antigo, sem `pid` no /health).
function pidOnPort() {
  const port = new URL(API).port;
  try {
    const out = process.platform === 'win32'
      ? execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
      : execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (process.platform !== 'win32') return Number(out.trim().split('\n')[0]) || null;
    const line = out.split('\n').find((l) => new RegExp(`:${port}\\s+\\S+\\s+LISTENING`).test(l));
    return line ? Number(line.trim().split(/\s+/).at(-1)) : null;
  } catch {
    return null;
  }
}

// Desliga o servidor que estiver no ar. Caminho normal: POST /shutdown, que fecha a API, o pool e
// o Postgres (pg_ctl) antes de sair. Se o servidor for antigo ou não responder, encerra o processo;
// o Postgres que sobrar é parado com segurança (pg_ctl stop -m fast) pelo próximo start.
export async function stopServer() {
  if (!(await apiUp())) return { stopped: false };
  let pid = null;
  try {
    pid = (await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })).json()).pid ?? null;
  } catch {}
  pid ??= pidOnPort();

  let graceful = false;
  try {
    const r = await fetch(`${API}/shutdown`, { method: 'POST', headers: { 'X-Vagas-CLI': '1' }, signal: AbortSignal.timeout(5000) });
    graceful = r.ok;
  } catch {}

  for (let i = 0; i < (graceful ? 60 : 0); i++) {
    await sleep(500);
    if (!(await apiUp()) && (!pid || !alive(pid))) return { stopped: true, graceful: true, pid };
  }
  if (pid && alive(pid)) process.kill(pid);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (!(await apiUp()) && (!pid || !alive(pid))) return { stopped: true, graceful: false, pid };
  }
  throw new Error(`Não consegui desligar o servidor da porta ${new URL(API).port}${pid ? ` (PID ${pid})` : ''}.`);
}

export async function ensureServer() {
  if (await apiUp()) return { ok: true, started: false };

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.openSync(LOG, 'a');
  // `detached` é obrigatório: no Windows o Node põe filhos não desacoplados num job que é
  // encerrado quando o processo pai sai, o que derrubaria o servidor logo após responder.
  const child = spawn(process.execPath, [path.join(here, 'index.js')], {
    cwd: here,
    stdio: ['ignore', out, out],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (await apiUp()) return { ok: true, started: true };
    if (child.exitCode != null) break;
  }
  const tail = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').slice(-15).join('\n') : '';
  return { ok: false, error: `O servidor não respondeu. Últimas linhas de server/data/server.log:\n${tail}` };
}
