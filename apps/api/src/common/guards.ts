import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type OrgRole, type Permission } from '@devpulse/shared';
import { ENV, type Env } from '../config/env.js';
import { PRISMA, type PrismaClient } from '../database/prisma.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { type AppRequest, IS_PUBLIC, PERMISSION } from './context.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must come from
 * an allowed Origin (or same-origin Referer). Combined with SameSite=Lax cookies and
 * JSON-only bodies this blocks cross-site form posts and fetches.
 * API-key ingestion carries no cookies and is exempt by design.
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (!req.headers.cookie) return true; // no ambient credentials → nothing to forge
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (origin && this.env.WEB_ORIGINS.includes(origin)) return true;
    throw new ForbiddenException('Cross-site request blocked (origin not allowed)');
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<AppRequest>();
    const token = this.sessions.readCookie(req);
    if (token) {
      const user = await this.sessions.validate(token);
      if (user) req.user = user;
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Authentication required');
    return true;
  }
}

/**
 * Tenant isolation: any route with an `:orgId` parameter requires membership in that
 * organisation. Non-members get 404 (not 403) so the existence of other tenants' ids
 * is not disclosed. Permission metadata is then checked against the member's role.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const orgId = req.params?.orgId;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (typeof orgId !== 'string') {
      if (permission)
        throw new Error(`@RequirePermission(${permission}) used on a route without :orgId`);
      return true;
    }
    if (!req.user) return true; // public org-scoped routes do not exist; SessionAuthGuard already ran
    if (!UUID.test(orgId)) throw new NotFoundException('Organization not found');

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: req.user.id } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException('Organization not found');
    req.membership = { organizationId: orgId, role: member.role as OrgRole };

    if (permission && !hasPermission(member.role as OrgRole, permission)) {
      throw new ForbiddenException(`Your role (${member.role}) does not allow this action`);
    }
    return true;
  }
}
