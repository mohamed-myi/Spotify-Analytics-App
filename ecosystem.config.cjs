module.exports = {
    apps: [
        {
            name: 'backend',
            cwd: '/home/ec2-user/myi-v3/apps/backend',
            script: 'dist/index.js',
            instances: 1,
            autorestart: true,
            max_memory_restart: '400M',
            env: {
                NODE_ENV: 'production',
                PORT: 3001
            }
        },
        {
            name: 'frontend',
            cwd: '/home/ec2-user/myi-v3/apps/frontend',
            script: 'node_modules/next/dist/bin/next',
            args: 'start -p 3000',
            instances: 1,
            autorestart: true,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'production',
                BACKEND_URL: 'http://127.0.0.1:3001'
            }
        }
    ]
};
