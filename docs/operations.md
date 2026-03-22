# Operations

## Runtime Pinning

- The repo is pinned to Node 22 via `.nvmrc`, `.node-version`, package `engines`, and CI.
- `deploy.sh` now bootstraps Node 22 via `nvm` on the EC2 host if the active shell is still on an older runtime.
- If `pm2` is missing after the runtime switch, `deploy.sh` reinstalls it under the active Node 22 toolchain before restarting services.
- The host still needs outbound access to GitHub and Node.js downloads the first time `nvm` installs Node 22.

## EC2 Cron Scheduler

The backend already exposes authenticated cron endpoints. The recommended production setup is to trigger those routes from the EC2 host instead of using Lambda as a scheduler bridge.

### Backend Cron Runner

Build the backend first, then invoke one of these scripts from the EC2 host:

```bash
npm run cron:seed-sync --workspace=backend
npm run cron:seed-top-stats --workspace=backend
npm run cron:manage-partitions --workspace=backend
npm run cron:cleanup-stale-imports --workspace=backend
```

Required environment:

- `CRON_SECRET`: shared secret already enforced by the cron routes
- `CRON_BASE_URL`: optional; defaults to `http://127.0.0.1:${PORT:-3001}`

### Suggested Crontab

```cron
*/15 * * * * cd /home/ec2-user/myi-v3 && npm run cron:seed-sync --workspace=backend
0 3 * * * cd /home/ec2-user/myi-v3 && npm run cron:seed-top-stats --workspace=backend
*/10 * * * * cd /home/ec2-user/myi-v3 && npm run cron:cleanup-stale-imports --workspace=backend
5 0 * * * cd /home/ec2-user/myi-v3 && npm run cron:manage-partitions --workspace=backend
```

`manage-partitions` is intentionally daily because the route is idempotent and keeps future partitions warm.

## Recovery Checks

When the site is down, verify these in order:

1. EC2 instance reachable and PM2 processes running.
2. Backend `GET /health` returns `ok`.
3. Backend `GET /health/detailed` shows database and Redis as `up`.
4. Frontend can reach the backend URL configured in `apps/frontend/next.config.ts`.
5. Cron runner can hit `/cron/queue-status` locally with `CRON_SECRET` set.
