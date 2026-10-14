# Humanix Aplicación — AI Codebase Overview

**Last verified:** 2026-10-14 against commit `9f7ef34` (`main`).
**Purpose:** a map for AI agents. It tells you where things are and which document to trust. It does not repeat rules that live elsewhere.

## 0. Which source to trust

When two sources disagree, use this order:

1. **The code** (and the database in production, for schema questions).
2. **`AGENTS.md`** — the technical rules. Read it before changing anything.
3. **`docs/`** — one document per feature area (see section 9).
4. **This file** — a summary that can drift. If it contradicts the code, the code wins; fix this file.

The top-level documents dated May 2026 (`README_SYNC.md`, `SYNC_STATUS.md`, `CHANGES_VISUALIZATION.md`, `REAL_TIME_INTEGRATION.md`, `IMPLEMENTATION_GUIDE.md`, `INTEGRATION_QUICK_START.md`) are history. The first four carry a banner explaining that they come from a different project (see section 1).

## 1. Identity of this project

| Item | Value |
|---|---|
| Repository | `centrodigital2023/humanix-aplicacion` (branch `main`) |
| Lovable project | "Humanix Aplicacion", id `003f94c5-0e59-4dc4-9df5-3b694e43b976` (workspace "Centro's Lovable") |
| Supabase project ref | `ncyzoswhszhttdoxhqdh` (see `supabase/config.toml` and `.env`) |
| Origin | Created on 2026-06-19 as a **remix** of another Lovable project |

**Do not confuse it with `humanix-care-connect`** (most likely the Lovable project "Humanix Connect"; confirm before relying on it). That is a separate project and repository. The remix copied some of its documents, so a few files still name it. Commit `3af4910`, cited in the May documents, does not exist in this repository's history. Never use `humanix-care-connect` as this repository's name, URL or Supabase project.

What the product does: a Colombian home-care and healthcare-staffing platform. Families look for care, institutions (IPS/EPS/clinics) cover shifts, and professionals find work. It includes AI matching, RETHUS verification, Mercado Pago subscriptions and live clinical monitoring.

## 2. Stack (versions from `package.json`)

