import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { parseApiKey, sha256Hex } from '@devpulse/shared/node';
import type { AppRequest } from '../../common/context.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';

export function readApiKey(req: AppRequest): string | null {
  const header = req.headers['x-devpulse-key'];
  if (typeof header === 'string') return header.trim();
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/** Authenticates log ingestion with an application-scoped API key (no cookies involved). */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const key = readApiKey(req);
    if (!key || !parseApiKey(key)) throw new UnauthorizedException('Missing or malformed API key');
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256Hex(key) },
      select: { id: true, organizationId: true, applicationId: true, revokedAt: true },
    });
    if (!record || record.revokedAt) throw new UnauthorizedException('Invalid or revoked API key');
    req.ingest = {
      apiKeyId: record.id,
      organizationId: record.organizationId,
      applicationId: record.applicationId,
    };
    return true;
  }
}
