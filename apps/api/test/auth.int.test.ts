import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  browser,
  ORIGIN,
  readOutbox,
  resetDb,
  signUp,
  startApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.prisma));

describe('registration', () => {
  it('creates user, organisation (owner), default project and a secure session cookie', async () => {
    const client = browser(ctx.app);
    const res = await client.post('/auth/register', {
      name: 'Ana',
      email: 'Ana@Example.com',
      password: 'correct horse battery',
      organizationName: 'Acme',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), email: 'ana@example.com', name: 'Ana' });
    expect(res.body).not.toHaveProperty('passwordHash');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^dp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.organizations).toEqual([
      expect.objectContaining({ name: 'Acme', role: 'OWNER' }),
    ]);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(cookie).not.toContain(session.tokenHash); // only the hash is stored
  });

  it('rejects duplicate e-mails (case-insensitive) with 409', async () => {
    await signUp(ctx.app, 'Ana');
    const existing = await ctx.prisma.user.findFirstOrThrow();
    const res = await browser(ctx.app).post('/auth/register', {
      name: 'X',
      email: existing.email.toUpperCase(),
      password: 'correct horse battery',
      organizationName: 'X Org',
    });
    expect(res.status).toBe(409);
  });

  it('returns field-level validation errors', async () => {
    const res = await browser(ctx.app).post('/auth/register', {
      name: '',
      email: 'not-an-email',
      password: 'short',
      organizationName: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'name',
      'organizationName',
      'password',
    ]);
  });
});

describe('login & logout', () => {
  it('logs in with valid credentials and rejects invalid ones with a generic message', async () => {
    const { email, password } = await signUp(ctx.app);
    const ok = await browser(ctx.app).post('/auth/login', { email, password });
    expect(ok.status).toBe(200);
    const wrongPassword = await browser(ctx.app).post('/auth/login', {
      email,
      password: 'wrong password!!',
    });
    const unknownUser = await browser(ctx.app).post('/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever12345',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(2);
  });

  it('logout revokes the server-side session', async () => {
    const { client } = await signUp(ctx.app);
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
    expect(await ctx.prisma.session.count()).toBe(0);
  });

  it('rejects forged or expired session tokens', async () => {
    const forged = await request(ctx.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `dp_session=${'a'.repeat(43)}`);
    expect(forged.status).toBe(401);

    const { client } = await signUp(ctx.app);
    await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client.get('/auth/me')).status).toBe(401);
  });
});

describe('password recovery', () => {
  it('does not reveal whether an account exists', async () => {
    const res = await browser(ctx.app).post('/auth/forgot-password', {
      email: 'ghost@example.com',
    });
    expect(res.status).toBe(202);
    expect(readOutbox(ctx.env.MAIL_OUTBOX_DIR!)).toHaveLength(0);
  });

  it('sends a single-use, expiring link that resets the password and revokes sessions', async () => {
    const { client, email } = await signUp(ctx.app);
    expect((await browser(ctx.app).post('/auth/forgot-password', { email })).status).toBe(202);
    const mail = readOutbox(ctx.env.MAIL_OUTBOX_DIR!).find((m) => m.to === email)!;
    expect(mail.subject).toMatch(/reset/i);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    expect(mail.text).toContain(`${ORIGIN}/reset-password?token=`);

    const reset = await browser(ctx.app).post('/auth/reset-password', {
      token,
      password: 'a brand new passphrase',
    });
    expect(reset.status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401); // old session revoked

    const reused = await browser(ctx.app).post('/auth/reset-password', {
      token,
      password: 'another passphrase!!',
    });
    expect(reused.status).toBe(400);
    expect(
      (await browser(ctx.app).post('/auth/login', { email, password: 'a brand new passphrase' }))
        .status,
    ).toBe(200);
  });

  it('rejects expired tokens', async () => {
    const { email } = await signUp(ctx.app);
    await browser(ctx.app).post('/auth/forgot-password', { email });
    const token = decodeURIComponent(
      /token=([^\s]+)/.exec(
        readOutbox(ctx.env.MAIL_OUTBOX_DIR!).find((m) => m.to === email)!.text,
      )![1]!,
    );
    await ctx.prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(
      (
        await browser(ctx.app).post('/auth/reset-password', {
          token,
          password: 'a brand new passphrase',
        })
      ).status,
    ).toBe(400);
  });
});

describe('profile', () => {
  it('updates the name and changes the password, revoking other sessions only', async () => {
    const { client, email, password } = await signUp(ctx.app);
    const other = browser(ctx.app);
    await other.post('/auth/login', { email, password });

    expect((await client.patch('/auth/me', { name: 'Renamed' })).body.name).toBe('Renamed');
    expect(
      (
        await client.post('/auth/change-password', {
          currentPassword: 'wrong',
          newPassword: 'new passphrase 123',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post('/auth/change-password', {
          currentPassword: password,
          newPassword: 'new passphrase 123',
        })
      ).status,
    ).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
  });
});
