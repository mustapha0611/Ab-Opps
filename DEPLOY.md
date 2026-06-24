# ARBHUNT - Contabo VPS Deployment Guide

Deploy ARBHUNT to Contabo (Germany) and bypass Nigerian ISP-level crypto API restrictions.

## Table of Contents

1. [Why Contabo](#why-contabo)
2. [Order the VPS](#order-the-vps)
3. [Connect with PuTTY](#connect-with-putty)
4. [Initial Server Setup](#initial-server-setup)
5. [Clone the Project](#clone-the-project)
6. [Configure Environment](#configure-environment)
7. [Build the Frontend](#build-the-frontend)
8. [Configure Nginx](#configure-nginx)
9. [Start the Backend with PM2](#start-the-backend-with-pm2)
10. [Firewall](#firewall)
11. [Buy a Domain (optional)](#buy-a-domain-optional)
12. [SSL Certificate (optional)](#ssl-certificate-optional)
13. [Usage & Maintenance](#usage--maintenance)
14. [Troubleshooting](#troubleshooting)

---

## Why Contabo

- **Bypasses Nigerian IP blocks**: Exchange APIs (KuCoin, Bybit, MEXC, Gate.io, Binance) are restricted or throttled from Nigerian IPs. A German Contabo IP makes all 7 exchanges accessible.
- **Cost**: ~€6/mo for 6 vCPU, 16GB RAM, 400GB SSD — 4-8x cheaper than AWS/DigitalOcean for equivalent specs.
- **Simple setup**: No Docker or database needed. Just Nginx + PM2 + Node.js.

---

## Order the VPS

1. Go to [contabo.com](https://contabo.com) → **Cloud VPS**
2. Select **VPS S** (€5.99/mo)
3. Configuration:
   - OS: **Ubuntu 22.04 LTS**
   - Data Center: **Germany (Munich)** (prevents KuCoin/Bybit/MEXC geoblocking)
   - Auth: Password or SSH key (password is fine to start)
4. Complete checkout
5. You'll receive an email with your **IP address**, **username** (`root`), and **root password**

---

## Connect with PuTTY

1. Download PuTTY from [putty.org](https://www.putty.org) (get `putty.exe`, no installer needed)
2. Open PuTTY:

```
Host Name: <YOUR_CONTABO_IP>
Port: 22
Connection type: SSH
```

3. Click **Open** → **Accept** the host key prompt
4. Login:
   - Username: `root`
   - Password: paste the emailed password (right-click pastes in PuTTY)
5. You'll be forced to change the password on first login

### PuTTY Tips

- **Right-click** = paste (there is no Ctrl+V)
- **Select text** = automatically copies to clipboard
- **Save session**: Enter IP, type `arbhunt` as Saved Sessions, click Save

---

## Initial Server Setup

Run these commands one by one:

```bash
# Update system packages
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git nginx

# Verify
node -v    # should show v20.x
npm -v     # should show 10.x

# Install PM2 globally (process manager)
npm install -g pm2

# Install unzip (useful later)
apt install -y unzip
```

---

## Clone the Project

```bash
cd /opt
git clone <YOUR-REPO-URL> arbhunt
cd arbhunt

# Install backend dependencies
cd Backend
npm install

# Install frontend dependencies
cd ../Frontend
npm install
```

If your repo is private:
- Use a personal access token: `git clone https://username:token@github.com/username/repo.git`
- Or upload files via WinSCP (graphical SFTP client for Windows)

---

## Configure Environment

### Backend

```bash
nano /opt/arbhunt/Backend/.env
```

Paste:

```
FREECRYPTO_API_KEY=2o0naausk783ltjsc4ga
PORT=3001
USE_PUBLIC_DNS=false
```

Save: `Ctrl+X` → `Y` → `Enter`

### Frontend

```bash
nano /opt/arbhunt/Frontend/.env.local
```

Paste (leave empty — Nginx proxies API on the same origin):

```
VITE_API_URL=
```

Save: `Ctrl+X` → `Y` → `Enter`

---

## Build the Frontend

```bash
cd /opt/arbhunt/Frontend
npx vite build
```

This creates the `dist/` folder with production static files.

---

## Configure Nginx

Create the site config:

```bash
nano /etc/nginx/sites-available/arbhunt
```

Paste:

```nginx
server {
    listen 80;
    server_name _;

    root /opt/arbhunt/Frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Save: `Ctrl+X` → `Y` → `Enter`

Enable it:

```bash
ln -s /etc/nginx/sites-available/arbhunt /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

nginx -t
systemctl restart nginx
```

---

## Start the Backend with PM2

```bash
cd /opt/arbhunt/Backend

# Install tsx for running TypeScript directly
npm install -D tsx

# Start the backend
pm2 start --name arbhunt-backend "npx tsx src/index.ts"

# Save PM2 config (auto-restart on reboot)
pm2 save

# Enable PM2 startup script
pm2 startup
```

After `pm2 startup`, it will print a command — **copy and run that command** (it looks like `env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root`).

---

## Firewall

```bash
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS (if using SSL later)
ufw --force enable
```

---

## Buy a Domain (optional)

### Recommended Registrars

| Registrar | .xyz Price | Payment | Notes |
|-----------|-----------|---------|-------|
| Namecheap | ~$1-2 first yr | Nigerian cards (Interswitch/Verve), Paystack ✅ | Good for beginners |
| Cloudflare | ~$9.05/yr (at cost) | Foreign card only ❌ | Cheapest long-term |
| Whogohost | ~₦5,000-7,000 (.com.ng) | Bank transfer ✅ | Nigerian local registrar |
| Porkbun | ~$1-2 first yr | Foreign card only ❌ | Also cheap |

### Point DNS to Contabo

After buying your domain (e.g., `arbhunt.xyz`):

1. Go to your registrar's DNS management page
2. Add an **A Record**:
   ```
   Type: A
   Host: @
   Value: <YOUR_CONTABO_IP>
   TTL: Automatic (or 5 min)
   ```
3. Add a **CNAME Record** for `www`:
   ```
   Type: CNAME
   Host: www
   Value: @
   ```

### Update Nginx with your Domain

```bash
nano /etc/nginx/sites-available/arbhunt
```

Change `server_name _;` to:

```nginx
server_name arbhunt.xyz www.arbhunt.xyz;
```

Then:

```bash
nginx -t && systemctl restart nginx
```

---

## SSL Certificate (optional)

Get a free HTTPS certificate from Let's Encrypt:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d arbhunt.xyz -d www.arbhunt.xyz
```

Follow the prompts. Certbot will automatically update your Nginx config.

Certificates renew automatically via a systemd timer. To test renewal:

```bash
certbot renew --dry-run
```

---

## Usage & Maintenance

### Common PM2 Commands

```bash
pm2 list                          # Show all processes
pm2 logs arbhunt-backend          # View live logs
pm2 logs arbhunt-backend --lines 50   # Last 50 log lines
pm2 restart arbhunt-backend       # Restart backend
pm2 stop arbhunt-backend          # Stop backend
```

### Update the App After Code Changes

```bash
cd /opt/arbhunt
git pull

# If backend changed
cd Backend
npm install
pm2 restart arbhunt-backend

# If frontend changed
cd ../Frontend
npm install
npx vite build

# If Nginx config changed
nginx -t && systemctl restart nginx
```

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Backend won't start | `pm2 logs arbhunt-backend --lines 50` |
| Nginx not serving | `nginx -t` then `systemctl status nginx` |
| Can't reach server at all | Verify ufw rules: `ufw status` |
| API returning 502 | Backend may be down: `pm2 list` |
| No arbitrage data | Check FreeCryptoAPI key in `.env` |
| Exchange returning empty | Check `pm2 logs` for error messages |
| DNS not resolving | Run `nslookup yourdomain.xyz` from a separate terminal |
| Want to test API directly from server | `curl http://127.0.0.1:3001/api/scanner` |

### Check if API is Accessible

From your browser: `http://<YOUR_CONTABO_IP>` — should show the dashboard.

From the server itself:

```bash
curl http://127.0.0.1:3001/api/scanner
```

Should return JSON arbitrage data.
