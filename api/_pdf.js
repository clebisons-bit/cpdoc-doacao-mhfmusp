// Acrescenta ao PDF original do termo a(s) página(s) de decisão do Museu,
// no mesmo padrão visual do termo (banner com logo, barra de seção, tabela e rodapé).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { BANNER_JPG_BASE64, BANNER_PROPORCAO } from './_banner.js';
import { BARRAS_SECAO_PNG_BASE64, BARRA_PROPORCAO, FAIXAS_DECISAO_PNG_BASE64, FAIXA_PROPORCAO } from './_barras.js';

const VERDE = rgb(0, 0.404, 0.278);          // #006747
const TEAL = rgb(0, 0.78, 0.694);            // #00C7B1 (linha sob as barras e o banner)
const VERMELHO = rgb(0.702, 0.149, 0.118);   // #b3261e
const PRETO = rgb(0.1, 0.1, 0.1);
const CINZA = rgb(0.4, 0.4, 0.4);
const LINHA = rgb(0.86, 0.9, 0.89);
const FUNDO_LINHA = rgb(0.953, 0.973, 0.965);
const BRANCO = rgb(1, 1, 1);

const W = 595.28, H = 841.89;
const ML = 39.7;                 // margem lateral (mesma do termo)
const CW = W - 2 * ML;           // largura útil
const VX = 255.1;                // coluna dos valores (mesma da pág. 3 do termo)
const LARG_VALOR = W - ML - 8 - VX;
const ALT_BANNER = W * BANNER_PROPORCAO;
const TOPO = H - ALT_BANNER - 24;   // início do conteúdo
const BASE = 56;                    // limite inferior do conteúdo

// Reescreve "Página X de 3" das páginas do termo para "de N" (cosmético; não altera o conteúdo).
const ATUALIZAR_RODAPE_ORIGINAL = true;

