// Host de native messaging: o Brave/Chrome executa este script quando o painel da extensão abre.
// Protocolo: mensagens JSON precedidas de 4 bytes (little-endian) com o tamanho, via stdin/stdout.
// Nada além do protocolo pode ir para o stdout.
import { ensureServer } from './ensure.js';

function readMessage() {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    process.stdin.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length >= 4 + len) resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
    });
    process.stdin.on('end', () => reject(new Error('stdin fechado sem mensagem')));
  });
}

function writeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([header, body]), resolve));
}

try {
  const msg = await readMessage();
  const reply = msg?.cmd === 'ensure' ? await ensureServer() : { ok: false, error: `comando desconhecido: ${msg?.cmd}` };
  await writeMessage(reply);
} catch (e) {
  await writeMessage({ ok: false, error: e.message });
}
process.exit(0);
