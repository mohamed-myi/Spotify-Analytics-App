#!/bin/bash
set -euo pipefail

APP_DIR="/home/ec2-user/myi-v3"
NODE_VERSION_SPEC="22"
REQUIRED_NODE_MAJOR="22"
NVM_INSTALL_VERSION="v0.40.3"

log() {
  echo "$1"
}

current_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  node -p "process.versions.node"
}

has_required_node() {
  local version

  version="$(current_node_version 2>/dev/null || true)"
  [ "${version%%.*}" = "$REQUIRED_NODE_MAJOR" ]
}

load_nvm() {
  local nvm_script
  local candidates=(
    "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    "$HOME/.nvm/nvm.sh"
    "/usr/local/share/nvm/nvm.sh"
  )

  for nvm_script in "${candidates[@]}"; do
    if [ -s "$nvm_script" ]; then
      export NVM_DIR="${nvm_script%/nvm.sh}"
      # shellcheck disable=SC1090
      . "$nvm_script" --no-use
      return 0
    fi
  done

  return 1
}

install_nvm() {
  log "Installing nvm..."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  PROFILE=/dev/null curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_INSTALL_VERSION}/install.sh" | PROFILE=/dev/null bash
  load_nvm
}

ensure_node_runtime() {
  if has_required_node; then
    log "Using Node $(node -v)"
    return 0
  fi

  log "Node ${REQUIRED_NODE_MAJOR}.x is not active. Bootstrapping runtime..."

  if ! load_nvm; then
    install_nvm
  fi

  nvm install "$NODE_VERSION_SPEC"
  nvm alias default "$NODE_VERSION_SPEC" >/dev/null
  nvm use "$NODE_VERSION_SPEC" >/dev/null
  hash -r

  if ! has_required_node; then
    echo "Node ${REQUIRED_NODE_MAJOR}.x is required. Found $(node -v 2>/dev/null || echo 'not installed')" >&2
    exit 1
  fi

  log "Using Node $(node -v)"
}

ensure_pm2() {
  local pm2_path

  pm2_path="$(command -v pm2 2>/dev/null || true)"
  if [ -n "$pm2_path" ] && [[ "$pm2_path" = "$NVM_DIR/"* ]]; then
    return 0
  fi

  log "Installing PM2 for Node $(node -v)..."
  npm install -g pm2
  hash -r
}

main() {
  log "Deploying MYI-V3..."

  ensure_node_runtime

  cd "$APP_DIR"

  log "Pulling latest code..."
  git reset --hard HEAD
  git pull origin main

  log "Installing dependencies..."
  npm ci

  log "Building backend..."
  npm run build --workspace=backend

  log "Building frontend..."
  npm run build --workspace=frontend

  ensure_pm2

  log "Restarting services..."
  pm2 restart all --update-env
  pm2 save >/dev/null

  log "Deployment complete!"
  pm2 status
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
