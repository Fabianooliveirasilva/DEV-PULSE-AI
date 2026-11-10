import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@devpulse/database';

export function slugify(name: string) {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'org';
}

export async function uniqueSlug(prisma: PrismaClient, name: string) {
  const base = slugify(name);
  if (!(await prisma.organization.findUnique({ where: { slug: base }, select: { id: true } })))
    return base;
  return `${base}-${randomBytes(3).toString('hex')}`;
}
