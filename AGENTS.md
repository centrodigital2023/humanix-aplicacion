# humanix-care-connect — reglas técnicas

Healthcare home-care platform (Colombia). Stack: TanStack Start + React 19, file-based routes in `src/routes`, Tailwind 4 tokens, shadcn/Radix, react-hook-form + Zod, TanStack Query, Lovable Cloud (Postgres/Auth/Realtime), Vitest, Bun.

## Commands
`bun install` · `bun run dev` · `bun run test` · `bun run lint` · `bun run format`

## Structure
- `src/routes/` pages (Spanish paths); `routeTree.gen.ts` is generated, never edit.
- `src/components/humanix/` domain components (PascalCase); `src/components/ui/` shadcn primitives.
- `src/hooks/use-*.tsx` hooks; `src/lib/` pure business logic with colocated `*.test.ts`.
- `supabase/functions/` existing Edge Functions (maintain only, never add new ones).

## Rules
- UI only with shadcn/Radix/Tailwind; icons from lucide-react; semantic color tokens, no arbitrary hex in new code — keeps theming consistent.
- Business logic as pure functions in `src/lib/` with Vitest tests — testable without the DB.
- Async data via TanStack Query; live updates via Supabase Realtime, not polling.
- Forms use react-hook-form + Zod — single validation path.
- Roles live only in `public.user_roles`; check with `has_role()` / `is_staff()` — prevents privilege escalation.
- Every new public table: GRANTs + RLS in the same migration — Data API needs both.
- Sensitive profile fields (verification, trust, ratings) are written only by service-role code; a BEFORE UPDATE trigger preserves them for clients — users must not self-verify.
- Plan/payment state is read from `mp_subscriptions`, which only the payment webhook writes — client rows are untrusted.
- Payments happen only on the web checkout, never via WhatsApp — business/compliance rule.
- `/superadmin/*` uses only `useSuperadmin`, redirecting to `/admin` — keeps admin flow isolated.
- Admin access code is validated server-side only (`verify-admin-access`) — never in frontend.
- New server logic uses `createServerFn` in `src/lib/*.functions.ts` with `requireSupabaseAuth`; `src/start.ts` attaches the bearer token — project template forbids new Edge Functions.
- ReTHUS verification runs in `verifyRethus` (`src/lib/rethus.functions.ts`); documents stored only as HMAC hashes — Ley 1581 data minimization.
