import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@devpulse/shared';
import { QueueService } from '../../queue/queue.service.js';

export interface DispatchPayload {
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string;
  incidentId?: string | null;
}

/** Queues delivery to external channels (e-mail / webhook); the worker performs it with retries. */
@Injectable()
export class NotificationDispatchService {
  constructor(private readonly queues: QueueService) {}

  async enqueue(channels: { id: string }[], payload: DispatchPayload) {
    if (channels.length === 0) return;
    await this.queues.notifications.addBulk(
      channels.map((c) => ({
        name: 'deliver',
        data: {
          channelId: c.id,
          organizationId: payload.organizationId,
          notificationType: payload.type,
          title: payload.title,
          body: payload.body,
          link: payload.incidentId ? `/incidents/${payload.incidentId}` : null,
        },
      })),
    );
  }
}
