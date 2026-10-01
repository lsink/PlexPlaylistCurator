# Plex Interleaved Playlist Creator 📺

An automated, production-ready Node.js application designed to run smoothly on a **Proxmox LXC Container** (or Docker). It connects to your Plex Media Server and curates seamless, balanced TV playlists that mix episodes from multiple shows in order—letting you enjoy a dynamic variety of television without getting bored of a single show or losing episode continuity.

---

## ✨ Features

- **Sequential Interleaving**: Always preserves strictly sequential order within each show ($S01E01 \rightarrow S01E02 \rightarrow S01E03 \dots$) while rotating between different series.
- **Auto-Proportional Pacing (Smooth Weighted Round-Robin)**: Automatically derives weights from remaining episode counts so shorter shows (e.g., a 10-episode miniseries) don't run out right away when mixed with 100+ episode long-runners. Episodes are smoothly distributed across the timeline.
- **Manual Weight Overrides**: Customize the rotation rhythm by assigning weight multipliers to specific shows (e.g. 2 sitcoms for every 1 drama).
- **Chronological Air Date Interleaving**: Cross-orders episodes across multiple shows by their original air dates—ideal for shared universes (Marvel Defenders, Star Trek, Arrowverse, Doctor Who).
- **Unwatched-Only Filtering**: Automatically keeps only upcoming unwatched episodes in the rotation.
- **One-Click "Mark as Unwatched"**: Reset watch status for entire shows directly from the dashboard via the Plex unscrobble API.
- **Rolling Window Buffer**: Caps Plex playlists to a configurable buffer (e.g. 25–50 upcoming episodes) to prevent Plex client lag, automatically replenishing as you watch.
- **Real-Time Plex Webhook Sync**: Provides an instant `/api/webhook/plex` endpoint. When an episode finishes playing (`media.scrobble`), the playlist advances immediately.
- **Automated Background Scheduler**: Built-in cron scheduler periodically synchronizes all playlists without manual intervention.
- **Live Visual Queue Preview**: Inspect the exact calculated sequence and show distribution ratios before syncing to Plex.
- **Ultra-Lightweight**: Single Node.js service (< 100MB RAM), embedded SQLite database (zero external database configuration).
- **Security & Multi-Playlist Support**: Create unlimited curated playlists, view audit sync logs, and secure the interface with an administrative password.

---

## 🚀 Proxmox LXC Deployment

### Option A: Automated 1-Click Proxmox VE Host Script (Recommended)
You can create and fully configure the LXC container in seconds directly from your **Proxmox VE Node Shell** (or SSH into your PVE host):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/lsink/PlexPlaylistCurator/main/deploy/create-proxmox-ct.sh)"
```

This script will automatically:
1. Detect storage and find the next available container ID.
2. Download the official Debian 12 LXC template (if not already downloaded).
3. Create an unprivileged, nested LXC container with DHCP networking.
4. Boot the container, install Node.js 22 LTS, clone this repository, and set up the `systemd` service.
5. Print your web access URL: `http://<CONTAINER-IP>:32500`.

---

### Option B: Install Inside an Existing Debian / Ubuntu Container
If you prefer to manually create your own LXC container or VM:
1. Create a Debian 12 or Ubuntu container in Proxmox (1 core, 512MB–1GB RAM, 4GB disk, unprivileged with nesting enabled).
2. Inside your container shell, run:

```bash
git clone https://github.com/lsink/PlexPlaylistCurator.git /opt/plex-playlist-creator
cd /opt/plex-playlist-creator
chmod +x deploy/install-lxc.sh
./deploy/install-lxc.sh
```

---

## 🔄 Updating to New Versions

### Inside Proxmox LXC Container
Whenever you want to update to the latest version of the app, simply open your container console and run:

```bash
update
# or
plex-update
```

*(This automatically fetches the latest code from GitHub, updates packages, recompiles the production build, and restarts the background service without touching your database or settings in `./data`.)*

---

## 🐳 Docker / Docker Compose Deployment

If you run Docker inside Proxmox or on another server:

```yaml
version: '3.8'

services:
  plex-playlist-creator:
    image: plex-playlist-creator:latest
    build: .
    container_name: plex-playlist-creator
    restart: unless-stopped
    ports:
      - "32500:32500"
    volumes:
      - ./data:/data
    environment:
      - PORT=32500
      - DATA_DIR=/data
      # Optional: if unset, a random per-install secret is generated and stored in the data volume
      # - SESSION_SECRET=<long-random-string>
      # Optional: number of reverse proxies in front of the app (see "Reverse proxy" below)
      # - TRUST_PROXY=1
```

Start the container:
```bash
docker compose up -d
```

Access the dashboard at `http://<HOST-IP>:32500`.

---

## 🔒 Reverse Proxy & Security Settings

