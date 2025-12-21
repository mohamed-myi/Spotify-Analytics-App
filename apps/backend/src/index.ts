import './env';
import { resolve } from 'path';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { authRoutes } from './routes/auth';
import { cronRoutes } from './routes/cron';
import { importRoutes } from './routes/import';
import { statsRoutes } from './routes/stats';
import { settingsRoutes } from './routes/settings';
import { userRoutes } from './routes/users';
import { compareRoutes } from './routes/compare';
import { healthRoutes } from './routes/health';
import multipart from '@fastify/multipart';
import { authMiddleware } from './middleware/auth';
import { registerRateLimiting } from './middleware/rate-limit';
import { closeRedis } from './lib/redis';
import { closeSyncWorker } from './workers/sync-worker';
import { generateRequestId, logger } from './lib/logger';
import { globalErrorHandler } from './lib/error-handler';

// CORS origins: production + local development
const CORS_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://myi-v3-frontend.vercel.app']
  : ['http://127.0.0.1:3000', 'http://localhost:3000', 'https://myi-v3-frontend.vercel.app'];

export const build = async () => {
  const server = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    genReqId: () => generateRequestId(),
  });

  // Security headers (before other plugins)
  await server.register(helmet, {
    contentSecurityPolicy: false, // Disable CSP for API (no HTML served)
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow CORS
  });

  // CORS configuration
  await server.register(cors, {
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
  });

  await server.register(cookie);
  await server.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB Limit
    }
  });

  // Swagger Documentation
  await server.register(require('@fastify/swagger'), require('./lib/swagger').swaggerOptions);
  await server.register(require('@fastify/swagger-ui'), require('./lib/swagger').swaggerUiOptions);


  // Rate limiting (before routes, after auth context is available)
  await registerRateLimiting(server);

  // Auth middleware for protected routes
  server.addHook('preHandler', authMiddleware);

  // Global error handler
  server.setErrorHandler(globalErrorHandler);

  // Register routes
  await server.register(authRoutes);
  await server.register(cronRoutes);
  await server.register(importRoutes);
  await server.register(statsRoutes);
  await server.register(settingsRoutes);
  await server.register(userRoutes);
  await server.register(compareRoutes);
  await server.register(healthRoutes);

  return server;
};

import { audioFeaturesWorker } from './workers/audio-features-worker';
import { metadataWorker } from './workers/metadata-worker';
import { topStatsWorker, closeTopStatsWorker } from './workers/top-stats-worker';

// Start server if main module
if (require.main === module) {
  const start = async () => {
    try {
      const server = await build();
      const port = Number(process.env.PORT) || 3001;
      await server.listen({ port, host: '0.0.0.0' });

      logger.info('Server started, sync worker running');

      // Start background workers
      // In a real production setup, these would likely be processes/containers but I am running a free option.
      audioFeaturesWorker().catch(err => logger.error({ error: err }, 'Audio Features Worker failed'));
      metadataWorker().catch(err => logger.error({ error: err }, 'Metadata Worker failed'));

      const shutdown = async () => {
        logger.info('Shutting down gracefully...');
        await closeSyncWorker();
        await closeTopStatsWorker();
        await closeRedis();
        await server.close();
        process.exit(0);
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    } catch (err) {
      logger.error({ error: err }, 'Server failed to start');
      process.exit(1);
    }
  };

  start();
}

