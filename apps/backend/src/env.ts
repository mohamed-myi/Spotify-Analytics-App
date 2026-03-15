
import { z } from 'zod';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root to ensure they're present before validation
config({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3001').transform(Number),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    SPOTIFY_CLIENT_ID: z.string().min(1),
    SPOTIFY_CLIENT_SECRET: z.string().min(1),
    ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),

    // Circuit Breaker Configurations
    SPOTIFY_CB_THRESHOLD: z.string().default('5').transform(Number),
    SPOTIFY_CB_RESET_TIMEOUT: z.string().default('30000').transform(Number),
    SPOTIFY_CB_WINDOW_DURATION: z.string().default('60000').transform(Number),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
    console.error('Invalid environment variables:');
    console.error(JSON.stringify(_env.error.format(), null, 2));
    process.exit(1);
}

export const env = _env.data;

export type Env = z.infer<typeof envSchema>;
