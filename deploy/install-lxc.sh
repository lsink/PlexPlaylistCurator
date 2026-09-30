#!/bin/bash
# ==============================================================================
# Plex Interleaved Playlist Creator - Proxmox LXC Automated Setup Script
# Works on Debian 11/12 & Ubuntu 20.04/22.04/24.04 LXC containers
# ==============================================================================

set -e

echo "=========================================================="
echo " Setting up Plex Interleaved Playlist Creator in Proxmox  "
echo "=========================================================="

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root (or inside the LXC container as root)." >&2
  exit 1
fi

APP_DIR="/opt/plex-playlist-creator"
DATA_DIR="/opt/plex-playlist-creator/data"

echo "[1/6] Updating package repositories..."
apt-get update -y
apt-get install -y curl git build-essential python3

# Check Node.js installation
if ! command -v node > /dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
  echo "[2/6] Installing Node.js LTS (22.x)..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[2/6] Node.js is already installed ($(node -v))."
fi

echo "[3/6] Setting up application directory at ${APP_DIR}..."
mkdir -p "${APP_DIR}"
mkdir -p "${DATA_DIR}"

# If running installer from cloned repo directory
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${CURRENT_DIR}" != "${APP_DIR}" ]; then
  echo "Copying application files to ${APP_DIR}..."
  cp -r "${CURRENT_DIR}"/* "${APP_DIR}/"
  cp -r "${CURRENT_DIR}"/.[!.]* "${APP_DIR}/" 2>/dev/null || true
fi

cd "${APP_DIR}"

echo "[4/6] Installing dependencies and building production bundle..."
npm install
npm run build

echo "[5/6] Configuring systemd background service..."
NODE_BIN="$(which node)"
SERVICE_FILE="/etc/systemd/system/plex-playlist-creator.service"

cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=Plex Interleaved Playlist Creator Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=32500
Environment=DATA_DIR=${DATA_DIR}
ExecStart=${NODE_BIN} dist/server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=plex-playlist-creator

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now plex-playlist-creator

# Fetch local IP address
LOCAL_IP="$(hostname -I | awk '{print $1}')"
if [ -z "${LOCAL_IP}" ]; then
  LOCAL_IP="<CONTAINER-IP>"
fi

echo "[6/6] Checking service status..."
sleep 2

if systemctl is-active --quiet plex-playlist-creator; then
  echo "=========================================================="
  echo " Successfully installed and running!"
  echo " Access the dashboard at:"
  echo "   http://${LOCAL_IP}:32500"
  echo ""
  echo " Webhook URL for Plex Media Server:"
  echo "   http://${LOCAL_IP}:32500/api/webhook/plex"
  echo ""
  echo " Useful commands:"
  echo "   systemctl status plex-playlist-creator"
  echo "   journalctl -u plex-playlist-creator -f"
  echo "   systemctl restart plex-playlist-creator"
  echo "=========================================================="
else
  echo "Warning: Service failed to start. View logs with: journalctl -u plex-playlist-creator -xe"
  exit 1
fi
