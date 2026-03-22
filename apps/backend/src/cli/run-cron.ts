import { buildCronRequestTarget, listCronTaskNames } from '../lib/cron-tasks';

function parseTaskName(): string {
    const taskName = process.argv[2]?.trim();

    if (!taskName) {
        throw new Error(`Missing cron task name. Expected one of: ${listCronTaskNames().join(', ')}`);
    }

    return taskName;
}

async function main(): Promise<void> {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
        throw new Error('CRON_SECRET is required to trigger cron routes.');
    }

    const taskName = parseTaskName();
    const target = buildCronRequestTarget(taskName);

    const response = await fetch(target.url, {
        method: target.method,
        headers: {
            'x-cron-secret': cronSecret,
        },
    });

    const body = await response.text();

    if (!response.ok) {
        throw new Error(`Cron task ${taskName} failed with ${response.status}: ${body}`);
    }

    console.log(JSON.stringify({
        task: taskName,
        status: response.status,
        method: target.method,
        url: target.url,
        body,
    }));
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown cron runner error';
    console.error(message);
    process.exit(1);
});
