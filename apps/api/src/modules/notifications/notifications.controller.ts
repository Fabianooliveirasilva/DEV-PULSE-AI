import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  createChannelSchema,
  notificationQuerySchema,
  updateChannelSchema,
} from '@devpulse/shared';
import { BlockedDestinationError, validateDestination } from '@devpulse/shared/node';
import {
  type AuthUser,
  CurrentUser,
  Membership,
  type OrgMembership,
  paginate,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody, ZodQuery } from '../../common/zod.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';

@ApiTags('notifications')
@Controller('orgs/:orgId')
export class NotificationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('notifications')
  @RequirePermission('org:read')
  async list(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @ZodQuery(notificationQuerySchema) q: z.output<typeof notificationQuerySchema>,
  ) {
    const where = {
      organizationId: m.organizationId,
      userId: user.id,
      ...(q.unread ? { readAt: null } : {}),
    };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.notification.count({
        where: { organizationId: m.organizationId, userId: user.id, readAt: null },
      }),
    ]);
    return { ...paginate(rows, q.limit), unread };
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(204)
  @RequirePermission('org:read')
  async markRead(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('notificationId', ParseUUIDPipe) id: string,
  ) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, organizationId: m.organizationId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (
      count === 0 &&
      !(await this.prisma.notification.findFirst({
        where: { id, userId: user.id, organizationId: m.organizationId },
      }))
    ) {
      throw new NotFoundException('Notification not found');
    }
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  @RequirePermission('org:read')
  async markAllRead(@Membership() m: OrgMembership, @CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { organizationId: m.organizationId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ───────── external channels ─────────

  @Get('notification-channels')
  @RequirePermission('org:read')
  channels(@Membership() m: OrgMembership) {
    return this.prisma.notificationChannel.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('notification-channels')
  @RequirePermission('channels:manage')
  async createChannel(
    @Membership() m: OrgMembership,
    @ZodBody(createChannelSchema) body: z.output<typeof createChannelSchema>,
  ) {
    if (body.type === 'WEBHOOK') {
      try {
        const url = await validateDestination(body.target, { allowlist: this.env.SSRF_ALLOWLIST });
        if (url.protocol !== 'https:' && this.env.NODE_ENV === 'production')
          throw new BlockedDestinationError('Webhooks must use https');
      } catch (error) {
        throw new BadRequestException(`Webhook URL not allowed: ${(error as Error).message}`);
      }
    }
    return this.prisma.notificationChannel.create({
      data: { ...body, organizationId: m.organizationId },
    });
  }

  @Patch('notification-channels/:channelId')
  @RequirePermission('channels:manage')
  async updateChannel(
    @Membership() m: OrgMembership,
    @Param('channelId', ParseUUIDPipe) id: string,
    @ZodBody(updateChannelSchema) body: z.output<typeof updateChannelSchema>,
  ) {
    await this.assertChannel(m.organizationId, id);
    return this.prisma.notificationChannel.update({ where: { id }, data: body });
  }

  @Delete('notification-channels/:channelId')
  @HttpCode(204)
  @RequirePermission('channels:manage')
  async deleteChannel(
    @Membership() m: OrgMembership,
    @Param('channelId', ParseUUIDPipe) id: string,
  ) {
    await this.assertChannel(m.organizationId, id);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  private async assertChannel(organizationId: string, id: string) {
    if (
      !(await this.prisma.notificationChannel.findFirst({
        where: { id, organizationId },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Channel not found');
    }
  }
}
