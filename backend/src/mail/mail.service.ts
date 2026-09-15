import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// E-mail vanuit de kassa (bv. de maandelijkse rekening van particulieren, die
// niet via Scrada/Peppol gaat). Instellen via omgevingsvariabelen op Render:
//   SMTP_HOST, SMTP_PORT (587 of 465), SMTP_USER, SMTP_PASS, SMTP_FROM (afzender),
//   optioneel SMTP_SECURE=true (bij poort 465).
// Zonder SMTP_HOST is mailen uitgeschakeld (status "niet ingesteld").
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  config() {
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;
    const port = Number(process.env.SMTP_PORT ?? 587) || 587;
    const user = process.env.SMTP_USER?.trim() || undefined;
    const pass = process.env.SMTP_PASS ?? undefined;
    const from = process.env.SMTP_FROM?.trim() || user || '';
    const secure = (process.env.SMTP_SECURE ?? '').toLowerCase() === 'true' || port === 465;
    return { host, port, user, pass, from, secure };
  }
  geconfigureerd() { return !!this.config(); }
  status() {
    const c = this.config();
    return { geconfigureerd: !!c, afzender: c?.from ?? null, host: c?.host ?? null };
  }

  async verstuur(input: { naar: string; onderwerp: string; html: string; tekst?: string; bijlagen?: { filename: string; content: string | Buffer; contentType?: string }[] }) {
    const c = this.config();
    if (!c) throw new Error('E-mail is niet ingesteld (SMTP_HOST/SMTP_USER/SMTP_PASS op Render).');
    const transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    });
    const info = await transport.sendMail({ from: c.from, to: input.naar, subject: input.onderwerp, html: input.html, text: input.tekst, attachments: input.bijlagen });
    this.log.log(`Mail naar ${input.naar}: ${input.onderwerp} (${info.messageId})`);
    return { messageId: info.messageId };
  }
}
