import { PDFDocument, PDFName, PDFImage, rgb, StandardFonts } from 'pdf-lib';

// Sanitiza caracteres para a codificação WinAnsi do Helvetica
const sanitizar = s => String(s ?? '')
  .replace(/[–—]/g, '-')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[^\n\x20-\x7E\u00A0-\u00FF]/g, '?');

// Divide o texto por linhas respeitando a largura disponível
function formatarLinhas(texto, font, size, maxWidth) {
  const limpo = sanitizar(texto);
  const paragrafos = limpo.replace(/\r\n/g, '\n').split('\n');
  const todasLinhas = [];

  for (const par of paragrafos) {
    const pTrim = par.trim();
    if (!pTrim) {
      todasLinhas.push('');
      continue;
    }
    const palavras = pTrim.split(/\s+/);
    let linhaAtual = '';
    for (const p of palavras) {
      if (!p) continue;
      const teste = linhaAtual ? `${linhaAtual} ${p}` : p;
      if (font.widthOfTextAtSize(teste, size) <= maxWidth) {
        linhaAtual = teste;
      } else {
        if (linhaAtual) todasLinhas.push(linhaAtual);
        linhaAtual = p;
      }
    }
    if (linhaAtual) todasLinhas.push(linhaAtual);
  }
  return todasLinhas.length > 0 ? todasLinhas : [''];
}

// Localiza no documento original a imagem do cabeçalho institucional (proporção 7:1)
function localizarCabecalhoOriginal(pdfDoc) {
  try {
    const paginas = pdfDoc.getPages();
    for (const pag of paginas) {
      const res = pag.node.Resources();
      if (!res) continue;
      const xObj = res.lookup(PDFName.of('XObject'));
      if (!xObj || typeof xObj.entries !== 'function') continue;

      for (const [, ref] of xObj.entries()) {
        const stream = pdfDoc.context.lookup(ref);
        if (!stream || typeof stream.lookup !== 'function') continue;
        const sub = stream.lookup(PDFName.of('Subtype'));
        if (sub?.toString() !== '/Image') continue;

        const w = stream.lookup(PDFName.of('Width'))?.numberValue;
        const h = stream.lookup(PDFName.of('Height'))?.numberValue;
        if (w && h && Math.abs((w / h) - 7) < 0.6) {
          return PDFImage.of(ref, pdfDoc);
        }
      }
    }
  } catch (e) {
    console.warn('[pdf-lib] Não foi possível reutilizar o cabeçalho original:', e.message);
  }
  return null;
}

