# GSA Badminton — court booking & money portal

Mobile-first portal for a badminton academy in Jodhpur: players book courts (5 AM – 11 PM) and pay by UPI; the admin runs bookings, collections, a GST-compliant bill book, expenses and reports; the coach handles the timetable without seeing finances.

| | |
|---|---|
| **Book (home page)** | Live court × time grid, 14-day date strip with free-slot counts, morning/afternoon/evening/night sections, tap several slots, sticky total, details sheet. Slots are held for 10 minutes while the player pays. Double booking is impossible (database-enforced). |
| **Pay** | “Open UPI app” and one-tap Google Pay / PhonePe / Paytm / BHIM buttons (opens the installed app with amount filled), QR code to scan, copy UPI ID, then the 12-digit UPI reference. Optional Razorpay “Pay instantly” confirms automatically (signature + webhook). Countdown timer, invoice download, add-to-calendar, directions. |
| **WhatsApp confirmation** | From the buh project, free, no API: the player taps “Confirm on WhatsApp” (proves the number is theirs), and the admin sends the confirmation to the player's number in one tap after verifying. Optional WhatsApp Cloud API sends it automatically. |
| **Instagram** | A “Book now” link for the Instagram profile button, bio and Story link stickers; every booking records its channel (Instagram, WhatsApp, Google, QR poster…) and Money shows bookings by channel. Instagram's in-app browser gets “Open in Chrome” plus QR / UPI ID fallbacks. Instagram DM button and link previews. |
| **About us** | Story, highlights, coaches and key people with photos and achievements — the admin or coach adds them later in the admin app. |
| **Admin (`/admin`)** | Today dashboard, live timetable (tap to book walk-ins), bookings search, payment verification queue, funds overview (income, expenses, profit by month, method, category, channel), bill book, expenses with bill photos, other income, GST summary, CSV exports for the CA, courts, price rules (peak/weekend), opening hours, blocks for coaching batches/tournaments/maintenance, team, audit log, backup. |
| **Roles (RBAC)** | Admin, Head coach, Junior coach — each a set of permissions checked by the server on every action. Junior coaches help with reservations (view, book, WhatsApp, take cash) and can't change anything else. |
| **Cash custody** | Every cash payment records who took it and which head coach answers for it; he records deposits (bank slip or handover) and the admin confirms them. |
| **Head coach** | Takes phone bookings by the player's number and sends the WhatsApp confirmation with the payment position (paid / being verified / due + pay link); bookings, timetable, blocks, About page; can note cash collected (the admin verifies). Blocked on the server from payments, bills, expenses, reports and settings. |
| **GST (India)** | VAT was replaced by GST in 2017, so bills follow the CGST Rules: not registered → Receipt; regular → Tax Invoice with CGST + SGST (Rajasthan, code 08) or IGST; composition → Bill of Supply. Consecutive numbers per financial year (`GSA/26-27/0001`), SAC code, place of supply, amount in words, B2B GSTIN validation, ₹20 lakh registration watch. Confirm rate/SAC with your CA. |
| **Security** | Server-side prices, deny-by-default roles on every route, scrypt passwords with lockout, optional 2-step codes (authenticator app), hashed revocable sessions in `__Host-` SameSite=Strict cookies, CSRF origin checks, strict CSP and security headers, size-capped validated input, rate limits, unguessable booking links, file-type sniffing on uploads, tamper-evident audit log, secrets only in environment variables, non-root read-only container. |
| **Installable** | Add to Home screen on Android/iPhone: full-screen app icon, offline page. |

## Run locally

Node 22.13+ (uses Node's built-in SQLite: nothing native to compile).

```
npm ci && npm run dev
```

Open http://localhost:3000 and http://localhost:3000/admin. The first admin password is printed in the terminal and saved in `data/FIRST_LOGIN.txt`.

## Deploy on Hostinger

See [docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md) — KVM VPS with Docker + automatic HTTPS (recommended), or Hostinger's managed Node.js hosting.

## Develop

`npm test` (unit tests), `npm run lint`, `npm run typecheck`, `npm run build`. Owner guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).
