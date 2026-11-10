import type { NotificationType, Prisma, PrismaClient } from './generated/client.js';

export interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string;
  incidentId?: string | null;
  applicationId?: string | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * In-app fan-out: one row per organisation member (so read state is per user).
 * Returns the external channels subscribed to this event type; the caller enqueues
 * their delivery so that slow e-mail/webhook targets never block the caller.
 */
export async function notifyOrganization(db: Db, input: NotifyInput) {
  const members = await db.organizationMember.findMany({
    where: { organizationId: input.organizationId },
    select: { userId: true },
  });
  if (members.length > 0) {
    await db.notification.createMany({
      data: members.map((m) => ({
        organizationId: input.organizationId,
        userId: m.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        incidentId: input.incidentId ?? null,
        applicationId: input.applicationId ?? null,
      })),
    });
  }
  return db.notificationChannel.findMany({
    where: { organizationId: input.organizationId, isEnabled: true, events: { has: input.type } },
    select: { id: true },
  });
}
