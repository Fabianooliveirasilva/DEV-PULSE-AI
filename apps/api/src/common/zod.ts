import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

// The schema is wrapped on purpose: Nest treats decorator arguments that expose a
// `transform` method as pipes (every zod schema has `.transform()`), and Nest 12 consumes
// `{ schema }` objects as its own Standard Schema options. `zodSchema` avoids both.
interface SchemaRef {
  zodSchema: z.ZodType;
}

const bodyDecorator = createParamDecorator(({ zodSchema }: SchemaRef, ctx: ExecutionContext) =>
  parseOrThrow(zodSchema, ctx.switchToHttp().getRequest<Request>().body ?? {}),
);
const queryDecorator = createParamDecorator(({ zodSchema }: SchemaRef, ctx: ExecutionContext) =>
  parseOrThrow(zodSchema, ctx.switchToHttp().getRequest<Request>().query),
);

/** Validates and types the JSON body with a zod schema at the controller boundary. */
export const ZodBody = (schema: z.ZodType) => bodyDecorator({ zodSchema: schema });
/** Validates and types query parameters with a zod schema. */
export const ZodQuery = (schema: z.ZodType) => queryDecorator({ zodSchema: schema });

export { parseOrThrow };
