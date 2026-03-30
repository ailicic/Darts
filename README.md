# 🎯 Darts – Cut Throat Mode

Real-time multiplayer darts scoring app. One URL serves as the **big screen** (full scoreboard); each player joins from their **phone** by scanning a QR code shown on that screen.

---

## Running on a VM with Docker (recommended)

### 1. Prerequisites

Install Docker and Docker Compose on your VM (Ubuntu / Debian):

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin nodejs npm
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out and back in after this
```

### 2. Clone, install and start

```bash
git clone https://github.com/ailicic/Darts.git
cd Darts

# Install production dependencies (needed before building the image)
npm install --omit=dev

# Build and start the container
docker compose up -d --build
```

The app is now running on **port 3000** and will restart automatically if the VM reboots.

### Managing the container

```bash
docker compose down          # stop
docker compose up -d         # start again
docker compose logs -f       # live logs
docker compose restart       # restart after code changes
```

---

## How to access

### 📺 Big screen (laptop / TV)

Open a browser on the VM and go to:

```
http://localhost:3000
```

If accessing from another machine on the same network, replace `localhost` with your VM's IP or hostname:

```
http://<VM_IP>:3000
```

**Steps:**
1. Enter the names of all players.
2. Click **Start Game**.
3. The scoreboard opens automatically in a new tab — put that on the big screen.

### 📱 Mobile phones (players)

**Option A – QR code scan (recommended)**

The scoreboard shows a **"📱 Scan to Join"** QR code in the bottom-right corner.

Each player:
1. Opens their phone camera.
2. Points it at the QR code on the big screen.
3. Taps the notification link that appears.
4. Taps their own name on the Join page.
5. Starts throwing darts!

> The QR code automatically encodes the correct IP/hostname of your server — it works as long as your phone and the VM are on the same network, or the VM is publicly accessible.

**Option B – direct link**

After creating a game, the setup page shows a personal link for each player:

```
http://<VM_IP>:3000/play/<gameId>/<playerId>
```

Send each player their link (e.g. via WhatsApp). Tapping it opens their throw screen directly.

---

## Firewall / port access

Make sure port **3000** is open:

```bash
# UFW (Ubuntu)
sudo ufw allow 3000/tcp

# AWS Security Group / GCP Firewall / Azure NSG
# → Add an inbound rule to allow TCP port 3000
```

After opening the port, players on any device that can reach your VM's public IP can access the app at `http://<PUBLIC_IP>:3000`.

---

## Running without Docker

Requires **Node.js 18+**:

```bash
npm install
npm start
```

Then access the app at `http://localhost:3000`.

---

## Cut Throat rules

| Term | Meaning |
|---|---|
| Targets | 15 · 16 · 17 · 18 · 19 · 20 · Bull |
| Close | Hit a target 3 times (/ = 1 mark, X = 2 marks, ✓ = closed) |
| Scoring | After you close a target, extra hits add points to **all opponents who haven't closed it** |
| Win | First player to close all targets **and** have the lowest score wins |

Each player has 3 darts per turn. Tap a target, select Single / Double / Triple, tap **Throw**. When finished, tap **End Turn**.
