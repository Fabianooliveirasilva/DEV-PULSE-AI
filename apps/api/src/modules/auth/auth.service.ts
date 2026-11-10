import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { z } from 'zod';
import type { loginSchema, registerSchema } from '@devpulse/shared';
import { randomToken, sha256Hex } from '@devpulse/shared/node';
import type { Request, Response } from 'express';
import { clientIp } from '../../common/context.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { uniqueSlug } from '../organizations/slug.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const RESET_TTL_MS = 30 * 60_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** Creates the user, their first organisation (as OWNER) and a default project. */
  async register(input: z.output<typeof registerSchema>, req: Request, res: Response) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      // Explicit conflict is acceptable here: registration is rate limited and the
      // alternative (silent success) would break the sign-up UX.
      throw new ConflictException('An account with this e-mail already exists');
    }
    const passwordHash = await this.passwords.hash(input.password);
    const slug = await uniqueSlug(this.prisma, input.organizationName);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: created.id, role: 'OWNER' },
      });
      await tx.project.create({ data: { organizationId: org.id, name: 'Default' } });
      await this.audit.record(
        {
          action: 'user.registered',
          actorId: created.id,
          organizationId: org.id,
          ipAddress: clientIp(req),
        },
        tx,
      );
      return created;
    });
    await this.sessions.create(user.id, req, res);
    return { id: user.id, email: user.email, name: user.name };
  }

  async login(input: z.output<typeof loginSchema>, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyAgainstDummy(input.password);
    if (!user || !valid) {
      await this.audit.record({
        action: 'auth.login_failed',
        actorId: user?.id,
        ipAddress: clientIp(req),
        details: { email: input.email },
      });
      throw new UnauthorizedException('Invalid e-mail or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.sessions.create(user.id, req, res);
    await this.audit.record({ action: 'auth.login', actorId: user.id, ipAddress: clientIp(req) });
    return { id: user.id, email: user.email, name: user.name };
  }

  /** Always resolves the same way whether or not the account exists (no enumeration). */
  async forgotPassword(email: string, req: Request) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (!user) return;
    const token = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      }),
    ]);
    const link = `${this.env.WEB_PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const sent = await this.mail.send({
      to: email,
      subject: 'Reset your DevPulse AI password',
      text: `Hi ${user.name},\n\nUse the link below to choose a new password. It expires in 30 minutes and can be used once.\n\n${link}\n\nIf you did not request this, you can ignore this e-mail.`,
    });
    if (!sent) this.logger.warn('Password reset requested but no mail transport is configured');
    await this.audit.record({
      action: 'auth.password_reset_requested',
      actorId: user.id,
      ipAddress: clientIp(req),
    });
  }

  async resetPassword(token: string, password: string, req: Request) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      // Conditional update makes the token single-use even under concurrent submissions.
      this.prisma.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    ]);
    await this.sessions.revokeAllForUser(record.userId);
    await this.audit.record({
      action: 'auth.password_reset',
      actorId: record.userId,
      ipAddress: clientIp(req),
    });
  }

  async changePassword(
    userId: string,
    sessionId: string,
    current: string,
    next: string,
    req: Request,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(next) },
    });
    await this.sessions.revokeAllForUser(userId, sessionId);
    await this.audit.record({
      action: 'auth.password_changed',
      actorId: userId,
      ipAddress: clientIp(req),
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        memberships: {
          select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      organizations: user.memberships.map((m) => ({ ...m.organization, role: m.role })),
    };
  }
}
