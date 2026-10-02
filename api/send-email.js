import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

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
      return res.status(400).json({ error: 'Documento PDF não fornecido' });
    }

    // Lista consolidada de anexos (Termo em PDF + Ficheiros enviados pelo doador)
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

    // Disparo oficial para o CPDoc
    const data = await resend.emails.send({
      from: 'MHFMUSP Doações <onboarding@resend.dev>',
      to: ['cpdoc.museufm@usp.br'],
      reply_to: doadorEmail,
      subject: `[CPDoc MHFMUSP] Nova Proposta de Doação de Acervo — Protocolo ${protocolo}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111; max-width: 600px; line-height: 1.5;">
          <div style="background-color: #006747; padding: 16px; border-bottom: 4px solid #009CA6; color: #fff;">
            <h2 style="margin: 0; font-size: 18px;">MUSEU HISTÓRICO "PROF. CARLOS DA SILVA LACAZ" — FMUSP</h2>
            <p style="margin: 4px 0 0 0; font-size: 13px;">Centro de Pesquisa e Documentação (CPDoc)</p>
          </div>
          
          <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 15px; font-weight: bold; color: #006747;">
              Nova submissão eletrónica de Termo de Doação de Acervo recebida pela plataforma web.
            </p>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 15px 0;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold; width: 140px;">Protocolo:</td>
                <td style="padding: 6px 0; color: #006747; font-weight: bold;">${protocolo}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Doador / Proponente:</td>
                <td style="padding: 6px 0;">${doadorNome}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">E-mail do Doador:</td>
                <td style="padding: 6px 0;"><a href="mailto:${doadorEmail}">${doadorEmail}</a></td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Denominação do Bem:</td>
                <td style="padding: 6px 0;">${bemNome}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Total de Anexos:</td>
                <td style="padding: 6px 0;">${attachments.length} ficheiro(s) (PDF assinado + documentos/fotos)</td>
              </tr>
            </table>

            <div style="background-color: #f9fafb; padding: 12px; border-left: 4px solid #009CA6; font-size: 12px; color: #4b5563;">
              Todos os documentos de identificação, registos fotográficos e o Termo com validação eletrónica encontram-se anexados a esta mensagem para avaliação da curadoria e deliberação da Coordenação do Museu Histórico FMUSP.
            </div>
          </div>
        </div>
      `,
      attachments: attachments
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro no envio:', error);
    return res.status(500).json({ error: error.message });
  }
}
