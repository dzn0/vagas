import childProcess, { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pg_ctl as pgCtl } from '@embedded-postgres/windows-x64';
import pg from 'pg';

// Quando o servidor roda sem console (iniciado pela extensão), cada processo filho de console
// abriria uma janela preta. O embedded-postgres não expõe `windowsHide`, então forçamos aqui,
// antes de carregá-lo.
const originalSpawn = childProcess.spawn;
childProcess.spawn = (cmd, args, options) => originalSpawn(cmd, args, { windowsHide: true, ...options });
syncBuiltinESMExports();
const { default: EmbeddedPostgres } = await import('embedded-postgres');

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, 'data', 'pg');
const DB_NAME = 'vagas';

export const PG = {
  host: '127.0.0.1',
  port: Number(process.env.PG_PORT || 5433),
  user: 'postgres',
  password: 'postgres',
  database: DB_NAME,
};

// Fechar a janela do terminal no Windows mata o Node sem parar o Postgres filho,
// que continua segurando a porta e o diretório de dados.
function stopLeftoverPostgres() {
  if (!fs.existsSync(path.join(DATA_DIR, 'postmaster.pid'))) return;
  try {
    execFileSync(pgCtl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w'], { stdio: 'ignore', windowsHide: true });
    console.log('Postgres de uma execução anterior foi encerrado.');
  } catch {
    // Não estava rodando: o arquivo de pid era só resto.
  }
}

export async function startDatabase() {
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG.user,
    password: PG.password,
    port: PG.port,
    persistent: true,
    // Sem isso o initdb no Windows usa WIN1252 e rejeita emojis/caracteres fora do Latin-1.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (msg) => console.error('[postgres]', String(msg).trim()),
  });

  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Criando o banco pela primeira vez…');
    await server.initialise();
  }
  stopLeftoverPostgres();
  await server.start();

  const admin = server.getPgClient();
  await admin.connect();
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [DB_NAME]);
  if (!rowCount) await admin.query(`create database ${DB_NAME} encoding 'UTF8' template template0`);
  await admin.end();

  const pool = new pg.Pool(PG);
  await pool.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return { server, pool };
}
