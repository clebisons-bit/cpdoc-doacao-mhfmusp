const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { 
      protocolo, 
      doadorNome, 
      doadorEmail, 
      bemNome, 
      pdfBase64,
      anexosExtras = []
    } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'PDF não encontrado' });
    }

    // Monta o Termo em PDF + arquivos do doador como anexos
    const attachments = [
      {
        filename: `Termo_Doacao_${protocolo}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
      },
      ...anexosExtras.map((anexo) => ({
        filename: anexo.filename,
        content: Buffer.from(anexo.base64, 'base64'),
      }))
    ];

    // Envio para o CPDoc
    const data = await resend.emails.send({
      from: 'MHFMUSP Doações <onboarding@resend.dev>',
      to: ['cpdoc.museufm@usp.br'],
      reply_to: doadorEmail,
      subject: `[CPDoc MHFMUSP] Nova Proposta de Doação — Protocolo ${protocolo}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111; max-width: 600px;">
          <div style="background-color: #006747; padding: 16px; border-bottom: 4px solid #009CA6; color: #fff;">
            <h2 style="margin: 0; font-size: 16px;">MUSEU HISTÓRICO "PROF. CARLOS DA SILVA LACAZ" — FMUSP</h2>
            <p style="margin: 4px 0 0; font-size: 12px;">Centro de Pesquisa e Documentação (CPDoc)</p>
          </div>
          <div style="padding: 18px; border: 1px solid #ddd; border-top: none;">
            <p style="font-size: 14px; font-weight: bold; color: #006747;">
              Nova proposta de doação de acervo recebida pela plataforma web.
            </p>
            <p style="font-size: 13px;"><strong>Protocolo:</strong> ${protocolo}</p>
            <p style="font-size: 13px;"><strong>Doador:</strong> ${doadorNome}</p>
            <p style="font-size: 13px;"><strong>E-mail:</strong> ${doadorEmail}</p>
            <p style="font-size: 13px;"><strong>Item:</strong> ${bemNome}</p>
            <p style="font-size: 12px; color: #555; margin-top: 16px;">
              O Termo assinado digitalmente em PDF e todos os documentos/fotos anexados estão disponíveis nos anexos desta mensagem.
            </p>
          </div>
        </div>
      `,
      attachments: attachments
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro Resend:', error);
    return res.status(500).json({ error: error.message });
  }
};
