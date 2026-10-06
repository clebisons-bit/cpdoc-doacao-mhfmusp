import crypto from 'node:crypto';
import { lerLink, sessaoValida } from './_token.js';
import { anexarDecisao } from './_pdf.js';
import { lerMeta, lerTermo, lerDecisao, reservarDecisao, liberarDecisao, salvarFinal } from './_storage.js';

const VALIDADE_LINK_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const CPDOC_EMAIL = process.env.CPDOC_REPLY_TO || 'cpdoc.museufm@usp.br';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || CPDOC_EMAIL;
const SENDER_NAME = 'CPDoc MHFMUSP';

/* ===== TEXTOS EDITÁVEIS ===================================================== */
const TEXTOS = {
  aceite: {
    rotulo: 'ACEITAR', cor: '#006747', aceite: true,
    assunto: 'Proposta de doação ACEITA', status: 'aceita', arquivo: 'ACEITE',
    paragrafo:
      'Informamos que sua proposta de doação foi <b>aceita</b> pelo Museu Histórico ' +
      '&quot;Prof. Carlos da Silva Lacaz&quot; da FMUSP, após análise do CPDoc, conforme a Política de Gestão de Acervos. ' +
      'Os próximos passos (formalização da doação e transferência do material) serão tratados com você por este mesmo e-mail.',
    campo: 'Orientações para os próximos passos (opcional)',
    rotuloPdf: 'Orientações para os próximos passos',
    obrigatorio: false
  },
  recusa: {
    rotulo: 'RECUSAR', cor: '#b3261e', aceite: false,
    assunto: 'Resposta à sua proposta de doação', status: 'não aceita', arquivo: 'NAO_ACEITA',
    paragrafo:
      'Agradecemos o seu interesse em contribuir com o acervo do Museu Histórico ' +
      '&quot;Prof. Carlos da Silva Lacaz&quot; da FMUSP. Após análise do CPDoc, conforme a Política de Gestão de Acervos, ' +
      'informamos que não será possível <b>aceitar</b> esta proposta neste momento.',
    campo: 'Justificativa (obrigatória; consta no PDF oficial e no e-mail ao doador)',
    rotuloPdf: 'Justificativa da recusa',
    obrigatorio: true
  }
};
/* ============================================================================ */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const txt = (v, max) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)
  : '';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function agoraBrasilia() {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return {
    texto: `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}:${p.second} (horário de Brasília)`,
    iso: now.toISOString()
  };
}

const CSS = `
  body{font-family:Arial,sans-serif;background:#f3f4f6;margin:0;color:#111}
  .box{max-width:640px;margin:24px auto;background:#fff;border:1px solid #ddd;border-radius:6px;overflow:hidden}
  .top{background:#006747;border-bottom:4px solid #009CA6;color:#fff;padding:16px}
  .top h1{margin:0;font-size:16px}.top p{margin:4px 0 0;font-size:12px}
  .in{padding:20px;font-size:14px;line-height:1.5}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
  td{padding:5px 8px 5px 0;vertical-align:top}td:first-child{font-weight:bold;width:140px}
  label{display:block;font-weight:bold;margin:12px 0 4px}
  input,textarea{width:100%;box-sizing:border-box;padding:8px;font:inherit;border:1px solid #bbb;border-radius:4px}
  textarea{min-height:140px}
  button{border:0;color:#fff;font-weight:bold;font-size:14px;padding:11px 22px;border-radius:4px;cursor:pointer}
  .aviso{background:#fff8e1;border:1px solid #f0d58a;padding:10px;font-size:12px;border-radius:4px;margin:14px 0}
  .erro{background:#fdecea;border:1px solid #f1b0aa;color:#8a1c14;padding:10px;font-size:13px;border-radius:4px;margin:12px 0}
  .ok{color:#006747;font-weight:bold;font-size:16px}
  .hash{font-family:monospace;font-size:11px;word-break:break-all;background:#f6f6f6;padding:6px;border-radius:4px}`;

