import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { protocol, donorName, donorEmail, itemName, pdfBase64 } = req.body;

  try {
    const cleanPdfBase64 = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;

    const data = await resend.emails.send({
      from: 'Museu Histórico FMUSP <onboarding@resend.dev>',
      to: ['cpdoc.museufm@usp.br'],
      cc: [donorEmail],
      reply_to: donorEmail,
      subject: `[CPDoc Doação] Novo Termo Protocolado: ${protocol} - ${donorName}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px;">
          <h2 style="color: #006747; border-bottom: 3px solid #009CA6; padding-bottom: 8px;">
            Novo Termo de Doação de Acervo Submetido
          </h2>
          <p>Prezada equipe do CPDoc,</p>
          <p>Uma nova proposta de doação de acervo foi preenchida e assinada eletronicamente através do formulário institucional:</p>
          <ul>
            <li><strong>Protocolo:</strong> ${protocol}</li>
            <li><strong>Doador:</strong> ${donorName}</li>
            <li><strong>E-mail do Doador:</strong> ${donorEmail}</li>
            <li><strong>Denominação do Bem:</strong> ${itemName}</li>
          </ul>
          <p>O <strong>Termo de Doação oficial em formato PDF</strong>, contendo as declarações, o certificado de integridade SHA-256 e o carimbo de data/hora, encontra-se anexado a esta mensagem para análise da curadoria.</p>
          <br>
          <small style="color: #64748b;">MUSEU HISTÓRICO "PROF. CARLOS DA SILVA LACAZ" — FMUSP</small>
        </div>
      `,
      attachments: [
        {
          filename: `Termo_Doacao_${protocol}.pdf`,
          content: cleanPdfBase64
        }
      ]
    });

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Erro ao disparar e-mail:', error);
    return res.status(500).json({ error: error.message });
  }
}
