// Tokens assinados (HMAC-SHA256) para os links de Aceitar/Recusar.
// Arquivos iniciados com "_" na pasta /api não viram endpoint na Vercel.
import crypto from 'node:crypto';

const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function chave() {
  const s = process.env.RESPONSE_SECRET;
  if (!s || s.length < 32) throw new Error('RESPONSE_SECRET ausente ou curta (mínimo 32 caracteres).');
  return s;
}

const hmac = p => crypto.createHmac('sha256', chave()).update(p).digest();

export function assinar(dados) {
  const p = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + VALIDADE_MS })).toString('base64url');
  return `${p}.${hmac(p).toString('base64url')}`;
}

export function verificar(token) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const [p, s] = partes;
  const esperado = hmac(p);
  const recebido = Buffer.from(s, 'base64url');
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return o && typeof o === 'object' && o.exp > Date.now() ? o : null;
  } catch {
    return null;
  }
}
