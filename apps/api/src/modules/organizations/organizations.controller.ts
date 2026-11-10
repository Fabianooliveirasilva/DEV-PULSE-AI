import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  addMemberSchema,
  canManageRole,
  createOrganizationSchema,
  type OrgRole,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@devpulse/shared';
import type { Request } from 'express';
import {
  type AuthUser,
  clientIp,
  CurrentUser,
  Membership,
  type OrgMembership,
  paginate,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { uniqueSlug } from './slug.js';

const orgView = {
  id: true,
  name: true,
  slug: true,
  aiMonthlyBudgetUsd: true,
  logRetentionDays: true,
  checkRetentionDays: true,
  createdAt: true,
} as const;

@ApiTags('organizations')
@Controller('orgs')
export class OrganizationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @ZodBody(createOrganizationSchema) body: z.output<typeof createOrganizationSchema>,
    @Req() req: Request,
  ) {
    const slug = await uniqueSlug(this.prisma, body.name);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: body.name, slug },
        select: orgView,
      });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, role: 'OWNER' },
      });
      await tx.project.create({ data: { organizationId: org.id, name: 'Default' } });
      await this.audit.record(
        {
          action: 'org.created',
          organizationId: org.id,
          actorId: user.id,
          ipAddress: clientIp(req),
        },
        tx,
      );
      return { ...org, role: 'OWNER' as const };
    });
  }

  @Get(':orgId')
  @RequirePermission('org:read')
  async get(@Membership() m: OrgMembership) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: m.organizationId },
      select: orgView,
    });
    return { ...org, role: m.role };
  }

  @Patch(':orgId')
  @RequirePermission('org:update')
  async update(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @ZodBody(updateOrganizationSchema) body: z.output<typeof updateOrganizationSchema>,
    @Req() req: Request,
  ) {
    const org = await this.prisma.organization.update({
      where: { id: m.organizationId },
      data: body,
      select: orgView,
    });
    await this.audit.record({
      action: 'org.updated',
      organizationId: m.organizationId,
      actorId: user.id,
      ipAddress: clientIp(req),
      details: body,
    });
    return { ...org, role: m.role };
  }

  @Delete(':orgId')
  @HttpCode(204)
  @RequirePermission('org:delete')
  async remove(@Membership() m: OrgMembership, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.audit.record({
      action: 'org.deleted',
      actorId: user.id,
      ipAddress: clientIp(req),
      details: { organizationId: m.organizationId },
    });
    await this.prisma.organization.delete({ where: { id: m.organizationId } });
  }

  // ───────── members ─────────

  @Get(':orgId/members')
  @RequirePermission('org:read')
  members(@Membership() m: OrgMembership) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId: m.organizationId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adds an existing DevPulse user. (E-mail invitations for new users are on the roadmap.) */
  @Post(':orgId/members')
  @RequirePermission('members:manage')
  async addMember(
    @Membership() m: OrgMembership,
    @CurrentUser() actor: AuthUser,
    @ZodBody(addMemberSchema) body: z.output<typeof addMemberSchema>,
    @Req() req: Request,
  ) {
    if (!canManageRole(m.role, body.role))
      throw new ForbiddenException(`A ${m.role} cannot grant the ${body.role} role`);
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (!user)
      throw new NotFoundException(
        'No DevPulse AI account uses this e-mail. Ask them to sign up first.',
      );
    const member = await this.prisma.organizationMember.create({
      data: { organizationId: m.organizationId, userId: user.id, role: body.role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    await this.audit.record({
      action: 'member.added',
      organizationId: m.organizationId,
      actorId: actor.id,
      targetType: 'user',
      targetId: user.id,
      ipAddress: clientIp(req),
      details: { role: body.role },
    });
    return member;
  }

  @Patch(':orgId/members/:memberId')
  @RequirePermission('members:manage')
  async updateMember(
    @Membership() m: OrgMembership,
    @CurrentUser() actor: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(updateMemberSchema) body: z.output<typeof updateMemberSchema>,
    @Req() req: Request,
  ) {
    const target = await this.findMember(m.organizationId, memberId);
    if (!canManageRole(m.role, target.role as OrgRole) || !canManageRole(m.role, body.role)) {
      throw new ForbiddenException('You cannot change this member to or from that role');
    }
    if (target.role === 'OWNER' && body.role !== 'OWNER')
      await this.assertNotLastOwner(m.organizationId);
    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { role: body.role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    await this.audit.record({
      action: 'member.role_changed',
      organizationId: m.organizationId,
      actorId: actor.id,
      targetType: 'user',
      targetId: target.userId,
      ipAddress: clientIp(req),
      details: { from: target.role, to: body.role },
    });
    return updated;
  }

  @Delete(':orgId/members/:memberId')
  @HttpCode(204)
  @RequirePermission('org:read')
  async removeMember(
    @Membership() m: OrgMembership,
    @CurrentUser() actor: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() req: Request,
  ) {
    const target = await this.findMember(m.organizationId, memberId);
    const leavingSelf = target.userId === actor.id;
    if (!leavingSelf && !canManageRole(m.role, target.role as OrgRole)) {
      throw new ForbiddenException('You cannot remove this member');
    }
    if (target.role === 'OWNER') await this.assertNotLastOwner(m.organizationId);
    await this.prisma.organizationMember.delete({ where: { id: memberId } });
    await this.audit.record({
      action: leavingSelf ? 'member.left' : 'member.removed',
      organizationId: m.organizationId,
      actorId: actor.id,
      targetType: 'user',
      targetId: target.userId,
      ipAddress: clientIp(req),
    });
  }

  @Get(':orgId/audit-logs')
  @RequirePermission('audit:read')
  async auditLogs(@Membership() m: OrgMembership, @Query('cursor') cursor?: string) {
    const limit = 50;
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        ipAddress: true,
        details: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    });
    return paginate(rows, limit);
  }

  private async findMember(organizationId: string, memberId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  private async assertNotLastOwner(organizationId: string) {
    const owners = await this.prisma.organizationMember.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (owners <= 1) throw new BadRequestException('An organization must keep at least one owner');
  }
}
