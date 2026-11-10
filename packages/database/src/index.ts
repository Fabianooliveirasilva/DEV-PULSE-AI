import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export * from './generated/client.js';

export interface CreatePrismaOptions {
  connectionString: string;
  /** Upper bound on pooled connections per process. */
  maxConnections?: number;
}

export function createPrismaClient({ connectionString, maxConnections = 10 }: CreatePrismaOptions) {
  const adapter = new PrismaPg({ connectionString, max: maxConnections });
  return new PrismaClient({ adapter });
}
export * from './notifications.js';
