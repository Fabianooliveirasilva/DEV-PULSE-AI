import { Inject, Injectable } from '@nestjs/common';
import { redactValue } from '@devpulse/shared';
import type { Prisma } from '@devpulse/database';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';

export interface AuditEntry {
  action: string;
  organizationId?: string | null;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  ipAddress?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only security/audit trail. Details are redacted before storage. */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry, tx: Prisma.TransactionClient | PrismaClient = this.prisma) {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: entry.ipAddress ?? null,
        details: entry.details ? (redactValue(entry.details) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
