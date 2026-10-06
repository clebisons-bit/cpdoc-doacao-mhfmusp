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

// ===== Sessão do painel do CPDoc (cookie assinado, 8 h) =====
const SESSAO_MS = 8 * 60 * 60 * 1000;
const sigSessao = exp => crypto.createHmac('sha256', chave()).update(`sessao|${exp}`).digest('base64url');

export function criarSessao() {
  const exp = Date.now() + SESSAO_MS;
  return { valor: `${exp}.${sigSessao(exp)}`, maxAge: SESSAO_MS / 1000 };
}

export function sessaoValida(cookieHeader) {
  const m = /(?:^|;\s*)cpdoc_sessao=([^;]+)/.exec(cookieHeader || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const esperado = Buffer.from(sigSessao(exp));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

/** Compara a senha informada com CPDOC_PAINEL_SENHA (em tempo constante). */
export function senhaConfere(senha) {
  const esperada = process.env.CPDOC_PAINEL_SENHA;
  if (!esperada || esperada.length < 10) throw new Error('CPDOC_PAINEL_SENHA ausente ou curta (mínimo 10 caracteres).');
  const h = v => crypto.createHash('sha256').update(String(v ?? '')).digest();
  return crypto.timingSafeEqual(h(senha), h(esperada));
}
