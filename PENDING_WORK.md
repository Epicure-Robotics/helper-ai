# Epicure Mail Helper — Pending Work

_Last updated: 2026-07-03_

Status of outstanding work to get **Epicure Assist** (team inbox + AI chat for Epicure Robotics) fully production-ready. Compiled from a debugging/verification session on 2026-07-03.

**Owner legend:** 👤 = requires your action (secrets / dashboard / infra) · 🛠️ = code change I can make once unblocked · ✅ = done this session

---

## ⚠️ Attention needed first — unfinished git rebase

There is a **paused interactive rebase on `main`** (`git status` shows _"editing a commit while rebasing"_, 16 done / 9 remaining). This session's code fixes are currently entangled in that rebase state.

- **Do not abort** the rebase without checking — `git rebase --abort` would reset to the pre-rebase state and could discard the fixes below.
- Decide to either `git rebase --continue` (finish it) or deliberately `--abort`, and confirm the fixes below survive afterward.
- Until this is resolved, treat the repo history as in-flux.

---

## 🔴 P0 — Critical functional blockers

### 1. AI chat is down — invalid OpenAI API key  👤 → 🛠️
- `POST /api/chat` streams back `"Error generating AI response"`. OpenAI rejects the current `OPENAI_API_KEY` in `.env.local` with `401 invalid_api_key`.
- **Impact:** all AI features dead — widget chat replies, drafts, instant greetings beyond the canned ones.
- **Action:** provide a valid `OPENAI_API_KEY` (`sk-...`/`sk-proj-...`). Then wire it in and verify the full flow: create conversation → send message → AI stream → sources → escalation.

### 2. Login OTP email broken in production — invalid Gmail SMTP  👤
- `user.startSignIn` fails with `535-5.7.8 BadCredentials` — Google rejects the SMTP login for `tn717473@gmail.com`.
- **Impact:** no OTP emails send in production → nobody can log in on the deployed app.
- **Local dev is worked around** (OTP returned directly, login auto-completes) — see ✅ below.
- **Action:** generate a Gmail **App Password** (myaccount.google.com → Security → App Passwords) and set `SMTP_PASSWORD`, or switch to a real transactional email provider (SendGrid/SES/Postmark).

---

## 🟠 P1 — Production performance (config prerequisites)

### 3. Enable Supabase JWT Signing Keys  👤
- Middleware now uses `auth.getClaims()`, but the project uses **legacy HS256** JWTs, so it still falls back to a network `getUser()` per request.
- **Action:** Supabase dashboard → Auth → migrate to **asymmetric JWT Signing Keys** (zero-downtime). Then token verification is fully local (no per-request round-trip). No further code change needed.

### 4. Move database to Mumbai for Indian users  👤 → 🛠️
- Users are in India; the Supabase DB is in **Seoul (`ap-northeast-2`)**. Vercel is now pinned to **`icn1` (Seoul)** to co-locate app+DB (the dominant win for this query-heavy app).
- **True optimum:** migrate the Supabase project to **Mumbai (`ap-south-1`)** — Supabase can't relocate in place, so create a new project there, migrate schema + data, repoint DB env vars. Then flip `vercel.json` → `"regions": ["bom1"]` (one line).

---

## 🟡 P2 — Verification & follow-ups

### 5. Verify auth after deploy  👤
- The `getUser()` → `getClaims()` middleware change touches authentication. Couldn't exercise the authenticated session-refresh path locally.
- **Action:** after deploying, log in and navigate around; confirm sessions persist and don't get randomly logged out.

### 6. End-to-end chat verification  🛠️ (blocked on #1)
- Once a valid OpenAI key is in, verify: conversation creation, message send, AI streaming reply, source citations, human-support escalation, subject generation.

### 7. Confirm admin roster  👤
- Current admins: `software@epicurerobotics.com`, `nareshkumarthodupunoori@gmail.com` (+1 member). Signup is invite-only; admins add users via **Settings → Team**.
- **Decide:** should `lokesh.kumar@pazcare.com` be an admin? If so, an existing admin adds it via Settings → Team. Demote any accounts that shouldn't be admin.

### 8. Verify inbound Gmail sync  👤
- Confirm `connect@epicure.com` (the support inbox) is correctly connected and customer emails are flowing in (Settings → Integrations / Gmail; `app/api/webhooks/gmail`).

### 9. Clean up leftover TODO  🛠️
- `app/api/widget/session/route.ts:69` — `TODO: update result type and remove unnecessary fields` on the session response. Minor.

---

## ✅ Done this session (for reference)

- **Signup model → invite-only, admin-provisioned.** `EMAIL_SIGNUP_DOMAINS` cleared; `isSignupPossible` supports a `*` wildcard if ever needed.
- **`organization.addMember` gated to admins** on the backend (was any logged-in user).
- **Local-dev login without email** — `startSignIn` returns the OTP in dev (`NODE_ENV!=="production" && !VERCEL`) and a failed SMTP send falls through instead of erroring. Production behavior unchanged.
- **Hydration mismatch fixed** in `LoginForm` + `OnboardingForm` (theme-based logo → mounted guard).
- **Dialog accessibility warning fixed** — added visually-hidden `SheetTitle` to the conversation sidebar `Sheet`.
- **Dev speed** — removed a hardcoded 200ms `setTimeout` on every request in `lib/supabase/middleware.ts`.
- **Prod region** — `vercel.json` pinned to `icn1` (Seoul) to co-locate with the DB.
- **Prod auth** — middleware switched to `getClaims()` (recommended pattern; activates local verification once #3 is done).

---

## Notes / gotchas
- The mailbox table is `mailboxes_mailbox` (not `public.mailboxes`).
- `"Failed to fetch"` on the homepage is transient Turbopack route compilation on first hit, not a bug.
- A gated artificial latency exists in `trpc/trpc.ts` behind `SIMULATE_NETWORK_LATENCY` (off).
- For a fast local experience without prod: `pnpm build && pnpm start` (skips Turbopack dev compilation).
