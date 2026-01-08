#!/bin/bash
set -e

echo "Deploying MYI-V3..."

cd /home/ec2-user/myi-v3

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
pnpm install

echo "Building backend..."
cd apps/backend && pnpm run build && cd ../..

echo "Building frontend..."
cd apps/frontend && pnpm run build && cd ../..

echo "Restarting services..."
pm2 restart all

echo "Deployment complete!"
pm2 status
