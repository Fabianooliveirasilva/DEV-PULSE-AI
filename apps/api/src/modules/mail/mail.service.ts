import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Transports, in order of precedence:
 *  - SMTP_URL: real delivery via nodemailer.
 *  - MAIL_OUTBOX_DIR (dev/test only): one JSON file per message, read by E2E tests.
 *  - neither: the message is NOT sent and an error is logged (never silently "succeeds").
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly smtp: Transporter | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.smtp = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
  }

  get isConfigured() {
    return this.smtp !== null || Boolean(this.env.MAIL_OUTBOX_DIR);
  }

  async send(message: MailMessage): Promise<boolean> {
    if (this.smtp) {
      await this.smtp.sendMail({ from: this.env.MAIL_FROM, ...message });
      return true;
    }
    if (this.env.MAIL_OUTBOX_DIR) {
      await mkdir(this.env.MAIL_OUTBOX_DIR, { recursive: true });
      const file = join(
        this.env.MAIL_OUTBOX_DIR,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      );
      await writeFile(
        file,
        JSON.stringify(
          { ...message, from: this.env.MAIL_FROM, sentAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      return true;
    }
    this.logger.error(`E-mail "${message.subject}" not sent: configure SMTP_URL`);
    return false;
  }
}
