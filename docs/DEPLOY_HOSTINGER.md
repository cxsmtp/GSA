# Deploying on Hostinger

Two ways. **Option A (KVM VPS + Docker)** is recommended: full control, automatic HTTPS, data in a backed-up volume, hardened container. Option B works on Hostinger's managed Node.js web hosting if you already have a Business/Cloud plan.

Before either: buy/point your domain (e.g. `gsabadminton.in`) — in hPanel → Domains → DNS, set an **A record** for `@` and `www` to the server's IP.

## Option A — Hostinger KVM VPS (Docker)

1. hPanel → VPS → choose **KVM 1 or KVM 2** with the **Ubuntu 24.04 with Docker** template. Note the IP and root password.
2. Connect: `ssh root@YOUR-VPS-IP`
3. Firewall (hPanel → VPS → Firewall, or on the server): allow only 22, 80, 443.
   `ufw allow OpenSSH && ufw allow 80 && ufw allow 443/tcp && ufw allow 443/udp && ufw enable`
4. Get the code: `git clone https://github.com/cxsmtp/GSA.git /opt/gsa && cd /opt/gsa`
5. Settings: `cp .env.example .env.production && nano .env.production` — set `DOMAIN`, `ACME_EMAIL`, `APP_URL`, optionally `ADMIN_INITIAL_PASSWORD`. Then `chmod 600 .env.production`.
6. Start: `docker compose up -d --build`
7. First sign-in: open `https://YOUR-DOMAIN/admin`. Password: the one you set, or `docker compose exec app cat /data/FIRST_LOGIN.txt`. You choose your own at first sign-in; then delete the file: `docker compose exec app rm /data/FIRST_LOGIN.txt`.
8. In Admin → Settings: academy profile, WhatsApp number, UPI ID, Instagram username, GST. Admin → Courts: courts, prices, hours. Admin → My account: turn on 2-step sign-in.

**Update:** `cd /opt/gsa && git pull && docker compose up -d --build`

**Backups:** Admin → Settings → Audit & backup → Download backup (whole database). On the server, a nightly copy of everything (database + photos + bills):
`(crontab -l; echo '30 2 * * * docker run --rm -v gsa_gsa-data:/data -v /root/backups:/b alpine tar czf /b/gsa-$(date +\%F).tgz -C /data . && find /root/backups -mtime +30 -delete') | crontab -`
Also turn on Hostinger's weekly VPS backups/snapshots in hPanel, and download a copy off the server now and then.

**Logs:** `docker compose logs -f app`

## Option B — Hostinger managed Node.js hosting (Business / Cloud plans)

1. hPanel → Websites → Add website → **Node.js Apps** → connect GitHub and pick this repository (or upload a zip).
2. Node version **22.x**. Build command `npm ci && npm run build`. Start command `npm start`. Entry: leave default.
3. Environment variables: `DATA_DIR` = a folder **outside** the app folder so redeploys keep it (e.g. `/home/USERNAME/gsa-data`), `APP_URL`, `ADMIN_INITIAL_PASSWORD`, and the optional Razorpay / WhatsApp keys below.
4. Deploy, then open `/admin`. HTTPS is provided by Hostinger.

Use a plan with enough memory for the build (Cloud recommended). If the hosting UI changes, the essentials stay: Node 22, `npm run build`, `npm start`, persistent `DATA_DIR`.

## Payments

**Direct UPI (free, default).** Admin → Settings → Payments: your UPI ID and display name. Use a **business/merchant UPI ID** (your bank's merchant UPI, PhonePe Business, Paytm for Business, Google Pay for Business): apps limit payment links to personal IDs. Players pay in their installed UPI app or by QR and enter the 12-digit UTR; you verify it in Money → Verify against your bank app.

**Razorpay (optional, automatic confirmation).**
1. Razorpay Dashboard → Settings → API Keys → generate. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` in `.env.production`.
2. Dashboard → Webhooks → Add: URL `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment.captured` and `order.paid`, a secret → `RAZORPAY_WEBHOOK_SECRET`.
3. `docker compose up -d` (restart). Settings → Payments shows “connected”. Players see “Pay instantly” (UPI intent to their installed apps, QR, cards); bookings confirm by themselves.

## WhatsApp

**Free (default):** set the academy WhatsApp number in Settings. Players tap “Confirm on WhatsApp” (message with booking ref + code arrives on your phone); after you verify a payment, one tap opens WhatsApp with the confirmation to the player.

**Automatic (optional, WhatsApp Cloud API):**
1. developers.facebook.com → create an app → WhatsApp → add your business phone number.
2. WhatsApp Manager → Message templates → create **`booking_confirmed`** (Utility, English) with body e.g.:
   `Hi {{1}}, your court booking {{2}} is confirmed for {{3}}, {{4}}. Amount paid: {{5}}. See you on court!`
3. Create a permanent System User token with `whatsapp_business_messaging`. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (and `WHATSAPP_TEMPLATE` if named differently). Restart.

## Security checklist

- `.env.production` is `chmod 600` and never committed. Secrets live only there, never in the database.
- Turn on 2-step sign-in for every admin (Admin → My account).
- Give the coach a **coach** account, never the admin password.
- Keep the VPS updated: `apt update && apt upgrade -y` monthly; `docker compose up -d --build` after `git pull`.
- Check Settings → Audit & backup now and then: it says if any record was altered.
