import crypto from 'node:crypto';
import { registrarTermo } from './_storage.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'cpdoc.museufm@usp.br';
const SENDER_NAME = 'CPDoc MHFMUSP';

// A Brevo exige os destinatários no formato: [{ email: '...' }, { email: '...' }]
const TO = (process.env.CPDOC_TO || 'cpdoc.museufm@usp.br')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(email => ({ email }));

const ORIGENS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const MAX_B64_TOTAL = 4_200_000;
const MAX_ANEXOS = 20;
const MAX_PARTES = 10;
// Formato: MHFMUSP-AAAA-MM-CPDoc-DD-HHMMSS-XXXXXX
// ex.: MHFMUSP-2026-10-CPDoc-04-153012-K7M2QX
const RE_PROTOCOLO = /^MHFMUSP-\d{4}-(0[1-9]|1[0-2])-CPDoc-(0[1-9]|[12]\d|3[01])-([01]\d|2[0-3])[0-5]\d[0-5]\d-[A-Z0-9]{6}$/;
const RE_EMAIL = /^[^\s@<>",;:()]+@[^\s@<>",;:()]+\.[^\s@<>",;:()]+$/;
const RE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const txt = (v, max) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)
  : '';

function nomeSeguro(nome) {
  const base = txt(nome, 300).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  if (!/\.(pdf|jpe?g|png)$/i.test(base)) return null;
  return base.length > 100 ? base.slice(-100) : base;
}

function conteudoConfere(ext, b64) {
  const ini = Buffer.from(b64.slice(0, 1400), 'base64');
  if (ext === 'pdf') return ini.toString('latin1').includes('%PDF-');
  if (ext === 'png') return ini.subarray(0, 4).toString('hex') === '89504e47';
  return ini[0] === 0xff && ini[1] === 0xd8;
}

function anexoValido(filename, base64) {
  const nome = nomeSeguro(filename);
  if (!nome || typeof base64 !== 'string' || !RE_B64.test(base64)) return null;
  const ext = nome.split('.').pop().toLowerCase();
  return conteudoConfere(ext, base64) ? { filename: nome, content: base64 } : null;
}

function validar(b) {
  const protocolo = txt(b.protocolo, 40);
  if (!RE_PROTOCOLO.test(protocolo)) return { erro: 'Protocolo inválido.' };

  const parte = Number(b.parte ?? 1);
  const totalPartes = Number(b.totalPartes ?? 1);
  if (![parte, totalPartes].every(Number.isInteger) || parte < 1 || totalPartes > MAX_PARTES || parte > totalPartes)
    return { erro: 'Numeração de partes inválida.' };

  const doadorNome = txt(b.doadorNome, 200);
  const doadorEmail = txt(b.doadorEmail, 200);
  const bemNome = txt(b.bemNome, 300);
  if (!doadorNome || !bemNome || !RE_EMAIL.test(doadorEmail))
    return { erro: 'Dados do doador ou do bem incompletos.' };

  const attachments = [];
  if (parte === 1) {
    const pdf = anexoValido(`Termo_Doacao_${protocolo}.pdf`, b.pdfBase64);
    if (!pdf) return { erro: 'PDF do termo ausente ou inválido.' };
    attachments.push(pdf);
  }
  if (!Array.isArray(b.anexos) || b.anexos.length > MAX_ANEXOS) return { erro: 'Lista de anexos inválida.' };
  for (const a of b.anexos) {
    const ok = anexoValido(a?.filename, a?.base64);
    if (!ok) return { erro: `Anexo inválido ou formato não aceito: ${txt(a?.filename, 60)}` };
    attachments.push(ok);
  }
  if (attachments.reduce((s, a) => s + a.content.length, 0) > MAX_B64_TOTAL)
    return { erro: 'Anexos excedem o tamanho máximo por envio.' };

  const hash = txt(b.hash, 64);
  const resumo = (Array.isArray(b.resumo) ? b.resumo : []).slice(0, 60)
    .map(r => ({ rotulo: txt(r?.rotulo, 80), valor: txt(r?.valor, 3000) }));

  return {
    d: { protocolo, parte, totalPartes, doadorNome, doadorEmail, bemNome,
         timestamp: txt(b.timestamp, 60), hash: /^[a-f0-9]{64}$/.test(hash) ? hash : '', resumo, attachments }
  };
}

function blocoResposta(painel, protocolo) {
  if (!painel) return '';
  return `<div style="margin:18px 0 6px;padding:14px;background:#f4f8f6;border:1px solid #cfe3da;border-radius:4px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#006747">Responder ao doador (aceitar ou recusar)</p>
      <p style="margin:0 0 10px;font-size:13px">Acesse o painel do CPDoc, entre com a senha da equipe e escolha o protocolo <b>${esc(protocolo)}</b>.</p>
      <a href="${esc(painel)}" style="display:inline-block;background:#006747;color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 22px;border-radius:4px">Abrir painel do CPDoc</a>
      <p style="margin:10px 0 0;font-size:11px;color:#555">Se o botão não abrir, use o endereço do painel salvo nos favoritos do navegador.</p></div>`;
}

