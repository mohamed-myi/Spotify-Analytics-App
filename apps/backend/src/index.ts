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
import { closeSyncWorker, setupSyncWorker } from './workers/sync-worker';
import { generateRequestId, logger } from './lib/logger';
import { globalErrorHandler } from './lib/error-handler';

const CORS_ORIGINS = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL || 'http://localhost:3000']
  : ['http://127.0.0.1:3000', 'http://localhost:3000'];

export const build = async () => {
  const server = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    genReqId: () => generateRequestId(),
  });

  server.setReplySerializer((payload) => {
    return JSON.stringify(payload, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
  });

  await server.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

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
      fileSize: 100 * 1024 * 1024,
    }
  });

  await server.register(require('@fastify/swagger'), require('./lib/swagger').swaggerOptions);
  await server.register(require('@fastify/swagger-ui'), require('./lib/swagger').swaggerUiOptions);


  await registerRateLimiting(server);

  server.addHook('preHandler', authMiddleware);

  server.setErrorHandler(globalErrorHandler);

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

import { metadataWorker } from './workers/metadata-worker';
import { closeImportWorker, importWorker } from './workers/import-worker';
import { closeTopStatsWorker, setupTopStatsWorker } from './workers/top-stats-worker';
import { HealingService } from './services/healing';

if (require.main === module) {
  const start = async () => {
    try {
      const server = await build();
      const port = Number(process.env.PORT) || 3001;
      await server.listen({ port, host: '0.0.0.0' });

      // Initialize workers
      setupSyncWorker();
      setupTopStatsWorker();

      // Import worker is auto-initialized on import, just log it's ready
      logger.info({ worker: importWorker.name }, 'Import worker initialized');

      logger.info('Server started, sync worker running');

      metadataWorker().catch(err => logger.error({ error: err }, 'Metadata Worker failed'));

      HealingService.healAll().catch(err => logger.error({ error: err }, 'Healing Service failed'));

      const shutdown = async () => {
        logger.info('Shutting down gracefully...');
        await closeSyncWorker();
        await closeTopStatsWorker();
        await closeImportWorker();
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

