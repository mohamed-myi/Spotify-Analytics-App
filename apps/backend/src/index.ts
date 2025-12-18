import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root 
config({ path: resolve(__dirname, '../../../.env') });

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from './routes/auth';
import { authMiddleware } from './middleware/auth';

const server = Fastify({ logger: true });

// Register plugins
server.register(cookie);

// Auth middleware for protected routes
server.addHook('preHandler', authMiddleware);

// Register routes
server.register(authRoutes);

// Health check
server.get('/health', async () => ({ status: 'ok' }));

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await server.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
