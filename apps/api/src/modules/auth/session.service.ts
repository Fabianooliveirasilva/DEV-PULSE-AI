import { Inject, Injectable } from '@nestjs/common';
import { randomToken, sha256Hex } from '@devpulse/shared/node';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from '../../common/context.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';

const TOUCH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class SessionService {
  readonly cookieName: string;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {
    // The __Host- prefix forces Secure, Path=/ and no Domain: the cookie cannot be
    // planted by a sibling subdomain. Only usable over HTTPS.
    this.cookieName = env.cookieSecure ? '__Host-dp_session' : 'dp_session';
  }

  private cookieOptions(expires: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires,
    };
  }

  readCookie(req: Request): string | null {
    const value = (req.cookies as Record<string, string> | undefined)?.[this.cookieName];
    return typeof value === 'string' && value.length >= 32 && value.length <= 128 ? value : null;
  }

  async create(userId: string, req: Request, res: Response) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3600_000);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        expiresAt,
        ipAddress: req.ip?.slice(0, 64) ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
      },
    });
    res.cookie(this.cookieName, token, this.cookieOptions(expiresAt));
  }

  async validate(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!session) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return { ...session.user, sessionId: session.id };
  }

  async revoke(sessionId: string, res: Response) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
    res.clearCookie(this.cookieName, { ...this.cookieOptions(new Date(0)), expires: undefined });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    });
  }
}
