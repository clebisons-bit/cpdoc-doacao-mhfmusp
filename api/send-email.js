export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'A variável RESEND_API_KEY não foi configurada na Vercel.' });
    }

    const {
      protocolo,
      doadorNome,
      doadorEmail,
      bemNome,
      pdfBase64,
      anexosExtras
    } = req.body || {};

    const attachments = [];

    // 1. Termo em PDF
    if (pdfBase64) {
      attachments.push({
        filename: `Termo_Doacao_${protocolo || 'CPDoc'}.pdf`,
        content: pdfBase64
      });
    }

    // 2. Anexos extras (documentos, fotos)
    if (Array.isArray(anexosExtras)) {
      for (const item of anexosExtras) {
        if (item && item.filename && item.base64) {
          attachments.push({
            filename: item.filename,
            content: item.base64
          });
        }
      }
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #111; max-width: 600px; line-height: 1.5;">
        <div style="background-color: #006747; padding: 16px; border-bottom: 4px solid #009CA6; color: #fff;">
          <h2 style="margin: 0; font-size: 16px;">MUSEU HISTÓRICO &quot;PROF. CARLOS DA SILVA LACAZ&quot; — FMUSP</h2>
          <p style="margin: 4px 0 0; font-size: 12px;">Centro de Pesquisa e Documentação (CPDoc)</p>
        </div>
        <div style="padding: 18px; border: 1px solid #ddd; border-top: none;">
          <p style="font-size: 14px; font-weight: bold; color: #006747;">Nova proposta de doação de acervo recebida pela plataforma web.</p>
          <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin: 12px 0;">
            <tr><td style="padding: 4px 0; font-weight: bold; width: 140px;">Protocolo:</td><td style="color: #006747; font-weight: bold;">${protocolo || 'SEM-PROTOCOLO'}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: bold;">Doador:</td><td>${doadorNome || 'Não informado'}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: bold;">E-mail do Doador:</td><td>${doadorEmail || 'Não informado'}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: bold;">Denominação do Bem:</td><td>${bemNome || 'Não informado'}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: bold;">Total de Anexos:</td><td>${attachments.length} arquivo(s)</td></tr>
          </table>
          <p style="font-size: 12px; color: #555; margin-top: 14px;">O Termo assinado em PDF e todos os documentos/fotos seguem em anexo nesta mensagem.</p>
        </div>
      </div>
    `;

    const resendPayload = {
      from: 'CPDoc MHFMUSP <onboarding@resend.dev>',
      to: ['cpdoc.museufmusp@usp.br', 'cpdoc.museufm@usp.br'],
      reply_to: doadorEmail || 'cpdoc.museufmusp@usp.br',
      subject: `[CPDoc MHFMUSP] Nova Proposta de Doação — Protocolo ${protocolo || ''}`,
      html: htmlContent,
      attachments: attachments
    };

    // Chamada direta para a API REST da Resend via fetch nativo do Node.js
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CPDoc-MHFMUSP/1.0'
      },
      body: JSON.stringify(resendPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ success: true, data });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
