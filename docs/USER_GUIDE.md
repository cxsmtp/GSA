# Owner's guide

## Daily
- **Today**: who is on court, occupancy, money collected today, and a purple card when payments wait for you.
- **Verify payments** (Money → Verify): open your bank/UPI business app, find the 12-digit reference and amount, tap **Verify**. The booking confirms, the invoice is made, then tap **Send … the confirmation** to WhatsApp the player (automatic if the WhatsApp API is set up). Not received? **Not received** releases the court.
- **Phone & walk-in bookings (admin or coach)**: Today → Timetable, tap the free slots → **Book** → player's name and WhatsApp number → payment: **Cash** / **UPI** (already received) or **Due** (pays later). Then tap **Send confirmation on WhatsApp**: your WhatsApp opens with the message to the player already typed — booking ref, date, court & time, total, and the payment position (*received ✓*, *received, being verified*, or *due ₹… with a link to pay online*). Just tap Send.
- The player's link shows the same booking and status, and they can pay a due amount there by UPI app, QR or Razorpay. Money a coach notes is shown as "being verified" until the admin verifies it.
- From any booking (Bookings → tap it) the admin or coach can send or re-send the WhatsApp confirmation, and mark **Cash received** / **UPI at desk** when the player pays later. Lists show Paid / Due and ✓ WhatsApp once sent.

## Courts & timetable (Courts)
- **Blocks & batches**: block a court (or all) for coaching batches, tournaments, maintenance — one day or repeating weekdays for months. Blocked slots show as “Coaching”/“Event” to players.
- **Courts & prices** (admin): add/rename/close courts, base price per slot, price rules (evening peak, weekends, a premium court). Highest priority wins.
- **Hours & rules** (admin): opening hours per weekday (default 5 AM–11 PM), slot length, days ahead, hold time, max slots.

## Money (admin only)
- **Funds**: collected, expenses, profit by month; by payment method, income type, expense category and booking channel (Instagram etc.); GST registration watch.
- **Bill book**: every invoice, numbered per financial year. **New** for coaching fees, memberships, tournaments, equipment. A wrong invoice is cancelled (never deleted, number not reused) and a new one issued.
- **Expenses**: add with a photo of the bill; record GST on the bill for input credit.
- **Income**: other money in (coaching fees, sponsorship) without an invoice.
- **GST & exports**: monthly taxable value, CGST/SGST/IGST and input GST; CSVs of invoices, payments, expenses, bookings for your CA.

## GST
Settings → GST & bills. Not registered: receipts without tax. Regular: Tax Invoices (18%, SAC 999652 by default; prices include GST unless you untick it). Composition: Bills of Supply. Ask your CA to confirm the rate and SAC. If you cancel a booking after filing that month's GSTR-1, ask your CA about a credit note.

## Instagram
Settings → Instagram & links: copy the **bio / Book now** link into Instagram → Edit profile → Action buttons (or Links), and the Story link for link stickers. Download the QR poster for the counter. Bookings from each link are counted.

## Team, roles & cash
Settings → Team: add staff with a role. Each gets a one-time password and chooses their own. The table there shows exactly what each role can do; the server enforces it on every action.

| Role | Can |
|---|---|
| **Admin** | Everything: money, bill book, expenses, reports, courts & prices, settings, team. |
| **Head coach** | Runs the day: bookings, phone bookings, WhatsApp confirmations, takes cash, edits notes, cancels unpaid bookings, blocks courts, edits the About page. Cash is on his name. |
| **Junior coach** | Helps with reservations: sees the timetable and bookings, makes phone/walk-in bookings, sends WhatsApp confirmations, takes cash. Cannot change or cancel anything else. Pick the head coach he **reports to**. |

**Cash custody.** Every cash payment records who took it. Cash taken by a head coach, or by a junior who reports to him, is **on the head coach's name**: the booking shows as paid at once, and the money is his responsibility until it reaches the academy.
- Junior coach → **Cash** shows what he took and whose name it is on; he hands it to his head coach.
- Head coach → **Cash** shows cash on his name; **Record a deposit** (bank deposit with slip number/photo, or handed to the admin).
- Admin → Money → **Cash**: each person's balance, and deposits to confirm (**Received** / **Not received**). Only a confirmed deposit takes cash off the coach's name. A head coach with cash still on his name can't be deactivated or demoted until it is settled.
- UPI taken at the desk by a coach still goes to Money → Verify, because it lands straight in the bank. Settings → Audit & backup: every change, who did it, a tamper check, and a backup download.
