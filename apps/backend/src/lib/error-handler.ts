import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from './logger';

const isProd = process.env.NODE_ENV === 'production';

interface ErrorResponse {
    error: string;
    message: string;
    statusCode: number;
    requestId?: string;
}

// Global error handler for Fastify.
export async function globalErrorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const statusCode = error.statusCode || 500;
    const requestId = request.id;
    const userId = (request as any).userId as string | undefined;

    // Log with full context
    logger.error(
        {
            err: error,
            requestId,
            userId,
            method: request.method,
            url: request.url,
            statusCode,
        },
        'Request error'
    );

    // Build response
    const response: ErrorResponse = {
        error: getErrorName(statusCode),
        message: getErrorMessage(error, statusCode),
        statusCode,
        requestId,
    };

    reply.status(statusCode).send(response);
}

// Returns appropriate error name for status code.
function getErrorName(statusCode: number): string {
    switch (statusCode) {
        case 400:
            return 'Bad Request';
        case 401:
            return 'Unauthorized';
        case 403:
            return 'Forbidden';
        case 404:
            return 'Not Found';
        case 409:
            return 'Conflict';
        case 422:
            return 'Unprocessable Entity';
        case 429:
            return 'Too Many Requests';
        case 500:
            return 'Internal Server Error';
        case 502:
            return 'Bad Gateway';
        case 503:
            return 'Service Unavailable';
        default:
            return statusCode >= 500 ? 'Server Error' : 'Client Error';
    }
}

// Returns appropriate error message.
function getErrorMessage(error: FastifyError, statusCode: number): string {
    // Validation errors; always show
    if (error.validation) {
        return `Validation failed: ${error.message}`;
    }

    // 4xx errors; show message
    if (statusCode < 500) {
        return error.message || 'Request failed';
    }

    // 5xx errors; hide details in production
    if (isProd) {
        return 'An unexpected error occurred. Please try again later.';
    }

    return error.message || 'Internal server error';
}