function pagina(res, status, corpo) {
  res.status(status).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>CPDoc MHFMUSP — Resposta ao doador</title><style>${CSS}</style></head><body>
<div class="box"><div class="top"><h1>MUSEU HISTÓRICO &quot;PROF. CARLOS DA SILVA LACAZ&quot; — FMUSP</h1>
<p>Centro de Pesquisa e Documentação (CPDoc)</p></div><div class="in">${corpo}</div></div></body></html>`);
}

const resumoTabela = d => `<table>
  <tr><td>Protocolo:</td><td>${esc(d.protocolo)}</td></tr>
  <tr><td>Bem:</td><td>${esc(d.bemNome)}</td></tr>
  <tr><td>Doador:</td><td>${esc(d.doadorNome)}</td></tr>
  <tr><td>E-mail do doador:</td><td>${esc(d.doadorEmail)}</td></tr></table>`;

function jaRespondido(res, d, reg) {
  const t = reg && TEXTOS[reg.acao];
  return pagina(res, 409, `<p class="erro"><b>Este protocolo já foi respondido.</b></p>${resumoTabela(d)}
    ${reg ? `<table>
      <tr><td>Decisão:</td><td>${esc(t ? t.status : reg.acao)}</td></tr>
      <tr><td>Registrada em:</td><td>${esc(reg.dataHora)}</td></tr>
      <tr><td>Responsável:</td><td>${esc(reg.responsavelNome)} — ${esc(reg.responsavelCargo)}</td></tr></table>` : ''}
    <p style="font-size:12px;color:#555">Não é possível registrar uma segunda decisão para o mesmo protocolo.</p>`);
}

function formulario(res, link, d, t, v = {}, erro = '', status = 200) {
  pagina(res, status, `
    <h2 style="margin:0 0 6px;color:${t.cor}">${t.rotulo} proposta de doação</h2>
    ${resumoTabela(d)}
    ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
    <form method="POST" action="/api/responder">
      <input type="hidden" name="t" value="${esc(link)}">
      <label for="rn">Nome completo do responsável</label>
      <input id="rn" name="responsavelNome" required minlength="5" maxlength="120" autocomplete="name" value="${esc(v.responsavelNome)}">
      <label for="rc">Cargo/função</label>
      <input id="rc" name="responsavelCargo" required minlength="2" maxlength="120" value="${esc(v.responsavelCargo)}">
      <label for="m">${esc(t.campo)}</label>
      <textarea id="m" name="mensagem" maxlength="3000"${t.obrigatorio ? ' required minlength="10"' : ''}>${esc(v.mensagem)}</textarea>
      <div class="aviso">Ao confirmar, a decisão, seu nome, seu cargo e a data/hora serão <b>gravados no PDF oficial</b>, que será enviado
      <b>imediatamente</b> a ${esc(d.doadorEmail)}, com cópia para ${esc(CPDOC_EMAIL)}. A ação não pode ser desfeita.</div>
      <button type="submit" style="background:${t.cor}">Confirmar e enviar resposta</button>
    </form>`);
}

function montarHtmlDoador(d, t, r) {
  const linha = (a, b) => `<tr><td style="padding:4px 10px 4px 0;font-weight:bold;vertical-align:top">${a}:</td><td style="padding:4px 0">${b}</td></tr>`;
  return `<div style="font-family:Arial,sans-serif;color:#111;max-width:680px;line-height:1.5">
  <div style="background:#006747;padding:16px;border-bottom:4px solid #009CA6;color:#fff">
    <h2 style="margin:0;font-size:16px">MUSEU HISTÓRICO &quot;PROF. CARLOS DA SILVA LACAZ&quot; — FMUSP</h2>
    <p style="margin:4px 0 0;font-size:12px">Centro de Pesquisa e Documentação (CPDoc)</p></div>
  <div style="padding:18px;border:1px solid #ddd;border-top:none">
    <p style="font-size:14px">Prezado(a) ${esc(d.doadorNome)},</p>
    <p style="font-size:14px">${t.paragrafo}</p>
    <table style="font-size:13px;border-collapse:collapse;margin:12px 0">
      ${linha('Protocolo', `<b style="color:#006747">${esc(d.protocolo)}</b>`)}
      ${linha('Bem', esc(d.bemNome))}
      ${linha('Situação', esc(t.status))}
      ${linha('Registrada em', esc(r.dataHora))}
      ${linha('Responsável', `${esc(r.responsavelNome)} — ${esc(r.responsavelCargo)}`)}</table>
    ${r.mensagem ? `<div style="border-left:4px solid #009CA6;background:#f4f8f6;padding:10px 14px;margin:14px 0;font-size:13px;white-space:pre-wrap">${esc(r.mensagem)}</div>` : ''}
    <p style="font-size:13px">O <b>Termo de Doação com a decisão do Museu</b> segue em anexo (PDF oficial). Guarde-o para seus registros.</p>
    <p style="font-size:11px;color:#555;word-break:break-all">Hash SHA-256 do PDF anexo: ${esc(r.hashFinal)}</p>
    <p style="font-size:12px;color:#555">Em caso de dúvidas, basta responder a este e-mail.</p>
    <p style="font-size:13px">Atenciosamente,<br><b>CPDoc — Museu Histórico &quot;Prof. Carlos da Silva Lacaz&quot; / FMUSP</b></p>
  </div></div>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return pagina(res, 405, '<p class="erro">Método não permitido.</p>');
  }

  // Só responde quem entrou no painel do CPDoc (além do link assinado).
  let logado = false;
  try { logado = sessaoValida(req.headers.cookie); }
  catch (e) {
    console.error('[responder] Configuração:', e.message);
    return pagina(res, 500, '<p class="erro">Serviço de resposta não configurado.</p>');
  }
  if (!logado) {
    return pagina(res, 401, '<p class="erro"><b>Acesso restrito à equipe do CPDoc.</b></p><p>Entre pelo <a href="/api/painel">painel do CPDoc</a> e escolha o protocolo a responder.</p>');
  }

  const link = req.method === 'GET'
    ? new URL(req.url, 'http://localhost').searchParams.get('t')
    : (req.body && typeof req.body === 'object' ? req.body.t : null);

  let d = null;
  try {
    const lk = lerLink(link);               // confere a assinatura do link
    const meta = lk && await lerMeta(lk.protocolo); // dados do doador vêm do storage, não do link
    if (meta && meta.pdfHash && Date.parse(meta.criadoEm) + VALIDADE_LINK_MS > Date.now()) {
      d = { acao: lk.acao, protocolo: lk.protocolo, doadorNome: meta.doadorNome, doadorEmail: meta.doadorEmail,
            bemNome: meta.bemNome, pdfHash: meta.pdfHash };
    }
  } catch (e) {
    console.error('[responder] Configuração/armazenamento:', e.message);
    return pagina(res, 500, '<p class="erro">Serviço de resposta não configurado ou indisponível.</p>');
  }
  const t = d && TEXTOS[d.acao];
  if (!d || !t) {
    return pagina(res, 400, '<p class="erro"><b>Link inválido ou expirado.</b><br>Peça o reenvio do protocolo ou responda diretamente ao doador pelo e-mail.</p>');
  }

  // GET apenas mostra a confirmação (evita que scanners de e-mail disparem a ação ao "clicar" no link).
  if (req.method === 'GET') {
    try {
      const reg = await lerDecisao(d.protocolo);
      if (reg) return jaRespondido(res, d, reg);
    } catch (e) { console.error('[responder] Leitura da decisão:', e.message); }
    return formulario(res, link, d, t);
  }

  const v = {
    responsavelNome: txt(req.body.responsavelNome, 120),
    responsavelCargo: txt(req.body.responsavelCargo, 120),
    mensagem: txt(req.body.mensagem, 3000)
  };
  if (v.responsavelNome.length < 5 || v.responsavelCargo.length < 2) {
    return formulario(res, link, d, t, v, 'Informe o nome completo e o cargo/função do responsável.', 400);
  }
  if (t.obrigatorio && v.mensagem.length < 10) {
    return formulario(res, link, d, t, v, 'Informe a justificativa (mínimo de 10 caracteres).', 400);
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('[responder] BREVO_API_KEY ausente.');
    return pagina(res, 500, '<p class="erro">Serviço de envio não configurado.</p>');
  }

  let reserva;
  try {
    // 1) Termo original guardado + conferência de integridade
    const termo = await lerTermo(d.protocolo);
    if (!termo) {
      console.error('[responder] Termo original não encontrado:', d.protocolo);
      return pagina(res, 404, `<p class="erro"><b>O PDF original deste protocolo não foi encontrado no arquivo.</b><br>Use o PDF anexado ao e-mail original e responda diretamente ao doador.</p>`);
    }
    if (sha256(termo) !== d.pdfHash) {
      console.error('[responder] Hash do termo divergente:', d.protocolo);
      return pagina(res, 409, `<p class="erro"><b>Falha de integridade:</b> o PDF arquivado não confere com o hash registrado no envio. Nenhuma resposta foi enviada. Verifique com o responsável técnico.</p>`);
    }

    // 2) Página de decisão acrescentada ao PDF
    const quando = agoraBrasilia();
    const pdfFinal = Buffer.from(await anexarDecisao(termo, {
      aceite: t.aceite, protocolo: d.protocolo, bemNome: d.bemNome, doadorNome: d.doadorNome,
      doadorEmail: d.doadorEmail, dataHora: quando.texto, responsavelNome: v.responsavelNome,
      responsavelCargo: v.responsavelCargo, mensagem: v.mensagem, rotuloMensagem: t.rotuloPdf,
      hashTermo: d.pdfHash, emailInstitucional: CPDOC_EMAIL
    }));
    const hashFinal = sha256(pdfFinal);

    // 3) Reserva única do protocolo (impede resposta dupla)
    const registro = { acao: d.acao, protocolo: d.protocolo, dataHora: quando.texto, dataHoraISO: quando.iso,
      responsavelNome: v.responsavelNome, responsavelCargo: v.responsavelCargo, hashTermo: d.pdfHash, hashFinal };
    reserva = await reservarDecisao(d.protocolo, registro);
    if (!reserva.ok) return jaRespondido(res, d, reserva.existente);

    // 4) E-mail ao doador (cópia ao CPDoc) com o PDF oficial em anexo
    const r = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: d.doadorEmail, name: d.doadorNome }],
        cc: [{ email: CPDOC_EMAIL }],
        replyTo: { name: SENDER_NAME, email: CPDOC_EMAIL },
        subject: `[MHFMUSP] ${t.assunto} — Protocolo ${d.protocolo}`,
        htmlContent: montarHtmlDoador(d, t, { ...registro, mensagem: v.mensagem }),
        attachment: [{ name: `Termo_Doacao_${d.protocolo}_${t.arquivo}.pdf`, content: pdfFinal.toString('base64') }]
      }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[responder] Brevo', r.status, JSON.stringify(data), d.protocolo);
      await liberarDecisao(reserva.url);
      return formulario(res, link, d, t, v, 'Falha ao enviar o e-mail. Nada foi registrado; tente novamente em instantes.', 502);
    }

    console.log('[responder]', d.acao, d.protocolo, data.messageId);
    try { await salvarFinal(d.protocolo, pdfFinal); }
    catch (e) { console.error('[responder] Falha ao arquivar PDF final (e-mail já enviado):', e.message); }

    return pagina(res, 200, `<p class="ok">✔ Resposta enviada</p>
      <p>O e-mail de decisão <b>${esc(t.status)}</b>, com o PDF oficial em anexo, foi enviado a ${esc(d.doadorEmail)}, com cópia para ${esc(CPDOC_EMAIL)}.</p>
      ${resumoTabela(d)}
      <table><tr><td>Responsável:</td><td>${esc(v.responsavelNome)} — ${esc(v.responsavelCargo)}</td></tr>
      <tr><td>Registrada em:</td><td>${esc(quando.texto)}</td></tr></table>
      <p style="font-size:12px;margin-bottom:4px">Hash SHA-256 do PDF final:</p><div class="hash">${esc(hashFinal)}</div>`);
  } catch (err) {
    console.error('[responder] Exceção', err);
    if (reserva?.ok) await liberarDecisao(reserva.url);
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return formulario(res, link, d, t, v,
      timeout ? 'Tempo esgotado no envio. Nada foi registrado; tente novamente.' : 'Erro interno. Nada foi registrado; tente novamente.',
      timeout ? 504 : 500);
  }
}
