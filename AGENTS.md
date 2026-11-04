# humanix-aplicacion — reglas técnicas

Healthcare home-care platform (Colombia). Stack: TanStack Start + React 19, file-based routes in `src/routes`, Tailwind 4 tokens, shadcn/Radix, react-hook-form + Zod, TanStack Query, Lovable Cloud (Postgres/Auth/Realtime), Vitest, Bun.

## Commands
`bun install` · `bun run dev` · `bun run test` · `bun run lint` · `bun run format`

## Structure
- `src/routes/` pages (Spanish paths); `routeTree.gen.ts` is generated, never edit.
- `src/components/humanix/` domain components (PascalCase); `src/components/ui/` shadcn primitives.
- `src/hooks/use-*.tsx` hooks; `src/lib/` pure business logic with colocated `*.test.ts`.
- `supabase/functions/` existing Edge Functions (maintain only, never add new ones).

## Rules
- Profile uploads share `ProfileImporter`; extracted PDF support pages are bounded and saved as independent pending files through authenticated server code, never as approved/verified documents.
- Installability uses a web manifest and existing-brand icons only, with no offline worker or clinical-data caching; native store packages remain a separate Capacitor release process.
- Professional document requirements are shared in the browser-safe `supabase/functions/_shared/professionalDocumentRequirements.ts` module by the panel and existing validator, so completion and publication checks remain consistent.
- UI only with shadcn/Radix/Tailwind; icons from lucide-react; semantic color tokens, no arbitrary hex in new code — keeps theming consistent.
- Business logic as pure functions in `src/lib/` with Vitest tests — testable without the DB.
- Search cards, map and agent results share validated directory rows from `searchProfessionalDetails`; display only server-authorized names so incomplete data and privacy rules stay consistent.
- Async data via TanStack Query; live updates via Supabase Realtime, not polling.
- Direct pending bookings have a dedicated professional inbox; database INSERT triggers create recipient-only notifications so every booking entry point alerts consistently.
- Map pins follow `verification_status` from the map SQL functions: only verified pros (approved docs) are bookable; pending ones show amber with the Habeas Data notice (`src/lib/mapVerification.ts`). Pros share service location only in `in_route`/`in_progress`, enforced by `tracking_pings` RLS.
- Service flow (Pedido → Aceptado → En camino → Cuidando → Terminado) lives in `src/lib/serviceFlow.ts`; `LiveServiceAlerts` (mounted once in `__root`) uses `useRealtimeProfessionalFeed` for app-wide alerts, so new request/status notification types must be added to `ALERT_TYPES` there.
- Map visitors share a payload-free public broadcast subscription; signed-in viewers retain the private channel, and selection reads current authorized pins to prevent stale locations or actions.
- Forms use react-hook-form + Zod — single validation path.
- Roles live only in `public.user_roles`; check with `has_role()` / `is_staff()` — prevents privilege escalation.
- Every new public table: GRANTs + RLS in the same migration — Data API needs both.
- Sensitive profile fields (verification, trust, ratings) are written only by service-role code; a BEFORE UPDATE trigger preserves them for clients — users must not self-verify.
- Payments are Bre-B via Firux only (Mercado Pago was removed in Nov 2026). Charges are created server-side (`src/lib/firux.functions.ts` → `firuxCharges.server.ts`, amount always from the DB, `Idempotency-Key` = our `firux_charges.id`); money is applied only by the HMAC-verified webhook `/api/public/firux/webhook` → `hx_firux_charge_paid` (service_role only, idempotent). Plan state (`mp_subscriptions`, institution annual plans only) and wallets are written only there — client rows are untrusted. Secrets: `FIRUX_API_KEY`, `FIRUX_WEBHOOK_SECRET`. See `docs/PAGOS_BREB.md`.
- «Conectar con Firux Pay» is behind `FIRUX_CONNECT_ENABLED` (off by default): booking charges go to the professional's connected Firux account with Humanix's fee only when the connection is active with the current terms (`src/lib/firuxConnect.ts`); every other case falls back to Humanix's key + `payouts` queue. All unpublished Firux API guesses live in `firuxConnectApi.ts` and `firuxCreateCharge` — keep them there.
- Commission matrix (`src/lib/commissionMatrix.ts` mirrors `booking_commission_pct` SQL): families never pay commission; pros 15/12/10 % by completed shifts in 30 days; institution plan 12/10 %; first shift per pair exempt up to $30.000. Cash shifts debit the pro wallet on completion (credit limit −$30.000, enforced by `trg_sb_wallet_gate`). Bre-B booking money is held (escrow, `src/lib/escrow.ts`, migration 20261104180000): `payouts` rows are created only after the family confirms, 24 h auto-release, or staff resolution; cancellations with money inside create `booking_refunds`. Minimum shift $20.000.
- Payments happen only on the web checkout, never via WhatsApp — business/compliance rule.
- `/superadmin/*` uses only `useSuperadmin`, redirecting to `/admin` — keeps admin flow isolated.
- Admin access code is validated server-side only (`verify-admin-access`) — never in frontend.
- New server logic uses `createServerFn` in `src/lib/*.functions.ts` with `requireSupabaseAuth`; `src/start.ts` attaches the bearer token — project template forbids new Edge Functions.
- ReTHUS: `verifyRethus` runs once per professional automatically (consent + professional role + stored doc), enforced server-side + partial unique index; provider errors don't consume it; only staff re-verify via `adminReverifyRethus` (rate-limited, requested_by/reverified); docs only AES-GCM/HMAC — Ley 1581 + provider cost.
