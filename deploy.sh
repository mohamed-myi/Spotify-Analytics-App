#!/bin/bash
set -e

echo "Deploying MYI-V3..."

cd /home/ec2-user/myi-v3

echo "Verifying Node.js runtime..."
node -e "const major = Number(process.versions.node.split('.')[0]); if (major !== 22) { console.error('Node 22.x is required. Found ' + process.versions.node); process.exit(1); }"

echo "Pulling latest code..."
git reset --hard HEAD
git pull origin main

echo "Installing dependencies..."
npm ci

echo "Building backend..."
npm run build --workspace=backend

echo "Building frontend..."
npm run build --workspace=frontend

echo "Restarting services..."
pm2 restart all --update-env

echo "Deployment complete!"
pm2 status
