import type { OrgRole } from './enums.js';

/**
 * Permissions are coarse on purpose: each maps to a clear product capability.
 * VIEWER  — read everything in the organisation.
 * MEMBER  — operate: manage apps/monitors/incidents, run AI analysis.
 * ADMIN   — manage members (except owners), API keys, channels, settings.
 * OWNER   — everything, including deleting the organisation and managing owners.
 */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'members:manage',
  'apps:write',
  'monitors:write',
  'incidents:write',
  'logs:read',
  'apikeys:manage',
  'ai:analyze',
  'channels:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = ['org:read', 'logs:read'];
const MEMBER: readonly Permission[] = [
  ...VIEWER,
  'apps:write',
  'monitors:write',
  'incidents:write',
  'ai:analyze',
];
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'org:update',
  'members:manage',
  'apikeys:manage',
  'channels:manage',
  'audit:read',
];
const OWNER: readonly Permission[] = [...ADMIN, 'org:delete'];

const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  MEMBER: new Set(MEMBER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(OWNER),
};

const ROLE_RANK: Record<OrgRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** An actor may only grant/modify roles strictly below their own (owners may manage owners). */
export function canManageRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'OWNER') return true;
  return hasPermission(actor, 'members:manage') && ROLE_RANK[target] < ROLE_RANK[actor];
}
