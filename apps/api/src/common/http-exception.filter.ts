import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@devpulse/database';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Single error shape for the whole API. Internal errors never leak stack traces or
 * database messages to clients; they are logged with the request id instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const body = this.toBody(exception);
    body.requestId = req.id === undefined ? undefined : String(req.id);
    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId: req.id, path: req.path }, 'Unhandled error');
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const payload =
        typeof response === 'string'
          ? { message: response }
          : (response as Record<string, unknown>);
      const message = Array.isArray(payload.message)
        ? payload.message.join('; ')
        : String(payload.message ?? exception.message);
      return {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        details: payload.details,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: 409,
          error: 'CONFLICT',
          message: 'A resource with the same unique value already exists',
        };
      }
      if (exception.code === 'P2025') {
        return { statusCode: 404, error: 'NOT_FOUND', message: 'Resource not found' };
      }
      if (exception.code === 'P2003') {
        return {
          statusCode: 409,
          error: 'CONFLICT',
          message: 'Operation violates a relation constraint',
        };
      }
    }
    // body-parser errors (payload too large, malformed JSON)
    const status = (exception as { status?: number; type?: string })?.status;
    if (status === 413)
      return { statusCode: 413, error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    if (status === 400 && (exception as { type?: string }).type === 'entity.parse.failed') {
      return { statusCode: 400, error: 'BAD_REQUEST', message: 'Malformed JSON body' };
    }
    return { statusCode: 500, error: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
  }
}
