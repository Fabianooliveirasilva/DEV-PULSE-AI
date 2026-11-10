#!/usr/bin/env node
// Local infrastructure for machines without Docker.
//  - PostgreSQL: `embedded-postgres` (official PostgreSQL binaries distributed through npm).
//  - Redis: uses `redis-server` from PATH (or REDIS_SERVER_BIN). If REDIS_URL points to an
//    already-running instance, nothing is started.
// With Docker available, prefer `docker compose up postgres redis` instead.
import EmbeddedPostgres from 'embedded-postgres';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, '.data');
const pgPort = Number(process.env.DEV_PG_PORT ?? 54329);
const redisPort = Number(process.env.DEV_REDIS_PORT ?? 63790);
const databases = ['devpulse', 'devpulse_test'];

function portOpen(port) {
  return new Promise((done) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.end(), done(true)));
    socket.once('error', () => done(false));
  });
}

async function startPostgres() {
  if (await portOpen(pgPort)) {
    console.log(`[infra] PostgreSQL already listening on :${pgPort}`);
    return null;
  }
  const dir = resolve(dataDir, 'pg');
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'devpulse',
    password: 'devpulse',
    port: pgPort,
    persistent: true,
    onLog: () => {},
  });
  if (!existsSync(resolve(dir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  for (const db of databases) {
    try {
      await pg.createDatabase(db);
    } catch {
      /* already exists */
    }
  }
  const client = pg.getPgClient();
  await client.connect();
  for (const db of databases) {
    await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [db]);
  }
  await client.end();
  console.log(
    `[infra] PostgreSQL ready  postgresql://devpulse:devpulse@localhost:${pgPort}/devpulse`,
  );
  return pg;
}

function findRedisBinary() {
  const candidates = [
    process.env.REDIS_SERVER_BIN,
    resolve(root, '.tools/redis/bin/redis-server'),
    'redis-server',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

async function startRedis() {
  if (await portOpen(redisPort)) {
    console.log(`[infra] Redis already listening on :${redisPort}`);
    return null;
  }
  const bin = findRedisBinary();
  if (!bin) {
    console.warn(
      '[infra] No redis-server found. Install Redis (e.g. `sudo apt install redis-server`), set ' +
        'REDIS_SERVER_BIN, or point REDIS_URL at an existing instance. Queues/worker will not run.',
    );
    return null;
  }
  const dir = resolve(dataDir, 'redis');
  mkdirSync(dir, { recursive: true });
  const child = spawn(
    bin,
    [
      '--port',
      String(redisPort),
      '--bind',
      '127.0.0.1',
      '--dir',
      dir,
      '--appendonly',
      'no',
      '--save',
      '',
    ],
    {
      stdio: 'inherit',
    },
  );
  console.log(`[infra] Redis ready       redis://localhost:${redisPort}`);
  return child;
}

const pg = await startPostgres();
const redis = await startRedis();

async function shutdown() {
  redis?.kill('SIGTERM');
  await pg?.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('[infra] Running. Press Ctrl+C to stop.');
setInterval(() => {}, 1 << 30);
