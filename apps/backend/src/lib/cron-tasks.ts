export const cronTaskConfig = {
    'seed-sync': { method: 'POST', path: '/cron/seed-sync' },
    'seed-top-stats': { method: 'POST', path: '/cron/seed-top-stats' },
    'manage-partitions': { method: 'POST', path: '/cron/manage-partitions' },
    'cleanup-stale-imports': { method: 'POST', path: '/cron/cleanup-stale-imports' },
    'queue-status': { method: 'GET', path: '/cron/queue-status' },
} as const;

export type CronTaskName = keyof typeof cronTaskConfig;

export interface CronRequestTarget {
    url: string;
    method: 'GET' | 'POST';
}

const cronTaskNames = Object.keys(cronTaskConfig) as CronTaskName[];

export function listCronTaskNames(): CronTaskName[] {
    return [...cronTaskNames];
}

export function resolveCronTask(taskName: string) {
    const task = cronTaskConfig[taskName as CronTaskName];

    if (!task) {
        throw new Error(`Unknown cron task "${taskName}". Expected one of: ${cronTaskNames.join(', ')}`);
    }

    return { name: taskName as CronTaskName, ...task };
}

export function resolveCronBaseUrl(port = process.env.PORT ?? '3001'): string {
    const rawBaseUrl = process.env.CRON_BASE_URL?.trim() || `http://127.0.0.1:${port}`;
    return rawBaseUrl.replace(/\/+$/, '');
}

export function buildCronRequestTarget(taskName: string): CronRequestTarget {
    const task = resolveCronTask(taskName);
    return {
        method: task.method,
        url: `${resolveCronBaseUrl()}${task.path}`,
    };
}
