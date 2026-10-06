// Links curtos e assinados (HMAC-SHA256) para Aceitar/Recusar: "PROTOCOLO.acao.assinatura".
// Os dados do doador NÃO vão no link (ficam no storage), para o endereço ser curto e sobreviver
// ao rastreamento de cliques da Brevo, que embute a URL de destino dentro do link rastreado.
// Arquivos iniciados com "_" na pasta /api não viram endpoint na Vercel.
import crypto from 'node:crypto';

const RE_PROTOCOLO = /^MHFMUSP-\d{4}-(0[1-9]|1[0-2])-CPDoc-(0[1-9]|[12]\d|3[01])-([01]\d|2[0-3])[0-5]\d[0-5]\d-[A-Z0-9]{6}$/;
const ACOES = ['aceite', 'recusa'];

function chave() {
  const s = process.env.RESPONSE_SECRET;
  if (!s || s.length < 32) throw new Error('RESPONSE_SECRET ausente ou curta (mínimo 32 caracteres).');
  return s;
}

const assinatura = (protocolo, acao) =>
  crypto.createHmac('sha256', chave()).update(`${protocolo}|${acao}`).digest().subarray(0, 16).toString('base64url');

export function criarLink(protocolo, acao) {
  if (!RE_PROTOCOLO.test(protocolo) || !ACOES.includes(acao)) throw new Error('Dados de link inválidos.');
  return `${protocolo}.${acao}.${assinatura(protocolo, acao)}`;
}

/** Retorna { protocolo, acao } se a assinatura for válida; caso contrário, null. */
export function lerLink(t) {
  if (typeof t !== 'string' || t.length > 200) return null;
  const partes = t.split('.');
  if (partes.length !== 3) return null;
  const [protocolo, acao, sig] = partes;
  if (!RE_PROTOCOLO.test(protocolo) || !ACOES.includes(acao)) return null;
  const esperado = Buffer.from(assinatura(protocolo, acao));
  const recebido = Buffer.from(sig);
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return null;
  return { protocolo, acao };
}
