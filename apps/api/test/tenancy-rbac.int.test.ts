import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication, resetDb, signUp, startApp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.prisma));

async function twoTenants() {
  const alice = await signUp(ctx.app, 'Alice');
  const bob = await signUp(ctx.app, 'Bob');
  const appId = await createApplication(alice.client, alice.orgId, alice.projectId);
  const incident = await alice.client.post(`/orgs/${alice.orgId}/incidents`, {
    applicationId: appId,
    title: 'Payment outage',
    severity: 'HIGH',
  });
  return { alice, bob, appId, incidentId: incident.body.id as string };
}

describe('multi-tenant isolation', () => {
  it('returns 404 for every route of another organisation (existence is not disclosed)', async () => {
    const { alice, bob, appId, incidentId } = await twoTenants();
    const paths = [
      `/orgs/${alice.orgId}`,
      `/orgs/${alice.orgId}/applications`,
      `/orgs/${alice.orgId}/applications/${appId}`,
      `/orgs/${alice.orgId}/incidents/${incidentId}`,
      `/orgs/${alice.orgId}/logs`,
      `/orgs/${alice.orgId}/dashboard`,
      `/orgs/${alice.orgId}/members`,
      `/orgs/${alice.orgId}/ai/analyses`,
    ];
    for (const path of paths) {
      const res = await bob.client.get(path);
      expect(res.status, path).toBe(404);
    }
    expect(
      (
        await bob.client.patch(`/orgs/${alice.orgId}/incidents/${incidentId}`, {
          status: 'RESOLVED',
        })
      ).status,
    ).toBe(404);
    expect((await bob.client.delete(`/orgs/${alice.orgId}/applications/${appId}`)).status).toBe(
      404,
    );
  });

  it("cannot reach another tenant's resources through its own organisation (IDOR)", async () => {
    const { bob, appId, incidentId } = await twoTenants();
    // Alice's ids used inside Bob's organisation scope
    expect((await bob.client.get(`/orgs/${bob.orgId}/applications/${appId}`)).status).toBe(404);
    expect((await bob.client.get(`/orgs/${bob.orgId}/incidents/${incidentId}`)).status).toBe(404);
    expect(
      (
        await bob.client.post(`/orgs/${bob.orgId}/monitors`, {
          applicationId: appId,
          name: 'x',
          url: 'https://example.com',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await bob.client.post(`/orgs/${bob.orgId}/incidents`, {
          applicationId: appId,
          title: 'Sneaky',
          severity: 'LOW',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await bob.client.post(`/orgs/${bob.orgId}/ai/analyses`, {
          targetType: 'INCIDENT',
          targetId: incidentId,
        })
      ).status,
    ).toBe(404);
    expect(
      (await bob.client.post(`/orgs/${bob.orgId}/applications/${appId}/api-keys`, { name: 'k' }))
        .status,
    ).toBe(404);
  });

  it('lists only the caller organisation data', async () => {
    const { alice, bob } = await twoTenants();
    await createApplication(bob.client, bob.orgId, bob.projectId, 'Bob App');
    const list = await bob.client.get(`/orgs/${bob.orgId}/applications`);
    expect(list.body.map((a: { name: string }) => a.name)).toEqual(['Bob App']);
    const incidents = await bob.client.get(`/orgs/${bob.orgId}/incidents`);
    expect(incidents.body.items).toHaveLength(0);
    expect((await alice.client.get(`/orgs/${alice.orgId}/incidents`)).body.items).toHaveLength(1);
  });

  it('rejects malformed organisation ids with 404 rather than 500', async () => {
    const { client } = await signUp(ctx.app);
    expect((await client.get('/orgs/not-a-uuid/applications')).status).toBe(404);
  });
});

describe('role-based access control', () => {
  async function withMember(role: 'VIEWER' | 'MEMBER' | 'ADMIN') {
    const owner = await signUp(ctx.app, 'Owner');
    const member = await signUp(ctx.app, role);
    const add = await owner.client.post(`/orgs/${owner.orgId}/members`, {
      email: member.email,
      role,
    });
    expect(add.status).toBe(201);
    return { owner, member, orgId: owner.orgId, projectId: owner.projectId };
  }

  it('VIEWER can read but not write', async () => {
    const { member, orgId, projectId } = await withMember('VIEWER');
    expect((await member.client.get(`/orgs/${orgId}/applications`)).status).toBe(200);
    const res = await member.client.post(`/orgs/${orgId}/applications`, {
      projectId,
      name: 'Nope',
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/VIEWER/);
  });

  it('MEMBER operates but cannot manage members, keys or settings', async () => {
    const { member, orgId, projectId } = await withMember('MEMBER');
    const appId = await createApplication(member.client, orgId, projectId);
    expect(
      (
        await member.client.post(`/orgs/${orgId}/members`, {
          email: 'x@example.com',
          role: 'VIEWER',
        })
      ).status,
    ).toBe(403);
    expect(
      (await member.client.post(`/orgs/${orgId}/applications/${appId}/api-keys`, { name: 'k' }))
        .status,
    ).toBe(403);
    expect((await member.client.patch(`/orgs/${orgId}`, { aiMonthlyBudgetUsd: 1000 })).status).toBe(
      403,
    );
    expect((await member.client.get(`/orgs/${orgId}/audit-logs`)).status).toBe(403);
  });

  it('ADMIN cannot escalate privileges or remove owners', async () => {
    const { owner, member: admin, orgId } = await withMember('ADMIN');
    const extra = await signUp(ctx.app, 'Extra');
    expect(
      (await admin.client.post(`/orgs/${orgId}/members`, { email: extra.email, role: 'OWNER' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.client.post(`/orgs/${orgId}/members`, { email: extra.email, role: 'ADMIN' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.client.post(`/orgs/${orgId}/members`, { email: extra.email, role: 'MEMBER' }))
        .status,
    ).toBe(201);

    const members = (await owner.client.get(`/orgs/${orgId}/members`)).body as {
      id: string;
      role: string;
      user: { id: string };
    }[];
    const ownerRow = members.find((m) => m.role === 'OWNER')!;
    const adminRow = members.find((m) => m.user.id === admin.userId)!;
    expect((await admin.client.delete(`/orgs/${orgId}/members/${ownerRow.id}`)).status).toBe(403);
    expect(
      (await admin.client.patch(`/orgs/${orgId}/members/${adminRow.id}`, { role: 'OWNER' })).status,
    ).toBe(403);
    expect((await admin.client.delete(`/orgs/${orgId}`)).status).toBe(403);
  });

  it('keeps at least one owner', async () => {
    const owner = await signUp(ctx.app, 'Solo');
    const members = (await owner.client.get(`/orgs/${owner.orgId}/members`)).body as {
      id: string;
    }[];
    expect(
      (
        await owner.client.patch(`/orgs/${owner.orgId}/members/${members[0]!.id}`, {
          role: 'ADMIN',
        })
      ).status,
    ).toBe(400);
    expect(
      (await owner.client.delete(`/orgs/${owner.orgId}/members/${members[0]!.id}`)).status,
    ).toBe(400);
  });

  it('records membership changes in the audit log', async () => {
    const { owner, orgId } = await withMember('MEMBER');
    const audit = await owner.client.get(`/orgs/${orgId}/audit-logs`);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toContain('member.added');
  });
});
