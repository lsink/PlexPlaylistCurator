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

### 1. Create a Debian or Ubuntu Container in Proxmox
- In Proxmox VE, create a new LXC container using a standard **Debian 12** or **Ubuntu 22.04/24.04** template.
- Recommended resources:
  - **Cores**: 1
  - **Memory**: 512 MB – 1 GB (app uses < 100 MB)
  - **Disk**: 4 GB – 8 GB
  - **Network**: Static or DHCP IP on your home LAN.

### 2. Run the Automated Installer
Log in to your LXC container console (as `root`) and run:

```bash
# Clone the repository
git clone https://github.com/lsink/PlexPlaylistCurator.git /opt/plex-playlist-creator

# Run the installer
cd /opt/plex-playlist-creator
chmod +x deploy/install-lxc.sh
./deploy/install-lxc.sh
```

The script will automatically:
1. Install Node.js LTS and build tools.
2. Install npm dependencies and build production assets.
3. Configure and start a `systemd` service (`plex-playlist-creator.service`).
4. Display your web dashboard URL: `http://<CONTAINER-IP>:32500`.

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
      - SESSION_SECRET=choose-a-strong-session-secret
```

Start the container:
```bash
docker compose up -d
```

Access the dashboard at `http://<HOST-IP>:32500`.

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
| **Auto-Proportional Pacing** | Dynamically calculates weights from remaining unwatched episodes ($W_i = \text{unwatched}_i$) using Smooth Weighted Round-Robin (fair queuing). | Mixing a 10-episode miniseries with a 150-episode sitcom without burning through the short show in the first few days. |
| **Pure Round-Robin (1:1:1)** | Strictly cycles through one episode per show in sequence: Show A $\rightarrow$ Show B $\rightarrow$ Show C $\rightarrow$ Show A... | Shows with similar episode counts where you want equal rotation. |
| **Manual Weighted Override** | Multiplies show frequency based on custom integer weights you set (e.g. Show A = 2, Show B = 1) with smooth spacing. | Custom TV channel block vibes (e.g. 2 cartoons for every 1 drama). |
| **Chronological Air Date** | Orders all episodes across selected series by their original broadcast release date. | Franchise viewing orders (e.g. Arrowverse, Star Trek, Marvel Defenders). |

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