export async function anexarDecisao(termoBuffer, dados) {
  const pdfDoc = await PDFDocument.load(termoBuffer);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  // Reaproveita o elemento gráfico do cabeçalho das páginas anteriores
  const imgCabecalho = localizarCabecalhoOriginal(pdfDoc);

  // Dimensões A4 em pontos (1 mm = 2.83464567 pt)
  const PT_MM = 2.83464567;
  const PAGE_W = 210 * PT_MM;
  const PAGE_H = 297 * PT_MM;
  const MARGEM_X = 14 * PT_MM;
  const CONTEUDO_W = 182 * PT_MM;
  const COL_LABEL_W = 72 * PT_MM;
  const COL_VALOR_X = MARGEM_X + 76 * PT_MM;
  const COL_VALOR_W = CONTEUDO_W - (76 * PT_MM);
  const LIMITE_Y_RODAPE = 45 * PT_MM;

  // Cores Institucionais FMUSP
  const COR_PANTONE342 = rgb(0, 0.404, 0.278); // #006747
  const COR_PANTONE3265 = rgb(0, 0.780, 0.694); // #00C7B1
  const COR_TEXTO_LABEL = rgb(0, 0.314, 0.216); // #005037
  const COR_TEXTO_VALOR = rgb(0.1, 0.1, 0.1);
  const COR_ZEBRA_PAR = rgb(0.941, 0.973, 0.969);
  const COR_ZEBRA_IMPAR = rgb(0.957, 0.973, 0.961);
  const COR_RODAPE = rgb(0.431, 0.431, 0.431);

  let pagina = null;
  let yAtual = 0;
  let numeroFolhaDecisao = 0;
  const paginasDecisao = [];

  function criarNovaPagina() {
    numeroFolhaDecisao++;
    pagina = pdfDoc.addPage([PAGE_W, PAGE_H]);
    paginasDecisao.push(pagina);

    // 1. Cabeçalho Institucional Oficial (0 a 30 mm do topo)
    const hCabecalho = 30 * PT_MM;
    const yCabecalho = PAGE_H - hCabecalho;

    if (imgCabecalho) {
      pagina.drawImage(imgCabecalho, {
        x: 0,
        y: yCabecalho,
        width: PAGE_W,
        height: hCabecalho
      });
    } else {
      pagina.drawRectangle({
        x: 0,
        y: yCabecalho,
        width: PAGE_W,
        height: hCabecalho,
        color: COR_PANTONE342
      });
      pagina.drawRectangle({
        x: 0,
        y: yCabecalho,
        width: PAGE_W,
        height: 2.2,
        color: COR_PANTONE3265
      });
      pagina.drawText('Faculdade de Medicina da Universidade de São Paulo', {
        x: MARGEM_X,
        y: yCabecalho + 19 * PT_MM,
        size: 8.5,
        font: fontRegular,
        color: rgb(1, 1, 1)
      });
      pagina.drawText('MUSEU HISTÓRICO "PROF. CARLOS DA SILVA LACAZ"', {
        x: MARGEM_X,
        y: yCabecalho + 12 * PT_MM,
        size: 11,
        font: fontBold,
        color: rgb(1, 1, 1)
      });
      pagina.drawText('Centro de Pesquisa e Documentação - CPDoc | TERMO DE DOAÇÃO DE ACERVO', {
        x: MARGEM_X,
        y: yCabecalho + 6 * PT_MM,
        size: 8,
        font: fontRegular,
        color: rgb(1, 1, 1)
      });
    }

    yAtual = yCabecalho - 4 * PT_MM;

    // 2. Barra de Protocolo e Data/Hora
    if (numeroFolhaDecisao === 1) {
      const hBarra = 7 * PT_MM;
      yAtual -= hBarra;
      pagina.drawRectangle({
        x: MARGEM_X,
        y: yAtual,
        width: CONTEUDO_W,
        height: hBarra,
        color: rgb(0.949, 0.973, 0.965)
      });

      pagina.drawText(sanitizar(`PROTOCOLO: ${dados.protocolo}`), {
        x: MARGEM_X + 8,
        y: yAtual + 6.5,
        size: 8.5,
        font: fontBold,
        color: COR_PANTONE342
      });

      const txtData = sanitizar(`Data e Hora: ${dados.dataHora}`);
      const wData = fontRegular.widthOfTextAtSize(txtData, 7.5);
      pagina.drawText(txtData, {
        x: MARGEM_X + CONTEUDO_W - wData - 8,
        y: yAtual + 6.5,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.3, 0.3, 0.3)
      });

      yAtual -= 4 * PT_MM;
    }

    // 3. Banner da Secção 7 (idêntico às secções anteriores)
    const hBannerSecao = 8 * PT_MM;
    yAtual -= hBannerSecao;
    pagina.drawRectangle({
      x: MARGEM_X,
      y: yAtual,
      width: CONTEUDO_W,
      height: hBannerSecao,
      color: COR_PANTONE342
    });
    pagina.drawRectangle({
      x: MARGEM_X,
      y: yAtual,
      width: CONTEUDO_W,
      height: 2,
      color: COR_PANTONE3265
    });
    pagina.drawText(
      numeroFolhaDecisao === 1
        ? '7. DELIBERAÇÃO CURATORIAL E DECISÃO FINAL DO MUSEU'
        : '7. DELIBERAÇÃO CURATORIAL E DECISÃO FINAL (CONTINUAÇÃO)',
      {
        x: MARGEM_X + 10,
        y: yAtual + 7,
        size: 8.5,
        font: fontBold,
        color: rgb(1, 1, 1)
      }
    );

    yAtual -= 4 * PT_MM;
  }

  function garantirEspaco(alturaNecessaria) {
    if (!pagina || yAtual - alturaNecessaria < LIMITE_Y_RODAPE) {
      criarNovaPagina();
    }
  }

  criarNovaPagina();

  // 4. Painel de Parecer da Decisão (Aceite ou Recusa)
  const isAceite = Boolean(dados.aceite);
  const corStatusFundo = isAceite ? rgb(0.92, 0.965, 0.94) : rgb(0.99, 0.925, 0.92);
  const corStatusBorda = isAceite ? COR_PANTONE342 : rgb(0.702, 0.149, 0.118);
  const corStatusTexto = isAceite ? rgb(0, 0.35, 0.22) : rgb(0.65, 0.1, 0.1);

  const hBoxStatus = 13 * PT_MM;
  garantirEspaco(hBoxStatus + 4 * PT_MM);
  yAtual -= hBoxStatus;

  pagina.drawRectangle({
    x: MARGEM_X,
    y: yAtual,
    width: CONTEUDO_W,
    height: hBoxStatus,
    color: corStatusFundo
  });
  pagina.drawRectangle({
    x: MARGEM_X,
    y: yAtual,
    width: 4 * PT_MM,
    height: hBoxStatus,
    color: corStatusBorda
  });

  const rotuloStatus = isAceite
    ? 'PARECER: PROPOSTA DE DOAÇÃO ACEITA'
    : 'PARECER: PROPOSTA DE DOAÇÃO NÃO ACEITA';
  const subStatus = isAceite
    ? 'Decisão favorável à incorporação definitiva ao acervo do Museu Histórico FMUSP.'
    : 'Manifestação técnica fundamentada de não incorporação ao acervo institucional.';

  pagina.drawText(sanitizar(rotuloStatus), {
    x: MARGEM_X + 7 * PT_MM,
    y: yAtual + 7.5 * PT_MM,
    size: 10,
    font: fontBold,
    color: corStatusTexto
  });
  pagina.drawText(sanitizar(subStatus), {
    x: MARGEM_X + 7 * PT_MM,
    y: yAtual + 3.2 * PT_MM,
    size: 7.5,
    font: fontRegular,
    color: corStatusTexto
  });

  yAtual -= 3 * PT_MM;

  // 5. Linhas de Dados com Faixas Zebradas Alternadas
  const itens = [
    { r: 'Protocolo', v: dados.protocolo },
    { r: 'Denominação do bem', v: dados.bemNome },
    { r: 'Doador', v: dados.doadorNome },
    { r: 'E-mail do doador', v: dados.doadorEmail },
    { r: 'Decisão registrada em', v: dados.dataHora },
    { r: 'Responsável técnico', v: `${dados.responsavelNome} — ${dados.responsavelCargo}` },
    { r: 'Canal de registro', v: `Caixa institucional ${dados.emailInstitucional}` },
    { r: dados.rotuloMensagem || (isAceite ? 'Orientações para os próximos passos' : 'Justificativa da recusa'), v: dados.mensagem || 'Conforme deliberação do CPDoc/MHFMUSP.' },
    { r: 'Hash SHA-256 do termo original', v: dados.hashTermo, mono: true }
  ];

  itens.forEach((item, idx) => {
    const lnsLabel = formatarLinhas(item.r, fontBold, 8, COL_LABEL_W - 8);
    const lnsValor = formatarLinhas(item.v, item.mono ? fontCourier : fontRegular, item.mono ? 7 : 8, COL_VALOR_W - 8);

    const maxLinhas = Math.max(lnsLabel.length, lnsValor.length);
    const rowH = Math.max(6 * PT_MM, maxLinhas * 10.5 + 8);

    garantirEspaco(rowH);
    yAtual -= rowH;

    pagina.drawRectangle({
      x: MARGEM_X,
      y: yAtual,
      width: CONTEUDO_W,
      height: rowH,
      color: (idx % 2 === 0) ? COR_ZEBRA_PAR : COR_ZEBRA_IMPAR
    });

    lnsLabel.forEach((l, i) => {
      pagina.drawText(l, {
        x: MARGEM_X + 8,
        y: yAtual + rowH - 12 - (i * 10.5),
        size: 8,
        font: fontBold,
        color: COR_TEXTO_LABEL
      });
    });

    lnsValor.forEach((l, i) => {
      pagina.drawText(l, {
        x: COL_VALOR_X,
        y: yAtual + rowH - 12 - (i * 10.5),
        size: item.mono ? 7 : 8,
        font: item.mono ? fontCourier : fontRegular,
        color: COR_TEXTO_VALOR
      });
    });
  });

  // 6. Nota de Enquadramento Institucional e Jurídico
  const txtNota = 'Esta folha de deliberação integra o Termo de Doação de Acervo do protocolo indicado e formaliza a decisão soberana da Coordenação e Curadoria Científica do Museu Histórico "Prof. Carlos da Silva Lacaz" da Faculdade de Medicina da Universidade de São Paulo (FMUSP), lançada eletronicamente pelo Centro de Pesquisa e Documentação (CPDoc) mediante acesso à caixa institucional autenticada. O hash SHA-256 identifica e garante a conformidade e integridade plena do termo original submetido pelo doador. A assinatura e a deliberação possuem plena eficácia jurídica nos termos da Lei nº 14.063/2020 e da Medida Provisória nº 2.200-2/2001.';
  const lnsNota = formatarLinhas(txtNota, fontRegular, 6.5, CONTEUDO_W);
  const hNota = lnsNota.length * 8.5 + 10;

  garantirEspaco(hNota);
  yAtual -= 3 * PT_MM;

  lnsNota.forEach((l, i) => {
    pagina.drawText(l, {
      x: MARGEM_X,
      y: yAtual - (i * 8.5),
      size: 6.5,
      font: fontRegular,
      color: rgb(0.35, 0.35, 0.35)
    });
  });

  // 7. Rodapé Padronizado a 7 mm da borda inferior
  const totalPaginasFinal = pdfDoc.getPageCount();
  const inicioIndiceDecisao = totalPaginasFinal - paginasDecisao.length;

  paginasDecisao.forEach((pag, i) => {
    const numPagAtual = inicioIndiceDecisao + i + 1;
    const txtRodape = sanitizar(
      `${dados.protocolo} — Folha de Decisão do Museu (Página ${numPagAtual} de ${totalPaginasFinal})`
    );
    const wRodape = fontRegular.widthOfTextAtSize(txtRodape, 7);
    const xRodape = (PAGE_W - wRodape) / 2;

    pag.drawText(txtRodape, {
      x: xRodape,
      y: 7 * PT_MM,
      size: 7,
      font: fontRegular,
      color: COR_RODAPE
    });
  });

  return await pdfDoc.save();
}
