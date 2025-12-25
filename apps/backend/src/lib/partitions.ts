import { prisma } from './prisma';

// Shared logic for creating and managing listening_events partitions.
// Used by both production cron jobs and test setup.
// Creates a partition for a given date if it doesn't exist.
export async function ensurePartitionForDate(date: Date): Promise<{ partitionName: string; created: boolean }> {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const partitionName = `listening_events_y${year}m${String(month).padStart(2, '0')}`;

    const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

    // Any data older than Dec 25, 2020 falls into the default 'listening_events_legacy' partition, so we skip partition creation.
    const cutoffDate = new Date('2020-12-25T00:00:00Z');
    if (new Date(startDate) < cutoffDate) {
        return { partitionName: 'listening_events_legacy', created: false };
    }

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${partitionName}" 
            PARTITION OF "listening_events"
            FOR VALUES FROM ('${startDate}'::timestamptz) TO ('${endDate}'::timestamptz);
        `);

        // Apply hardening settings
        await Promise.all([
            prisma.$executeRawUnsafe(`
                ALTER TABLE "${partitionName}" SET (autovacuum_vacuum_scale_factor = 0.01);
            `),
            prisma.$executeRawUnsafe(`
                ALTER TABLE "${partitionName}" SET (fillfactor = 90);
            `)
        ]);

        return { partitionName, created: true };
    } catch (error: any) {
        // Already exists is not an error
        if (error.code === '42P07' || error.message?.includes('already exists')) {
            return { partitionName, created: false };
        }
        throw error;
    }
}

// Creates partitions for multiple dates at once (concurrent).
// Extracts unique months to avoid duplicate creation.
export async function ensurePartitionsForDates(dates: Date[]): Promise<void> {
    const uniqueMonths = new Set(dates.map(d =>
        `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    ));

    await Promise.allSettled(
        Array.from(uniqueMonths).map(key => {
            const [year, month] = key.split('-').map(Number);
            return ensurePartitionForDate(new Date(Date.UTC(year, month, 1)));
        })
    );
}

// Creates partitions for a date range for historical imports
export async function ensurePartitionsForRange(
    startYear: number,
    endYear: number
): Promise<{ created: number; existing: number }> {
    let created = 0;
    let existing = 0;

    const results = await Promise.allSettled(
        Array.from({ length: (endYear - startYear + 1) * 12 }, (_, i) => {
            const year = startYear + Math.floor(i / 12);
            const month = i % 12;
            return ensurePartitionForDate(new Date(Date.UTC(year, month, 1)));
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            if (result.value.created) created++;
            else existing++;
        }
    }

    return { created, existing };
}

// Enforces required indexes on a partition.
// Creates the unique composite index if missing.
export async function enforcePartitionIndexes(partitionName: string): Promise<string[]> {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = ${partitionName};
    `;

    const indexNames = indexes.map(i => i.indexname);
    const hasUniqueIndex = indexNames.some(name => name.includes('user_id_track_id_played_at'));

    if (!hasUniqueIndex) {
        const indexName = `${partitionName}_user_id_track_id_played_at_key`;
        try {
            await prisma.$executeRawUnsafe(`
                CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}"
                ON "${partitionName}" ("user_id", "track_id", "played_at");
            `);
            indexNames.push(indexName);
            console.log(`Created missing index: ${indexName}`);
        } catch (error: any) {
            console.error(`Failed to create index ${indexName}:`, error.message);
        }
    }

    return indexNames;
}
