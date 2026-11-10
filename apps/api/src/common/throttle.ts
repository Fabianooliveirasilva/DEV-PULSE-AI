import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import type { AppRequest } from './context.js';
import { readApiKey } from '../modules/logs/api-key.guard.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Shared rate-limit counters in Redis so limits hold across API replicas.
 * Fixed window per key: INCR + PEXPIRE NX in one round trip.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `devpulse:throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    const results = await this.redis
      .multi()
      .incr(hitKey)
      .pexpire(hitKey, ttl, 'NX')
      .pttl(hitKey)
      .pttl(blockKey)
      .exec();
    const totalHits = Number(results?.[0]?.[1] ?? 0);
    const timeToExpire = Math.ceil(Math.max(0, Number(results?.[2]?.[1] ?? ttl)) / 1000);
    let blockTtl = Number(results?.[3]?.[1] ?? -2);
    if (blockTtl <= 0 && totalHits > limit) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      blockTtl = blockDuration;
    }
    return {
      totalHits,
      timeToExpire,
      isBlocked: blockTtl > 0,
      timeToBlockExpire: Math.ceil(Math.max(0, blockTtl) / 1000),
    };
  }

  async close() {
    await this.redis.quit();
  }
}

/** Limits ingestion per API key (many services may share one egress IP) and everything else per IP. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as AppRequest;
    const key = request.path?.includes('/ingest/') ? readApiKey(request) : null;
    return key ? `key:${key.slice(0, 11)}` : `ip:${request.ip ?? 'unknown'}`;
  }
}
