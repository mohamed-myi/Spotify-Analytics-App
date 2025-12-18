import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root 
config({ path: resolve(__dirname, '../../../.env') });

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from './routes/auth';
import { cronRoutes } from './routes/cron';
import { authMiddleware } from './middleware/auth';
import { closeRedis } from './lib/redis';
import { closeSyncWorker } from './workers/sync-worker';

const server = Fastify({ logger: true });

// Register plugins
server.register(cookie);

// Auth middleware for protected routes
server.addHook('preHandler', authMiddleware);

// Register routes
server.register(authRoutes);
server.register(cronRoutes);

// Health check
server.get('/health', async () => ({ status: 'ok' }));

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await server.listen({ port, host: '0.0.0.0' });
    console.log('Sync worker started');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log('Shutting down...');
  await closeSyncWorker();
  await closeRedis();
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
