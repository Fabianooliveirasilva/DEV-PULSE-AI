import { Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@devpulse/shared';
import type { Request, Response } from 'express';
import { type AuthUser, CurrentUser, Public } from '../../common/context.js';
import { ZodBody } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  register(
    @ZodBody(registerSchema) body: z.output<typeof registerSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(body, req, res);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  login(
    @ZodBody(loginSchema) body: z.output<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, req, res);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(user.sessionId, res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgot(
    @ZodBody(forgotPasswordSchema) body: z.output<typeof forgotPasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.forgotPassword(body.email, req);
    return { message: 'If an account exists for this e-mail, a reset link has been sent.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  async reset(
    @ZodBody(resetPasswordSchema) body: z.output<typeof resetPasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body.token, body.password, req);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @ZodBody(updateProfileSchema) body: z.output<typeof updateProfileSchema>,
  ) {
    await this.prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
    return this.auth.me(user.id);
  }

  @Throttle(STRICT)
  @HttpCode(204)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZodBody(changePasswordSchema) body: z.output<typeof changePasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(
      user.id,
      user.sessionId,
      body.currentPassword,
      body.newPassword,
      req,
    );
  }
}
