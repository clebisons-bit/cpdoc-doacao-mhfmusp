import { criarLink, criarSessao, sessaoValida, senhaConfere } from './_token.js';
import { listarProtocolos } from './_storage.js';

const VALIDADE_LINK_MS = 30 * 24 * 60 * 60 * 1000; // igual ao responder.js

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dataBR = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(d);
};

const CSS = `
  body{font-family:Arial,sans-serif;background:#f3f4f6;margin:0;color:#111}
  .box{max-width:980px;margin:24px auto;background:#fff;border:1px solid #ddd;border-radius:6px;overflow:hidden}
  .top{background:#006747;border-bottom:4px solid #009CA6;color:#fff;padding:16px;display:flex;justify-content:space-between;align-items:center;gap:12px}
  .top h1{margin:0;font-size:16px}.top p{margin:4px 0 0;font-size:12px}
  .in{padding:20px;font-size:14px;line-height:1.5}
  h2{font-size:15px;color:#006747;margin:22px 0 8px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th{text-align:left;background:#f4f8f6;padding:8px;border-bottom:2px solid #cfe3da}
  td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}
  .proto{font-family:monospace;font-size:12px;color:#006747;font-weight:bold;word-break:break-all}
  .btn{display:inline-block;color:#fff;text-decoration:none;font-weight:bold;font-size:12px;padding:7px 12px;border-radius:4px;margin:0 4px 4px 0;border:0;cursor:pointer}
  input{width:100%;box-sizing:border-box;padding:9px;font:inherit;border:1px solid #bbb;border-radius:4px;margin:4px 0 12px}
  .erro{background:#fdecea;border:1px solid #f1b0aa;color:#8a1c14;padding:10px;font-size:13px;border-radius:4px;margin:12px 0}
  .vazio{color:#666;font-size:13px}
  .sair{background:transparent;border:1px solid #fff;color:#fff;font-size:12px;padding:6px 12px;border-radius:4px;cursor:pointer}
  .rolar{overflow-x:auto}`;

function pagina(res, status, corpo, { sair = false, estreita = false } = {}) {
  res.status(status).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Painel CPDoc — MHFMUSP</title><style>${CSS}${estreita ? '.box{max-width:420px}' : ''}</style></head><body>
<div class="box"><div class="top"><div><h1>MUSEU HISTÓRICO &quot;PROF. CARLOS DA SILVA LACAZ&quot; — FMUSP</h1>
<p>Painel do CPDoc — propostas de doação</p></div>
${sair ? '<form method="POST" action="/api/painel"><input type="hidden" name="sair" value="1" style="display:none"><button class="sair" type="submit">Sair</button></form>' : ''}
</div><div class="in">${corpo}</div></div></body></html>`);
}

const formLogin = (erro = '') => `
  <h2 style="margin-top:0">Entrar</h2>
  ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
  <form method="POST" action="/api/painel">
    <label for="s"><b>Senha da equipe do CPDoc</b></label>
    <input id="s" name="senha" type="password" required autocomplete="current-password" autofocus>
    <button class="btn" type="submit" style="background:#006747;font-size:14px;padding:10px 20px">Entrar</button>
  </form>`;

function tabelaPendentes(itens) {
  if (!itens.length) return '<p class="vazio">Nenhuma proposta aguardando resposta.</p>';
  const agora = Date.now();
  return `<div class="rolar"><table><tr><th>Protocolo</th><th>Doador</th><th>Bem</th><th>Recebido em</th><th>Responder</th></tr>
  ${itens.map(i => {
    const expirado = Date.parse(i.criadoEm) + VALIDADE_LINK_MS < agora;
    const acoes = expirado
      ? '<span class="vazio">Prazo de 30 dias esgotado</span>'
      : `<a class="btn" style="background:#006747" href="/api/responder?t=${esc(criarLink(i.protocolo, 'aceite'))}">Aceitar</a>` +
        `<a class="btn" style="background:#b3261e" href="/api/responder?t=${esc(criarLink(i.protocolo, 'recusa'))}">Recusar</a>`;
    return `<tr><td class="proto">${esc(i.protocolo)}</td><td>${esc(i.doadorNome)}<br><span class="vazio">${esc(i.doadorEmail)}</span></td>
      <td>${esc(i.bemNome)}</td><td>${esc(dataBR(i.criadoEm))}</td><td>${acoes}</td></tr>`;
  }).join('')}</table></div>`;
}

function tabelaRespondidos(itens) {
  if (!itens.length) return '<p class="vazio">Nenhuma resposta registrada ainda.</p>';
  return `<div class="rolar"><table><tr><th>Protocolo</th><th>Doador</th><th>Decisão</th><th>Registrada em</th><th>Responsável</th></tr>
  ${itens.map(i => `<tr><td class="proto">${esc(i.protocolo)}</td><td>${esc(i.doadorNome)}</td>
    <td><b style="color:${i.decisao.acao === 'aceite' ? '#006747' : '#b3261e'}">${i.decisao.acao === 'aceite' ? 'Aceita' : 'Não aceita'}</b></td>
    <td>${esc(i.decisao.dataHora)}</td><td>${esc(i.decisao.responsavelNome)}<br><span class="vazio">${esc(i.decisao.responsavelCargo)}</span></td></tr>`).join('')}</table></div>`;
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
    return pagina(res, 405, '<p class="erro">Método não permitido.</p>', { estreita: true });
  }

  try {
    // Sair
    if (req.method === 'POST' && req.body?.sair) {
      res.setHeader('Set-Cookie', 'cpdoc_sessao=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return pagina(res, 200, formLogin(), { estreita: true });
    }

    // Login
    if (req.method === 'POST') {
      if (!senhaConfere(req.body?.senha)) {
        await new Promise(r => setTimeout(r, 1000)); // atrasa tentativas por força bruta
        return pagina(res, 401, formLogin('Senha incorreta.'), { estreita: true });
      }
      const { valor, maxAge } = criarSessao();
      res.setHeader('Set-Cookie', `cpdoc_sessao=${valor}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
      res.setHeader('Location', '/api/painel');
      return res.status(303).end();
    }

    // Lista
    if (!sessaoValida(req.headers.cookie)) return pagina(res, 200, formLogin(), { estreita: true });

    const itens = await listarProtocolos(60);
    const pendentes = itens.filter(i => !i.decisao);
    const respondidos = itens.filter(i => i.decisao);
    return pagina(res, 200, `
      <h2 style="margin-top:0">Aguardando resposta (${pendentes.length})</h2>${tabelaPendentes(pendentes)}
      <h2>Respondidas (${respondidos.length})</h2>${tabelaRespondidos(respondidos)}
      <p class="vazio" style="margin-top:18px">Mostrando os 60 protocolos mais recentes.</p>`, { sair: true });
  } catch (e) {
    console.error('[painel]', e.message);
    return pagina(res, 500, '<p class="erro">Painel não configurado ou indisponível. Verifique CPDOC_PAINEL_SENHA, RESPONSE_SECRET e o armazenamento Blob.</p>', { estreita: true });
  }
}
