import { defineConfig } from 'prisma/config';

// DATABASE_URL is only required for commands that talk to the database
// (migrate, studio). `prisma generate` works without it, e.g. in Docker builds.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
