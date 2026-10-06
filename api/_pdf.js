// Acrescenta ao PDF original do termo a(s) página(s) de decisão do Museu.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const VERDE = rgb(0, 0.404, 0.278);      // #006747
const TEAL = rgb(0, 0.612, 0.651);       // #009CA6
const VERMELHO = rgb(0.702, 0.149, 0.118); // #b3261e
const PRETO = rgb(0.07, 0.07, 0.07);
const CINZA = rgb(0.35, 0.35, 0.35);
const LINHA = rgb(0.8, 0.8, 0.8);

const W = 595.28, H = 841.89, M = 50, VX = M + 150, LARG_VALOR = W - M - VX;

/**
 * @param {Buffer|Uint8Array} pdfBytes  PDF original do termo
 * @param {object} d  { aceite:boolean, protocolo, bemNome, doadorNome, doadorEmail, dataHora,
 *                      responsavelNome, responsavelCargo, mensagem, rotuloMensagem, hashTermo, emailInstitucional }
 * @returns {Promise<Uint8Array>}
 */
export async function anexarDecisao(pdfBytes, d) {
  const pdf = await PDFDocument.load(pdfBytes);
  const paginasOriginais = pdf.getPageCount();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

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

  let page, y;
  const nova = (primeira) => {
    page = pdf.addPage([W, H]);
    if (primeira) {
      page.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: VERDE });
      page.drawRectangle({ x: 0, y: H - 78, width: W, height: 4, color: TEAL });
      page.drawText(limpa('MUSEU HISTÓRICO "PROF. CARLOS DA SILVA LACAZ" — FMUSP'), { x: M, y: H - 34, size: 12, font: bold, color: rgb(1, 1, 1) });
      page.drawText(limpa('Centro de Pesquisa e Documentação (CPDoc) — Decisão sobre a proposta de doação'), { x: M, y: H - 52, size: 9, font: reg, color: rgb(1, 1, 1) });
      y = H - 108;
    } else {
      page.drawText(limpa(`Decisão sobre a proposta de doação — Protocolo ${d.protocolo} (continuação)`), { x: M, y: H - 40, size: 9, font: bold, color: VERDE });
      y = H - 70;
    }
  };
  const garantir = h => { if (y - h < 60) nova(false); };

  nova(true);

  // Faixa de decisão
  const cor = d.aceite ? VERDE : VERMELHO;
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 34, color: cor });
  const titulo = d.aceite ? 'PROPOSTA DE DOAÇÃO ACEITA' : 'PROPOSTA DE DOAÇÃO NÃO ACEITA';
  page.drawText(limpa(titulo), { x: M + 14, y: y - 23, size: 14, font: bold, color: rgb(1, 1, 1) });
  y -= 56;

  const campo = (rotulo, valor, { font = reg, size = 10, destaque = false } = {}) => {
    const linhas = quebrar(valor || '—', font, size, LARG_VALOR);
    garantir(linhas.length * (size + 4) + 8);
    page.drawText(limpa(rotulo + ':'), { x: M, y, size: 9.5, font: bold, color: PRETO });
    linhas.forEach((l, i) => {
      page.drawText(l, { x: VX, y: y - i * (size + 4), size, font, color: destaque ? VERDE : PRETO });
    });
    y -= linhas.length * (size + 4) + 6;
  };

  campo('Protocolo', d.protocolo, { font: bold, destaque: true });
  campo('Bem proposto', d.bemNome);
  campo('Doador', d.doadorNome);
  campo('E-mail do doador', d.doadorEmail);
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINHA });
  y -= 18;
  campo('Decisão registrada em', d.dataHora);
  campo('Responsável', d.responsavelNome, { font: bold });
  campo('Cargo/função', d.responsavelCargo);
  campo('Registro realizado via', `Caixa institucional ${d.emailInstitucional}`);

  // Justificativa / orientações
  y -= 6;
  garantir(60);
  page.drawText(limpa(d.rotuloMensagem + ':'), { x: M, y, size: 10, font: bold, color: cor });
  y -= 16;
  const texto = d.mensagem || (d.aceite ? 'Sem orientações adicionais.' : '—');
  for (const l of quebrar(texto, reg, 10, W - 2 * M - 14)) {
    garantir(16);
    page.drawRectangle({ x: M, y: y - 4, width: 3, height: 15, color: TEAL });
    page.drawText(l, { x: M + 12, y, size: 10, font: reg, color: PRETO });
    y -= 14;
  }

  // Integridade e aviso
  y -= 14;
  garantir(110);
  page.drawText('Hash SHA-256 do termo original (páginas anteriores):', { x: M, y, size: 8.5, font: bold, color: CINZA });
  y -= 13;
  for (const l of quebrar(d.hashTermo, mono, 8.5, W - 2 * M)) {
    page.drawText(l, { x: M, y, size: 8.5, font: mono, color: CINZA });
    y -= 11;
  }
  y -= 8;
  const aviso = 'Esta página integra o Termo de Doação do protocolo acima e registra a decisão do Museu Histórico ' +
    '"Prof. Carlos da Silva Lacaz" da FMUSP, lançada eletronicamente pelo CPDoc mediante acesso à caixa institucional. ' +
    'O hash identifica o conteúdo do termo original no momento do envio pelo doador. O nome e o cargo do responsável ' +
    'foram informados no ato do registro; data e hora foram gerados pelo servidor.';
  for (const l of quebrar(aviso, reg, 8, W - 2 * M)) {
    garantir(12);
    page.drawText(l, { x: M, y, size: 8, font: reg, color: CINZA });
    y -= 11;
  }

  // Rodapé nas páginas acrescentadas
  const total = pdf.getPageCount();
  for (let i = paginasOriginais; i < total; i++) {
    pdf.getPage(i).drawText(
      limpa(`${d.protocolo} — Decisão do Museu (página ${i - paginasOriginais + 1} de ${total - paginasOriginais})`),
      { x: W / 2 - 110, y: 24, size: 8, font: reg, color: CINZA });
  }
  return pdf.save();
}
