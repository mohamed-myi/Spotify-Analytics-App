import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables before any tests run
config({ path: resolve(__dirname, '../.env.test') });
