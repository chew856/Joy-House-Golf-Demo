# Joyhouse Golf — Branded Booking System

**Plan & Architecture Document**
Prepared for: Joyhouse Golf (joyhousegolf.com)
Date: 2026-06-22
Goal: Replace the current third-party "GolfBooking" software with a custom, fully brand-aligned booking system that lives at its own subdomain and embeds into the existing Squarespace site.

---

## 1. Summary

We will build a **standalone branded booking web app** (e.g. `book.joyhousegolf.com`) that lets customers reserve **simulator bay time slots** online and pay via **Stripe**. It will be visually indistinguishable from the Joyhouse brand and linked/embedded from the existing Squarespace marketing site.

Phase 1 ships the core: **bay availability → reserve a time slot → pay → get confirmation**, plus a simple **admin dashboard** for staff.

> **Scope is intentionally limited to sim bay bookings.** Memberships, tournaments/events, and gift cards are **explicitly out of scope** and will not be built.

### Scope decisions (confirmed)
| Decision | Choice |
|---|---|
| Core booking | **Sim bay time slots only** (memberships / tournaments / gift cards = out of scope) |
| Architecture | **Standalone app**, embedded/linked from Squarespace |
| Payments | **Stripe** |
| First deliverable | **This plan & architecture doc** |

---

## 2. Brand & Design System

Pulled directly from the live site so the booking app matches exactly.

### Colors (design tokens)
```css
:root {
  --jh-black:        #000000;  /* primary background */
  --jh-near-black:   #0E0E0E;  /* elevated surfaces */
  --jh-surface:      #272727;  /* cards / panels */
  --jh-border:       #3E3E3E;  /* dividers, outlines */
  --jh-white:        #FFFFFF;  /* primary text */
  --jh-off-white:    #F6F6F6;  /* secondary surfaces / light text */
  --jh-muted:        #E7E7E7;  /* muted text */

  /* Accent — see note below */
  --jh-green:        #C4E538;  /* logo lime/chartreuse (brand signature) */
  --jh-orange:       #F0523D;  /* current Squarespace site accent */
}
```

> **⚠️ Brand inconsistency to resolve with the owner.** The **logo's signature color is lime green** (`~#C4E538`), but the live Squarespace site's configured accent is **orange-red** (`#F0523D`). We should pick **one** accent for buttons/CTAs in the booking app. Recommendation: use the **lime green** to tie the product to the logo, OR match the site's orange for consistency with what customers see today. Quick decision needed.

### Typography
- **Headings:** `Space Grotesk` (500/700) — geometric, sporty.
- **Body / UI / nav:** `Raleway` (400/500/700) — clean humanist sans.
- Load both via Google Fonts (already used on the marketing site).

### Logo
- Wordmark on black: "JOY" (white slab) + golfer silhouette + lime swing-trail lines + "HOUSE GOLF" (green) + tagline *"Go farther with Joy."*
- Source asset is on the Squarespace CDN; we'll request the original vector (SVG/AI) from the owner for crisp rendering.

### Look & feel
Dark, high-contrast, athletic-premium. Black canvas, white type, one bright accent for actions. The booking flow should feel like a sleek "members club" reservation, not a generic calendar widget.

---

## 3. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One codebase for UI + API routes; great for embedding, SSR, and fast iteration. |
| Styling | **Tailwind CSS** + the design tokens above | Fast, consistent, easy to match brand exactly. |
| Database | **PostgreSQL** (via Supabase or Neon) | Relational data + transactional safety for preventing double-bookings. |
| ORM | **Prisma** | Type-safe schema + migrations. |
| Auth (customers) | **Email magic-link / OTP** (Supabase Auth or Auth.js) | Low friction; guests can also book without an account. |
| Auth (staff/admin) | Role-gated login | Separate admin area. |
| Payments | **Stripe Checkout Sessions** + webhooks | Recommended path for one-time payments (deposits/full). |
| Email/SMS | **Resend** (email) + optional **Twilio** (SMS reminders) | Booking confirmations & reminders. |
| Hosting | **Vercel** (app) + managed Postgres | Zero-config deploys, custom subdomain. |

> This stack is a recommendation optimized for speed-to-launch and maintainability. If the owner/you have an existing stack preference (e.g. Laravel, a particular host), we adapt — flag it and I'll revise.

---

## 4. Data Model (Phase 1 core)

```
Location        — the facility (supports multi-location later)
  └─ Bay        — a bookable simulator (name, location, status, features)

OperatingHours  — open/close per weekday per location
Blackout        — closures / holidays / private events (date range, optional bay)

PricingRule     — rate per time block; supports peak/off-peak, day-of-week,
                  min/max duration

Customer        — name, email, phone, optional account, Stripe customer id
Booking         — bay, start, end, customer, status, price, stripe ids
                  status: pending_payment | confirmed | cancelled | completed | no_show
Payment         — Stripe Checkout Session / PaymentIntent linkage, amount, refund state
```

### Preventing double-bookings (critical)
The single most important correctness requirement. We enforce it at the **database level**, not just the UI:
- A Postgres **exclusion constraint** on `(bay_id, time_range)` using `tstzrange` + `btree_gist` so two overlapping confirmed bookings for the same bay are physically impossible.
- Booking creation runs in a **transaction**; a held slot is reserved as `pending_payment` with a short TTL (e.g. 10 min) so two people can't pay for the same slot. Unpaid holds auto-expire and free the slot.