export async function anexarDecisao(pdfBytes, d) {
  const pdf = await PDFDocument.load(pdfBytes);
  const paginasOriginais = pdf.getPageCount();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const banner = await pdf.embedJpg(Buffer.from(BANNER_JPG_BASE64, 'base64'));
  const faixas = {
    aceita: await pdf.embedPng(Buffer.from(FAIXAS_DECISAO_PNG_BASE64.aceita, 'base64')),
    naoAceita: await pdf.embedPng(Buffer.from(FAIXAS_DECISAO_PNG_BASE64.naoAceita, 'base64')),
  };
  const barras = {};
  for (const [k, b64] of Object.entries(BARRAS_SECAO_PNG_BASE64)) barras[k] = await pdf.embedPng(Buffer.from(b64, 'base64'));

  // Fontes padrão só aceitam WinAnsi (acentos do português OK); o resto vira "?" em vez de quebrar o PDF.
  const aceitos = new Set(reg.getCharacterSet());
  const limpa = s => Array.from(String(s ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .map(c => (c === '\n' || aceitos.has(c.codePointAt(0)) ? c : '?')).join('');

  function quebrar(texto, font, size, maxW) {
    const linhas = [];
    for (const par of limpa(texto).split('\n')) {
      let atual = '';
      for (const palavra of par.split(/ +/)) {
        let p = palavra;
        while (font.widthOfTextAtSize(p, size) > maxW) { // palavra/hash maior que a linha
          let i = p.length;
          while (i > 1 && font.widthOfTextAtSize(p.slice(0, i), size) > maxW) i--;
          if (atual) { linhas.push(atual); atual = ''; }
          linhas.push(p.slice(0, i));
          p = p.slice(i);
        }
        const t = atual ? `${atual} ${p}` : p;
        if (font.widthOfTextAtSize(t, size) <= maxW) atual = t;
        else { linhas.push(atual); atual = p; }
      }
      linhas.push(atual);
    }
    return linhas;
  }

  let page, y, zebra = 0;
  const nova = () => {
    page = pdf.addPage([W, H]);
    page.drawImage(banner, { x: 0, y: H - ALT_BANNER, width: W, height: ALT_BANNER });
    y = TOPO;
    zebra = 0;
  };
  const garantir = h => { if (y - h < BASE) nova(); };

  function barraSecao(chave) {
    const h = CW * BARRA_PROPORCAO;
    garantir(h + 20);
    page.drawImage(barras[chave], { x: ML, y: y - h, width: CW, height: h });
    y -= h;
    zebra = 0;
  }

  function linhaTabela(rotulo, valor, { font = reg, destaque = false } = {}) {
    const size = 8.5, lh = 11;
    const linhas = quebrar(valor || '—', font, size, LARG_VALOR);
    const h = Math.max(17.6, linhas.length * lh + 7);
    garantir(h);
    if (zebra++ % 2 === 0) page.drawRectangle({ x: ML, y: y - h, width: CW, height: h, color: FUNDO_LINHA });
    page.drawLine({ start: { x: ML, y: y - h }, end: { x: ML + CW, y: y - h }, thickness: 0.4, color: LINHA });
    page.drawText(limpa(rotulo), { x: ML + 8, y: y - 12, size, font: bold, color: VERDE });
    linhas.forEach((l, i) => {
      page.drawText(l, { x: VX, y: y - 12 - i * lh, size, font, color: destaque ? VERDE : PRETO });
    });
    y -= h;
  }

  nova();

  // Faixa do protocolo (igual à da pág. 1 do termo)
  page.drawRectangle({ x: ML, y: y - 22, width: CW, height: 22, color: rgb(0.945, 0.96, 0.955) });
  page.drawText(limpa(`PROTOCOLO: ${d.protocolo}`), { x: ML + 14, y: y - 15, size: 9, font: bold, color: VERDE });
  const dh = limpa(`Data e Hora: ${d.dataHora}`);
  page.drawText(dh, { x: ML + CW - 14 - reg.widthOfTextAtSize(dh, 8.5), y: y - 15, size: 8.5, font: reg, color: CINZA });
  y -= 22 + 16;

  barraSecao('decisao');

  // Resultado da decisão
  const cor = d.aceite ? VERDE : VERMELHO;
  y -= 10;
  const hFaixa = CW * FAIXA_PROPORCAO;
  page.drawImage(d.aceite ? faixas.aceita : faixas.naoAceita, { x: ML, y: y - hFaixa, width: CW, height: hFaixa });
  y -= hFaixa + 8;

  linhaTabela('Protocolo', d.protocolo, { font: bold, destaque: true });
  linhaTabela('Bem proposto', d.bemNome);
  linhaTabela('Doador', d.doadorNome);
  linhaTabela('E-mail do doador', d.doadorEmail);
  linhaTabela('Decisão registrada em', d.dataHora);
  linhaTabela('Responsável', d.responsavelNome, { font: bold });
  linhaTabela('Cargo/função', d.responsavelCargo);
  linhaTabela('Registro realizado via', `Caixa institucional ${d.emailInstitucional}`);

  // Justificativa / orientações
  y -= 16;
  garantir(60);
  page.drawText(limpa(d.rotuloMensagem + ':'), { x: ML, y, size: 9.5, font: bold, color: cor });
  y -= 15;
  const texto = d.mensagem || (d.aceite ? 'Sem orientações adicionais.' : '—');
  for (const l of quebrar(texto, reg, 9, CW - 14)) {
    garantir(16);
    page.drawRectangle({ x: ML, y: y - 4, width: 3, height: 14, color: TEAL });
    page.drawText(l, { x: ML + 12, y, size: 9, font: reg, color: PRETO });
    y -= 13;
  }

  // Integridade
  y -= 18;
  garantir(40);
  barraSecao('integridade');
  y -= 10;
  garantir(60);
  page.drawText('Hash SHA-256 do termo original (páginas anteriores):', { x: ML, y, size: 8.5, font: bold, color: CINZA });
  y -= 13;
  for (const l of quebrar(d.hashTermo, mono, 8.5, CW)) {
    page.drawText(l, { x: ML, y, size: 8.5, font: mono, color: CINZA });
    y -= 11;
  }
  y -= 10;
  const aviso = 'Esta página integra o Termo de Doação do protocolo acima e registra a decisão do Museu Histórico ' +
    '"Prof. Carlos da Silva Lacaz" da FMUSP, lançada eletronicamente pelo CPDoc mediante acesso à caixa institucional. ' +
    'O hash identifica o conteúdo do termo original no momento do envio pelo doador. O nome e o cargo do responsável ' +
    'foram informados no ato do registro; data e hora foram gerados pelo servidor.';
  for (const l of quebrar(aviso, reg, 7.5, CW)) {
    garantir(12);
    page.drawText(l, { x: ML, y, size: 7.5, font: reg, color: CINZA });
    y -= 10.5;
  }

  // Rodapé: "PROTOCOLO — Página X de N", centralizado, como no termo
  const total = pdf.getPageCount();
  const rodape = (pg, i) => {
    const t = limpa(`${d.protocolo} — Página ${i + 1} de ${total}`);
    pg.drawText(t, { x: (W - reg.widthOfTextAtSize(t, 7.5)) / 2, y: 18, size: 7.5, font: reg, color: CINZA });
  };
  for (let i = paginasOriginais; i < total; i++) rodape(pdf.getPage(i), i);
  if (ATUALIZAR_RODAPE_ORIGINAL) {
    for (let i = 0; i < paginasOriginais; i++) {
      const pg = pdf.getPage(i);
      pg.drawRectangle({ x: 120, y: 13, width: W - 240, height: 14, color: BRANCO });
      rodape(pg, i);
    }
  }
  return pdf.save();
}
