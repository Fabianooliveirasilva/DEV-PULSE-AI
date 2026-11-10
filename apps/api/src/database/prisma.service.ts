import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@devpulse/database';
import { ENV, type Env } from '../config/env.js';

export const PRISMA = Symbol('PRISMA');

@Injectable()
export class PrismaLifecycle implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

export const prismaProvider = {
  provide: PRISMA,
  inject: [ENV],
  useFactory: (env: Env) => createPrismaClient({ connectionString: env.DATABASE_URL }),
};

export type { PrismaClient };