These environment variables are optional. For the Proxmox LXC install, add them as extra `Environment=` lines in `/etc/systemd/system/plex-playlist-creator.service`, then run `systemctl daemon-reload && systemctl restart plex-playlist-creator`.

| Variable | Purpose |
|----------|---------|
| `TRUST_PROXY` | Set to the number of reverse proxies in front of the app (usually `1`), `loopback`, or a comma-separated list of proxy IPs/CIDRs. Without it, every visitor behind a proxy appears to come from the proxy's IP, so the login rate limit (5 failed attempts per 15 minutes) would lock everyone out together. With it, the real client IP is used, and the login cookie is marked `Secure` when the original request was HTTPS. Leave it unset when the app is reached directly. |
| `SESSION_SECRET` | Signs login cookies. If unset, a random secret is generated on first start and saved to `session-secret` in your data directory, so it is unique to your install and survives restarts. The placeholder values from older example configs are ignored. |

Logins are stored in the app's SQLite database, so you stay signed in across restarts (for up to 30 days).

---

## 🛠️ Configuration & Plex Setup

### 1. Connecting to Plex
1. Open the dashboard at `http://<IP>:32500`.
2. Click **Settings** (gear icon in the top right).
3. Enter your **Plex Server IP/URL** (e.g., `http://192.168.1.100:32400`).
4. Enter your **X-Plex-Token**.
   > **How to find your Plex Token:**
   > - In Plex Web, click on any TV show or episode.
   > - Click the three dots `...` &rarr; **Get Info** &rarr; **View XML** (bottom left).
   > - Look at the URL in your browser address bar: the value after `X-Plex-Token=` is your token.
   > - [Official Plex Guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
5. Click **Test Plex Connection** to verify that your TV libraries are detected.
6. Click **Save Settings**.

### 2. Setting Up Real-Time Webhooks (Optional for Plex Pass)
To make playlists advance instantly when you finish an episode:
1. In Plex Web, navigate to **Settings** &rarr; **Webhooks** &rarr; **Add Webhook**.
2. Paste the Webhook URL shown in your settings modal:
   ```text
   http://<YOUR-APP-IP>:32500/api/webhook/plex
   ```
3. Whenever an episode finishes playing (`media.scrobble`), the app instantly identifies all active playlists containing that show and recalculates the rotation.

---

## 🎛️ Interleaving Modes Explained

| Mode | Behavior | Ideal Use Case |
| :--- | :--- | :--- |
| **Runtime-Balanced (Smart Watch Time)** | Automatically calculates average episode runtime from Plex metadata and balances viewing time while factoring in remaining episode counts. Shorter series are smoothly paced across the rotation so they don't run out prematurely. | Equalizing viewing time when mixing short comedies with long dramas while preventing shorter shows from exhausting too quickly. |
| **Auto-Proportional Pacing** | Dynamically calculates weights from remaining unwatched episodes ($W_i = \text{unwatched}_i$) using Smooth Weighted Round-Robin (fair queuing). | Mixing a 10-episode miniseries with a 150-episode sitcom without burning through the short show in the first few days. |
| **Pure Round-Robin (1:1:1)** | Strictly cycles through one episode per show in sequence: Show A $\rightarrow$ Show B $\rightarrow$ Show C $\rightarrow$ Show A... | Shows with similar episode counts where you want equal rotation. |
| **Manual Weighted Override** | Multiplies show frequency based on custom integer weights you set (e.g. Show A = 2, Show B = 1) with smooth spacing. | Custom TV channel block vibes (e.g. 2 cartoons for every 1 drama). |
| **Chronological Air Date** | Orders all episodes across selected series by their original broadcast release date. | Franchise viewing orders (e.g. Arrowverse, Star Trek, Marvel Defenders). |

> 💡 **Mini-Binge Option (Episodes in a Row — Min/Max Range):**
> You can set a **Min and Max Episodes in a Row** range (e.g. `Min: 1, Max: 3`) on any playlist.
> - **In Runtime-Balanced mode:** Shorter shows (e.g. 20-min sitcoms) automatically receive the max batch size (3 episodes $\approx$ 60 min), while longer shows (e.g. 60-min dramas) receive 1 episode (60 min), creating natural 1-hour viewing blocks with zero show-hopping!
> - **In Auto-Proportional mode:** Larger shows play up to the max batch size to chew through their backlog, while smaller miniseries play the min batch size to last longer.
> - **Fixed batches:** Setting `Min: 2, Max: 2` simply plays exactly 2 in a row for all shows. (Default is `1–1` for classic 1-by-1 rotation).

---

## 📂 Data Storage & Backups

All playlist configurations, settings, and sync history logs are stored in a single SQLite database:
```
data/app.db
```
To back up or migrate your installation, simply copy the `data/app.db` file (and its `-wal`/`-shm` companion files).

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Run backend unit tests
npm test

# Run development server (concurrent backend and frontend with HMR)
npm run dev
```

---

## 📜 License
MIT License.
