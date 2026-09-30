#!/usr/bin/env bash
# ==============================================================================
# Plex Playlist Curator - Proxmox VE Host Container Creation Script
# Run this directly on your Proxmox VE Host (in the PVE Shell or SSH).
# ==============================================================================

set -e

# Terminal Colors
YW=$(echo "\033[33m")
BL=$(echo "\033[36m")
RD=$(echo "\033[01;31m")
GN=$(echo "\033[1;92m")
CL=$(echo "\033[m")

echo -e "${BL}"
cat << "EOF"
  ____  _             ____  _             _ _     _      
 |  _ \| | _____  __ |  _ \| | __ _ _   _| (_)___| |_    
 | |_) | |/ _ \ \/ / | |_) | |/ _` | | | | | / __| __|   
 |  __/| |  __/>  <  |  __/| | (_| | |_| | | \__ \ |_    
 |_|   |_|\___/_/\_\ |_|   |_|\__,_|\__, |_|_|___/\__|   
  ____                _             |___/                
 / ___|   _ _ __ __ _| |_ ___  _ __                      
| |  | | | | '__/ _` | __/ _ \| '__|                     
| |__| |_| | | | (_| | || (_) | |                        
 \____\__,_|_|  \__,_|\__\___/|_|                        
                                                         
  Proxmox VE LXC Automated Deployment Script
EOF
echo -e "${CL}"

# 1. Check if running on Proxmox VE Host
if ! command -v pveversion >/dev/null 2>&1; then
  echo -e "${RD}Error: This script must be executed on a Proxmox VE host!${CL}"
  exit 1
fi

echo -e "${GN}[✔] Verified Proxmox VE environment ($(pveversion | cut -d' ' -f1))${CL}"

# 2. Storage Detection
echo -e "\n${YW}[1/7] Detecting Proxmox storage...${CL}"
VZTMPL_STORAGE=$(pvesm status -content vztmpl | awk 'NR>1 {print $1}' | head -n1)
ROOTFS_STORAGE=$(pvesm status -content rootdir | awk 'NR>1 {print $1}' | head -n1)

if [ -z "$VZTMPL_STORAGE" ]; then
  VZTMPL_STORAGE="local"
fi
if [ -z "$ROOTFS_STORAGE" ]; then
  ROOTFS_STORAGE="local-lvm"
fi

echo -e "  Template storage: ${BL}${VZTMPL_STORAGE}${CL}"
echo -e "  Container storage: ${BL}${ROOTFS_STORAGE}${CL}"

# 3. Get next available Container ID
NEXT_ID=$(pvesh get /cluster/nextid)
read -p "Enter Container ID [Default: ${NEXT_ID}]: " CT_ID
CT_ID=${CT_ID:-$NEXT_ID}

read -p "Enter Container Hostname [Default: plex-playlist-curator]: " CT_HOSTNAME
CT_HOSTNAME=${CT_HOSTNAME:-plex-playlist-curator}

read -p "Enter Disk Size in GB [Default: 4]: " DISK_SIZE
DISK_SIZE=${DISK_SIZE:-4}

read -p "Enter RAM in MB [Default: 1024]: " CT_RAM
CT_RAM=${CT_RAM:-1024}

read -p "Enter CPU Cores [Default: 1]: " CT_CORES
CT_CORES=${CT_CORES:-1}

read -p "Enter Network Bridge [Default: vmbr0]: " CT_BRIDGE
CT_BRIDGE=${CT_BRIDGE:-vmbr0}

# 4. Check & Download Debian 12 Template
echo -e "\n${YW}[2/7] Checking for Debian 12 template...${CL}"
pveam update >/dev/null 2>&1 || true

TEMPLATE_NAME=$(pveam available -section system | awk '{print $2}' | grep -E '^debian-12-standard' | sort -V | tail -n1)

if [ -z "$TEMPLATE_NAME" ]; then
  TEMPLATE_NAME="debian-12-standard_12.7-1_amd64.tar.zst"
fi

TEMPLATE_FILE="${VZTMPL_STORAGE}:vztmpl/${TEMPLATE_NAME}"

# Check if already present on host
if ! pvesm list "$VZTMPL_STORAGE" | grep -q "$TEMPLATE_NAME"; then
  echo -e "  Downloading template ${BL}${TEMPLATE_NAME}${CL}..."
  pveam download "$VZTMPL_STORAGE" "$TEMPLATE_NAME"
else
  echo -e "  ${GN}[✔] Template ${TEMPLATE_NAME} is already available.${CL}"
fi

# 5. Create LXC Container
echo -e "\n${YW}[3/7] Creating LXC container ${CT_ID} (${CT_HOSTNAME})...${CL}"

pct create "$CT_ID" "$TEMPLATE_FILE" \
  -hostname "$CT_HOSTNAME" \
  -cores "$CT_CORES" \
  -memory "$CT_RAM" \
  -swap 512 \
  -net0 "name=eth0,bridge=${CT_BRIDGE},ip=dhcp,firewall=1" \
  -storage "$ROOTFS_STORAGE" \
  -rootfs "${ROOTFS_STORAGE}:${DISK_SIZE}" \
  -ostype debian \
  -unprivileged 1 \
  -features nesting=1 \
  -onboot 1

echo -e "${GN}[✔] Container ${CT_ID} created successfully!${CL}"

# 6. Start Container
echo -e "\n${YW}[4/7] Starting container ${CT_ID}...${CL}"
pct start "$CT_ID"

echo -e "  Waiting for container to acquire network (DHCP)..."
IP=""
for i in {1..30}; do
  IP=$(pct exec "$CT_ID" -- ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1)
  if [ -n "$IP" ]; then
    break
  fi
  sleep 1
done

if [ -z "$IP" ]; then
  echo -e "${RD}Warning: Could not automatically detect IP address via DHCP.${CL}"
  IP="<CONTAINER-IP>"
else
  echo -e "${GN}[✔] Container acquired IP: ${BL}${IP}${CL}"
fi

# 7. Provision Node.js & Plex Playlist Curator inside container
echo -e "\n${YW}[5/7] Provisioning packages and application inside container...${CL}"

pct exec "$CT_ID" -- bash -c '
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git build-essential python3

# Install Node.js 24.x
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Clone repository
mkdir -p /opt/plex-playlist-creator
git clone https://github.com/lsink/PlexPlaylistCurator.git /opt/plex-playlist-creator
cd /opt/plex-playlist-creator

# Run automated in-container installer
chmod +x deploy/install-lxc.sh
./deploy/install-lxc.sh
'

echo -e "\n${GN}================================================================${CL}"
echo -e "${GN} 🎉 Installation Complete! Plex Playlist Curator is Running!   ${CL}"
echo -e "${GN}================================================================${CL}"
echo -e ""
echo -e "  Container ID:  ${BL}${CT_ID}${CL}"
echo -e "  Hostname:      ${BL}${CT_HOSTNAME}${CL}"
echo -e "  Web Dashboard: ${GN}http://${IP}:32500${CL}"
echo -e "  Webhook URL:   ${BL}http://${IP}:32500/api/webhook/plex${CL}"
echo -e ""
echo -e "  Management Commands (run on Proxmox host):"
echo -e "    pct enter ${CT_ID}                 # Enter container shell"
echo -e "    pct status ${CT_ID}                # Check container status"
echo -e "    pct stop ${CT_ID} / pct start ${CT_ID}"
echo -e ""
echo -e "${GN}================================================================${CL}"