---

## 5. Core Booking Flow

```
1. Customer lands on book.joyhousegolf.com (or embedded widget)
2. Picks date  →  app computes availability:
      operating hours  −  existing bookings  −  blackouts  −  hold-TTLs
3. Sees available bays & time slots, picks one + duration + party size
4. Enters contact info (guest) or logs in
5. Price computed from PricingRule (peak/off-peak)
6. → Stripe Checkout Session (deposit or full payment)
      • slot held as pending_payment with TTL
7. Stripe webhook (checkout.session.completed) → booking = confirmed
8. Confirmation email/SMS sent; calendar (.ics) attached
9. Reminder sent N hours before; staff sees it on admin dashboard
```

### Cancellation / refund policy (configurable)
- Define a window (e.g. free cancel ≥ 24h before; partial/no refund after).
- Refunds issued via Stripe API; slot is released back to availability.

---

## 6. Stripe Integration Design

Following current Stripe best practices:

- **Use Checkout Sessions** (`checkout.sessions.create`) for the booking payment — the recommended API for one-time, on-session payments. Embedded mode keeps customers on-brand; hosted mode is the fastest to ship.
- **Do NOT hardcode `payment_method_types`.** Omit it entirely to enable **dynamic payment methods** (cards, Apple Pay, Google Pay, etc. auto-selected for max conversion); manage which methods are enabled from the Stripe Dashboard.
- **Webhooks are the source of truth.** Mark a booking `confirmed` only on `checkout.session.completed`, not on client-side redirect. Verify webhook signatures.
- **Deposit vs full payment:** support either via Checkout line items / amount config — owner decides per their pricing.
- **Refunds & cancellations** via the Stripe Refunds API, wired to the cancellation policy.
- **Security:** use a **restricted API key** (`rk_`), not the full secret key; store keys in env vars / secrets, never in the repo.

I have Stripe tooling available and can scaffold the integration (test mode) when we build.

---

## 7. Admin Dashboard (staff)

Phase 1 essentials:
- **Calendar / day view** of all bays and bookings.
- Create / edit / cancel bookings manually (phone-in reservations).
- Manage bays, operating hours, blackout dates, and pricing rules.
- View customers & booking history; issue refunds.
- Basic reporting (bookings, revenue, utilization).

---

## 8. Squarespace Integration

- Booking app deployed to **`book.joyhousegolf.com`** (subdomain pointed at Vercel).
- From Squarespace: "Book Now" buttons link to the app; optionally embed the availability picker via an **iframe** in a Code Block on relevant pages.
- Marketing site stays on Squarespace — we only replace the *booking* function, not the website.

---

## 9. Migration from GolfBooking

- **Export existing data** from GolfBooking: customers, upcoming reservations, and (if available) gift card / membership balances.
- Map and **import** into the new schema (one-time script).
- **Parallel run:** keep GolfBooking live until the new system is verified, then cut over and redirect booking links.
- Confirm what data GolfBooking can export (CSV/API?) — this determines migration effort.

---

## 10. Phased Roadmap

| Phase | Deliverable |
|---|---|
| **0 — Foundations** | Repo, Next.js + Tailwind + brand tokens, DB schema, deploy pipeline, Stripe test account. |
| **1 — Core booking (MVP)** | Availability engine, bay time-slot booking, Stripe payment, confirmation emails, double-booking protection. |
| **2 — Admin dashboard** | Staff calendar, manual bookings, pricing/hours/blackouts, refunds, reporting. |
| **3 — Accounts & comms** | Customer accounts, booking history, reminders (email/SMS), cancellation self-service. |
| **4 — Migration & cutover** | Import GolfBooking data, parallel run, go-live checklist, switch over. |

---

## 11. Open Questions for the Owner

1. **Accent color:** logo lime green (`#C4E538`) or current site orange (`#F0523D`) for buttons/CTAs?
2. **Bays:** How many simulator bays? Any differences between them (e.g. premium bay, left-handed, room size)?
3. **Hours & pricing:** Operating hours per day? Peak/off-peak pricing? Min/max booking duration and increments (30/60 min)?
4. **Payment timing:** Full payment at booking, or a deposit with balance due on arrival?
5. **Cancellation policy:** Free-cancel window? Refund rules?
6. **GolfBooking export:** What can the current system export (CSV/API)? Any data we must preserve (gift card balances, membership terms)?
7. **Comms:** Email only, or email + SMS reminders?
8. **Domain/DNS:** Who manages DNS for joyhousegolf.com (to set up `book.` subdomain)?
9. **Stack:** Any existing tech/hosting preferences, or is the recommended stack good to proceed?

---

## 12. Suggested Next Step

Once you confirm the accent color + answer the bay/hours/pricing basics (Q1–4), I'll:
1. Scaffold the Phase 0 foundation (Next.js + brand tokens + DB schema), and
2. Build a runnable **Phase 1 MVP** of the core booking flow in Stripe **test mode** that we can demo to the owner.
```
```
