import { Injectable } from '@nestjs/common';
import { monitorSchedulerId } from '@devpulse/queue';
import { QueueService } from '../../queue/queue.service.js';

/**
 * Each active monitor owns one BullMQ job scheduler that emits a check job every
 * `intervalSeconds`. Upserting is idempotent, so saving a monitor twice is harmless.
 */
@Injectable()
export class MonitorSchedulerService {
  constructor(private readonly queues: QueueService) {}

  async schedule(monitor: { id: string; intervalSeconds: number; isActive: boolean }) {
    if (!monitor.isActive) return this.unschedule(monitor.id);
    await this.queues.monitorChecks.upsertJobScheduler(
      monitorSchedulerId(monitor.id),
      { every: monitor.intervalSeconds * 1000 },
      {
        name: 'check',
        data: { monitorId: monitor.id },
        opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
      },
    );
  }

  async unschedule(monitorId: string) {
    await this.queues.monitorChecks.removeJobScheduler(monitorSchedulerId(monitorId));
  }

  /** On-demand check. The job id dedupes rapid repeated clicks within the same 10 s window. */
  async runNow(monitorId: string) {
    const slot = Math.floor(Date.now() / 10_000);
    await this.queues.monitorChecks.add(
      'check',
      { monitorId },
      {
        jobId: `manual-${monitorId}-${slot}`,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
  }
}