function montarHtml(d, painel) {
  const linha = (r, v, forte) =>
    `<tr><td style="padding:4px 10px 4px 0;font-weight:bold;vertical-align:top;width:170px">${esc(r)}:</td>` +
    `<td style="padding:4px 0;white-space:pre-wrap;${forte ? 'color:#006747;font-weight:bold' : ''}">${esc(v)}</td></tr>`;
  const rows = [
    linha('Protocolo', d.protocolo, true), linha('Doador', d.doadorNome),
    linha('E-mail do doador', d.doadorEmail), linha('Bem', d.bemNome),
    linha('Parte', `${d.parte} de ${d.totalPartes}`),
    linha('Anexos nesta mensagem', `${d.attachments.length} arquivo(s)`)
  ];
  if (d.parte === 1) {
    rows.push(linha('Data/hora', d.timestamp), linha('Hash SHA-256', d.hash));
    d.resumo.forEach(i => rows.push(linha(i.rotulo, i.valor)));
  }
  const aviso = d.parte === 1
    ? 'O Termo assinado (PDF) e os documentos/fotos seguem em anexo.'
    : 'Anexos complementares do protocolo acima. O Termo em PDF segue na parte 1.';
  return `<div style="font-family:Arial,sans-serif;color:#111;max-width:680px;line-height:1.5">
    <div style="background:#006747;padding:16px;border-bottom:4px solid #009CA6;color:#fff">
      <h2 style="margin:0;font-size:16px">MUSEU HISTÓRICO &quot;PROF. CARLOS DA SILVA LACAZ&quot; — FMUSP</h2>
      <p style="margin:4px 0 0;font-size:12px">Centro de Pesquisa e Documentação (CPDoc)</p></div>
    <div style="padding:18px;border:1px solid #ddd;border-top:none">
      <p style="font-size:14px;font-weight:bold;color:#006747">Nova proposta de doação de acervo recebida pela plataforma web.</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin:12px 0">${rows.join('')}</table>
      ${d.parte === 1 ? blocoResposta(painel, d.protocolo) : ''}
      <p style="font-size:12px;color:#555">${aviso}</p></div></div>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('[send-email] BREVO_API_KEY ausente.');
    return res.status(500).json({ error: 'Serviço de envio não configurado.', code: 'CONFIG' });
  }

  if (ORIGENS.length && !ORIGENS.includes(req.headers.origin || '')) {
    return res.status(403).json({ error: 'Origem não autorizada.', code: 'ORIGIN' });
  }

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: 'JSON inválido.' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Corpo da requisição vazio.' });

  const { d, erro } = validar(body);
  if (erro) return res.status(400).json({ error: erro, code: 'VALIDATION' });

  // Acesso ao painel de resposta (apenas na parte 1). O PDF e os dados do protocolo são arquivados em storage
  // privado e a resposta é feita pelo painel do CPDoc (/api/painel), sem depender de links rastreados. Se algo falhar, o e-mail segue sem os botões.
  let painel = null;
  if (d.parte === 1) {
    try {
      const pdfBuf = Buffer.from(d.attachments[0].content, 'base64');
      const pdfHash = crypto.createHash('sha256').update(pdfBuf).digest('hex');
      await registrarTermo(d.protocolo, pdfBuf, {
        protocolo: d.protocolo, doadorNome: d.doadorNome, doadorEmail: d.doadorEmail,
        bemNome: d.bemNome, pdfHash, criadoEm: new Date().toISOString() });
      const base = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
      painel = `${base}/api/painel`;
    } catch (e) {
      console.error('[send-email] Links de resposta desativados:', e.message);
    }
  }

  // A Brevo espera a lista com propriedades { name: '...', content: '...' }
  const attachmentsBrevo = d.attachments.map(a => ({
    name: a.filename,
    content: a.content
  }));

  const sufixo = d.totalPartes > 1 ? ` (parte ${d.parte}/${d.totalPartes})` : '';

  const payload = {
    sender: {
      name: SENDER_NAME,
      email: SENDER_EMAIL
    },
    to: TO,
    replyTo: {
      name: d.doadorNome,
      email: d.doadorEmail
    },
    subject: `[CPDoc MHFMUSP] Nova Proposta de Doação — Protocolo ${d.protocolo}${sufixo}`,
    htmlContent: montarHtml(d, painel),
    ...(attachmentsBrevo.length > 0 ? { attachment: attachmentsBrevo } : {})
  };

  try {
    const r = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[send-email] Brevo', r.status, JSON.stringify(data), d.protocolo);
      return res.status(502).json({ 
        error: data?.message || 'Falha ao enviar o e-mail via Brevo.', 
        code: `BREVO_${r.status}` 
      });
    }

    return res.status(200).json({ 
      success: true, 
      id: data.messageId, 
      parte: d.parte, 
      totalPartes: d.totalPartes 
    });
  } catch (err) {
    console.error('[send-email] Exceção', err);
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return res.status(timeout ? 504 : 500).json({ 
      error: timeout ? 'Tempo esgotado no envio.' : 'Erro interno.', 
      code: timeout ? 'TIMEOUT' : 'INTERNAL' 
    });
  }
}
