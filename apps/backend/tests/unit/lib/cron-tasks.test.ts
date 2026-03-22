import {
    buildCronRequestTarget,
    listCronTaskNames,
    resolveCronBaseUrl,
    resolveCronTask,
} from '../../../src/lib/cron-tasks';

describe('cron tasks', () => {
    const originalCronBaseUrl = process.env.CRON_BASE_URL;
    const originalPort = process.env.PORT;

    afterEach(() => {
        if (originalCronBaseUrl === undefined) {
            delete process.env.CRON_BASE_URL;
        } else {
            process.env.CRON_BASE_URL = originalCronBaseUrl;
        }

        if (originalPort === undefined) {
            delete process.env.PORT;
        } else {
            process.env.PORT = originalPort;
        }
    });

    test('lists supported task names', () => {
        expect(listCronTaskNames()).toEqual([
            'seed-sync',
            'seed-top-stats',
            'manage-partitions',
            'cleanup-stale-imports',
            'queue-status',
        ]);
    });

    test('resolves a known cron task', () => {
        expect(resolveCronTask('seed-sync')).toEqual({
            name: 'seed-sync',
            method: 'POST',
            path: '/cron/seed-sync',
        });
    });

    test('throws for an unknown cron task', () => {
        expect(() => resolveCronTask('unknown-task')).toThrow(
            'Unknown cron task "unknown-task". Expected one of: seed-sync, seed-top-stats, manage-partitions, cleanup-stale-imports, queue-status'
        );
    });

    test('uses CRON_BASE_URL when provided and trims trailing slashes', () => {
        process.env.CRON_BASE_URL = 'http://127.0.0.1:3001///';

        expect(resolveCronBaseUrl()).toBe('http://127.0.0.1:3001');
        expect(buildCronRequestTarget('seed-top-stats')).toEqual({
            method: 'POST',
            url: 'http://127.0.0.1:3001/cron/seed-top-stats',
        });
    });

    test('falls back to PORT when CRON_BASE_URL is missing', () => {
        delete process.env.CRON_BASE_URL;
        process.env.PORT = '4555';

        expect(buildCronRequestTarget('queue-status')).toEqual({
            method: 'GET',
            url: 'http://127.0.0.1:4555/cron/queue-status',
        });
    });
});
