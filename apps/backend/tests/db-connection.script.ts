import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../.env') });

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Testing database connection...');

    // Connection Check
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    console.log('Database connected:', result);

    // Tables Check
    const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
    console.log('Tables created:', tables);

    // User Model Check
    const users = await prisma.user.findMany();
    console.log('User query works, count:', users.length);

    console.log('\nAll database tests passed!');
}

main()
    .catch((e) => {
        console.error('Database test failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
