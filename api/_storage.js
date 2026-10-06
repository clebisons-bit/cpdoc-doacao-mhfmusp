// Armazenamento em Vercel Private Blob (toda leitura exige autenticação).
// Requer: store PRIVADO conectado ao projeto e "@vercel/blob" >= 2.6.1.
import { put, get, del } from '@vercel/blob';

const caminhoTermo = p => `termos/${p}.pdf`;
const caminhoFinal = p => `finais/${p}.pdf`;
const caminhoDecisao = p => `decisoes/${p}.json`;

async function lerBuffer(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false }).catch(() => null);
  if (!r?.stream) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

const caminhoMeta = p => `termos/${p}.json`;

export async function lerMeta(protocolo) {
  const b = await lerBuffer(caminhoMeta(protocolo));
  if (!b) return null;
  try { return JSON.parse(b.toString('utf8')); } catch { return null; }
}

/**
 * Arquiva o PDF original e os dados do protocolo (doador, bem, hash). Primeira gravação vence:
 * um reenvio só é aceito se o PDF tiver o mesmo hash; com hash diferente lança erro (nada é sobrescrito).
 */
export async function registrarTermo(protocolo, buffer, meta) {
  const existente = await lerMeta(protocolo);
  if (existente) {
    if (existente.pdfHash === meta.pdfHash) return existente;
    throw new Error('Protocolo já registrado com outro PDF.');
  }
  await put(caminhoTermo(protocolo), buffer, {
    access: 'private', contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: true
  });
  await put(caminhoMeta(protocolo), JSON.stringify(meta), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false
  });
  return meta;
}

export const lerTermo = protocolo => lerBuffer(caminhoTermo(protocolo));

/** Guarda o PDF final (termo + página de decisão). Não sobrescreve. */
export async function salvarFinal(protocolo, buffer) {
  await put(caminhoFinal(protocolo), buffer, {
    access: 'private', contentType: 'application/pdf', addRandomSuffix: false
  });
}

export async function lerDecisao(protocolo) {
  const b = await lerBuffer(caminhoDecisao(protocolo));
  if (!b) return null;
  try { return JSON.parse(b.toString('utf8')); } catch { return null; }
}

/**
 * Reserva o protocolo para uma única decisão. A gravação SEM sobrescrita falha se já existir,
 * o que impede resposta dupla (inclusive de dois usuários ao mesmo tempo).
 */
export async function reservarDecisao(protocolo, info) {
  try {
    const b = await put(caminhoDecisao(protocolo), JSON.stringify(info), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false
    });
    return { ok: true, url: b.url };
  } catch (e) {
    if (e?.name === 'BlobAlreadyExistsError' || /already exists/i.test(e?.message || '')) {
      return { ok: false, existente: await lerDecisao(protocolo) };
    }
    throw e;
  }
}

/** Libera a reserva quando o envio do e-mail falhou, para permitir nova tentativa. */
export async function liberarDecisao(url) {
  try { await del(url); } catch (e) { console.error('[storage] Falha ao liberar reserva:', e.message); }
}
