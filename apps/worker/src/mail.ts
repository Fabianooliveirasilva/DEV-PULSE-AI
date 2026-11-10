import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { WorkerConfig } from './config.js';
import type { MailSender } from './deps.js';

export function createMailSender(config: WorkerConfig): MailSender {
  if (config.SMTP_URL) {
    const transport = nodemailer.createTransport(config.SMTP_URL);
    return {
      isConfigured: true,
      send: async (m) => {
        await transport.sendMail({ from: config.MAIL_FROM, ...m });
      },
    };
  }
  if (config.MAIL_OUTBOX_DIR && config.NODE_ENV !== 'production') {
    const dir = config.MAIL_OUTBOX_DIR;
    return {
      isConfigured: true,
      send: async (m) => {
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
          JSON.stringify({ ...m, from: config.MAIL_FROM }, null, 2),
        );
      },
    };
  }
  return {
    isConfigured: false,
    send: async () => {
      throw new Error('E-mail transport is not configured');
    },
  };
}
