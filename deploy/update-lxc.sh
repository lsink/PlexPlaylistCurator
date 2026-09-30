#!/usr/bin/env bash
# ==============================================================================
# Plex Playlist Curator - In-Container Update Script
# Run this inside your container to pull the latest version and update the app.
# ==============================================================================

set -e

# Terminal Colors
BL="\033[36m"
GN="\033[1;92m"
YW="\033[33m"
RD="\033[01;31m"
CL="\033[m"

echo -e "${BL}"
echo "=========================================================="
echo "    Plex Playlist Curator - Application Updater           "
echo "=========================================================="
echo -e "${CL}"

# Check root privileges
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RD}Error: This script must be run as root.${CL}" >&2
  exit 1
fi

APP_DIR="/opt/plex-playlist-creator"

# If current directory contains package.json, use it
if [ -f "$(pwd)/package.json" ]; then
  APP_DIR="$(pwd)"
fi

if [ ! -d "${APP_DIR}" ]; then
  echo -e "${RD}Error: Could not locate application directory at ${APP_DIR}.${CL}"
  exit 1
fi

cd "${APP_DIR}"

# 1. Detect Current Version
OLD_VERSION="unknown"
if [ -f "package.json" ]; then
  OLD_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
fi

echo -e "${YW}[1/5] Checking for updates (current version: v${OLD_VERSION})...${CL}"

# Ensure git safe directory
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

# 2. Pull Latest Changes from GitHub
echo -e "${YW}[2/5] Fetching latest release from GitHub...${CL}"
git fetch origin main
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

if [ "${LOCAL_HASH}" = "${REMOTE_HASH}" ]; then
  echo -e "${GN}[✔] You are already running the latest commit (${LOCAL_HASH:0:7}).${CL}"
  read -p "Force rebuild anyway? (y/N): " FORCE_REBUILD
  if [[ ! "$FORCE_REBUILD" =~ ^[Yy]$ ]]; then
    echo "Update aborted."
    exit 0
  fi
fi

# Reset to latest code (preserving data/ folder as it is ignored)
git reset --hard origin/main

# 3. Detect New Version
NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "latest")

# 4. Install Dependencies & Build
echo -e "${YW}[3/5] Updating dependencies (npm install)...${CL}"
npm install

echo -e "${YW}[4/5] Building production client & server...${CL}"
npm run build

# 5. Restart Background Service
echo -e "${YW}[5/5] Restarting plex-playlist-creator service...${CL}"
if systemctl is-active --quiet plex-playlist-creator; then
  systemctl restart plex-playlist-creator
else
  systemctl enable --now plex-playlist-creator
fi

sleep 2

if systemctl is-active --quiet plex-playlist-creator; then
  echo -e "\n${GN}==========================================================${CL}"
  echo -e "${GN} 🎉 Update Complete!${CL}"
  echo -e "    Version: ${BL}v${OLD_VERSION}${CL} ➔ ${GN}v${NEW_VERSION}${CL}"
  echo -e "    Status:  ${GN}Active & Running${CL}"
  echo -e "${GN}==========================================================${CL}"
else
  echo -e "\n${RD}Warning: Service failed to restart. Check logs with:${CL}"
  echo -e "  journalctl -u plex-playlist-creator -n 50 --no-pager"
  exit 1
fi
