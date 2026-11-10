import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { OrgRole, Permission } from '@devpulse/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

export interface OrgMembership {
  organizationId: string;
  role: OrgRole;
}

export interface IngestPrincipal {
  apiKeyId: string;
  organizationId: string;
  applicationId: string;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  membership?: OrgMembership;
  ingest?: IngestPrincipal;
}

export const IS_PUBLIC = 'isPublic';
/** Skips session authentication (login, register, health, ingestion with API keys...). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSION = 'permission';
/** Requires the caller's role in `:orgId` to include this permission. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});

export const Membership = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const membership = ctx.switchToHttp().getRequest<AppRequest>().membership;
  if (!membership) throw new Error('Membership used on a route without :orgId');
  return membership;
});

export const Ingest = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const ingest = ctx.switchToHttp().getRequest<AppRequest>().ingest;
  if (!ingest) throw new Error('Ingest principal missing');
  return ingest;
});

export function clientIp(req: Request): string | null {
  return (req.ip ?? null)?.slice(0, 64) ?? null;
}

/** Cursor pagination helper: fetch `limit + 1` rows, return page + next cursor. */
export function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