- TanStack Start `1.168.x` + TanStack Router `1.170.x`, React `19.2`, Vite `7.3`, TypeScript `5.8` (strict, path alias `@/*` → `src/*`).
- Tailwind `4.2` with semantic tokens, shadcn/ui + Radix, `lucide-react`, `sonner` for toasts.
- `react-hook-form` + Zod `4`; TanStack Query `5`.
- Supabase (`@supabase/supabase-js` `2.103`): Postgres, Auth, Realtime. Lovable Cloud hosts it.
- Leaflet/react-leaflet for maps, Recharts for charts.
- Capacitor `8` for the Android/iOS shells (`capacitor.config.ts`, `MOBILE_BUILD.md`). The native build is done on the developer's own machine, not in Lovable.
- Runtime/target: Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat`).
- Package manager: **Bun**. Tests: Vitest `4` with jsdom.

## 3. Commands

```
bun install
bun run dev        # vite dev
bun run build
bun run test       # vitest run
bun run lint
bun run format
bun run scripts/migration-drift-probe.ts   # read-only check of repo vs production schema
```

## 4. Rules that cause the most damage when ignored

The full list is in `AGENTS.md`. These are the ones to have in mind before you write any code:

- **No new Edge Functions.** Existing ones in `supabase/functions/` are maintained only. New server logic is a `createServerFn` in `src/lib/*.functions.ts`, using `requireSupabaseAuth`; `src/start.ts` attaches the bearer token.
- **Every new public table gets its `GRANT`s and RLS in the same migration.**
- **Roles live only in `public.user_roles`**; check them with `has_role()` / `is_staff()`.
- **Never trust client-written plan or verification state.** Plan state comes from `mp_subscriptions` (written only by the payment webhook); verification, trust and ratings are written only by service-role code.
- **Payments happen only on the web checkout, never through WhatsApp.**
- **Admin access code is validated only on the server** (`verify-admin-access`).
- **RETHUS verification** (`verifyRethus`) runs once per professional, server-side. Only staff re-verify.
- `src/routeTree.gen.ts` is generated; never edit it.
- Business logic goes in `src/lib/` as pure functions with a colocated `*.test.ts`.

## 5. Layout

```
src/
├── routes/                 79 files, file-based, Spanish paths (/planes, /buscar, /dashboard/familia …)
├── components/
│   ├── humanix/            ~130 domain components + 15 feature subfolders
│   │   (care, contracts, family, hub, instcare, institution, marketplace,
│   │    monitoring, patients, premium, pro, service, simple, staff, validation)
│   └── ui/                 46 shadcn/Radix primitives
├── hooks/                  use-*.ts(x): auth/roles, plan, realtime, per-role "intel" hooks, SOS, presence …
├── lib/                    pure business logic + ~90 test files; *.functions.ts = server functions
├── integrations/supabase/  client.ts, client.server.ts, auth-middleware.ts, auth-attacher.ts, types.ts (generated)
├── services/               HealthKitService.ts (native wearable bridge)
├── start.ts                TanStack Start setup; attaches the auth token to server functions
└── router.tsx, styles.css
supabase/
├── functions/              40 existing Edge Functions + _shared (maintain only)
├── migrations/             130 files (see section 7)
├── e2e/                    disposable-Postgres replays
└── config.toml
drizzle/                    migrations + schema.ts, generated by Lovable's tooling (do not edit)
docs/                       one document per feature area
scripts/migration-drift-probe.ts
```

Server functions that exist today: `contracts`, `institutionMembers`, `marketValidation`, `pqrs`, `rethus` (all in `src/lib/*.functions.ts`, each with a `*.server.ts` counterpart where needed).

## 6. Roles and where each one lands

`AppRole` in `src/hooks/use-app-user.tsx` has **seven** values:

| Role | Home |
|---|---|
| `professional` | `/dashboard/profesional` |
| `family` | `/dashboard/familia` |
| `institution` | `/dashboard/institucion` |
| `institution_staff` | `/dashboard/equipo` |
| `superadmin` | `/superadmin` (uses only `useSuperadmin`; redirects to `/admin` otherwise) |
| `hr_staff` | `/talento-humano` |
| `evaluator` | `/evaluador` |

`/dashboard/eps` and `/dashboard/monitoreo` also exist. Use `useAppUser({ allow: [...] })` to guard a route by role.

## 7. Plans, data and migrations

- **Plans:** `src/lib/plans.ts` is the single source of truth (`free`, `essential_monthly`, `pro_monthly`, `institution_monthly`; tiers, prices, features). When you change it, also update `src/routes/planes.tsx`, `supabase/functions/mp-create-subscription` and the `plan_tier_rank` SQL function, as the file header says. Feature gating uses `PlanGate`/`PlanNameGate` and `FEATURE_MIN_PLAN`.
- **Two migration chains.** `supabase/migrations/` (130 files) reaches production **only when someone applies it by hand**; `drizzle/migrations/` (15 files) is generated and applied by Lovable. Neither can rebuild the database alone — **production is the reference.** Read `docs/MIGRACIONES.md` before writing a migration. Key points: idempotent SQL, dry run first, never edit `drizzle/` by hand, and never recreate the six delegated functions (`publish_institution_offer`, `accept_application`, `decline_application`, `counter_application`, `institution_application_inbox`, `invite_team_to_offer`) without keeping `hx_acting_institution(auth.uid(), …)`.
- **Realtime:** use `useRealtimeRefresh` / Supabase Realtime, not polling.

## 8. Tests

- Vitest + jsdom, `src/**/*.test.{ts,tsx}`, setup in `src/test/setup.ts`.
- Test pure functions in `src/lib/`; they need no database. Fixtures end in `.fixture.ts`.
- `src/lib/migrationProbe.test.ts` guards migration names/versions and the six delegated functions.
- `docs/PACIENTES_Y_MONITOREO.md` and `docs/MIGRACIONES.md` record what was and was not verified on 2026-10-14. Read that part before saying something works in production; most documents here separate "implemented in code" from "proven in production".

## 9. Feature areas → where to read

| Area | Read |
|---|---|
| Patients and live clinical monitoring (`PatientsHub`, `MonitoringHub`; they replaced `EnhancedPatientsModule` and `InstitutionClinicalMonitoring`) | `docs/PACIENTES_Y_MONITOREO.md` |
| Migrations, drift probe, what production has | `docs/MIGRACIONES.md` |
| Institution hub and smart contract | `docs/INSTITUCION_HUB_CONTRATO_INTELIGENTE.md` |
| Professional opportunities hub | `docs/PROFESIONAL_HUB_OPORTUNIDADES.md` |
| Care loop | `docs/LAZO_DE_CUIDADO.md` |
| Marketplace and PQRS panel | `docs/MARKETPLACE_PQRS_PANEL.md` |
| Market validation | `docs/VALIDACION_MERCADO.md` |
| Premium panels / family premium | `docs/PANELES_PREMIUM.md`, `docs/PANEL_FAMILIA_PREMIUM.md` |
| Connected flows | `docs/FLUJOS_CONECTADOS.md` |
| Platform overview with evidence levels | `docs/DOCUMENTACION_PLATAFORMA.md` |
| SEO | `docs/seo.md` |
| Security, audit, backend triggers | `SECURITY_REMEDIATION.md`, `AUDIT_REPORT.md`, `BACKEND_TRIGGER_MATRIX.md` |
| Plans and roadmap | `IMPLEMENTATION_PLAN.md`, `PREMIUM_FEATURE_ROADMAP.md` |
| RETHUS / Verifik plan | `.lovable/plan/` |
| Native app build | `MOBILE_BUILD.md` |

## 10. Working with GitHub and Lovable

- `main` on GitHub and the Lovable project point to the same commit (checked on 2026-10-14: both at `9f7ef34`). To re-check, compare `git rev-parse origin/main` with `latest_commit_sha` from the Lovable project.
- Both sides edit the same code, so commit carefully and re-run that comparison after a push or after someone edits in Lovable, to be sure they have not diverged.
- Migrations are **not** applied by merging; follow `docs/MIGRACIONES.md` §3.
- Native Android/iOS builds are made locally with Capacitor (`MOBILE_BUILD.md`).

## 11. Conventions

- UI text is Spanish (Colombian). Medical terms: "Enfermería", "Auxiliar de enfermería", "Cuidado paliativo".
- Components: PascalCase and descriptive (`PatientsHub.tsx`, not `Card.tsx`). Hooks: `use-*.ts(x)` in kebab-case.
- Styling: Tailwind semantic tokens (no arbitrary hex in new code), `cn()` from `@/lib/utils` to merge classes.
- Forms: react-hook-form + Zod, one validation path.
- Compliance: Ley 1581 de 2012 (Habeas Data) and the FUID retention periods govern personal data and documents; do not weaken consent, retention or encryption without reading the relevant document in `docs/`.
