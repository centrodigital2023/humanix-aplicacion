# 🤖 Humanix Care Connect - AI Codebase Overview

**Last Updated:** May 26, 2026  
**Purpose:** Comprehensive reference for AI agents exploring this codebase

---

## 1. 🏗️ Architecture & Technology Stack

### Core Framework & Runtime
- **Framework:** TanStack Start + React 19.2.0
- **Bundler:** Vite 7.3.1
- **Runtime:** Cloudflare Workers (Wrangler)
- **Package Manager:** Bun
- **Language:** TypeScript 5.8.3
- **Target:** ES2022

### Key Dependencies by Category

#### Frontend Framework
- `react@19.2.0`, `react-dom@19.2.0` - React UI framework
- `@tanstack/react-router@1.168.0` - File-based routing
- `@tanstack/react-start@1.167.14` - Full-stack framework
- `@tanstack/react-query@5.83.0` - Server state management (TanStack Query)

#### UI & Styling
- **Component Library:** Radix UI (35+ components) + shadcn/ui
- **Styling:** Tailwind CSS 4.2.1 with CSS variables
- **Icons:** lucide-react 1.8.0
- **Forms:** react-hook-form 7.71.2 + Zod 4.3.6 (validation)
- **Utilities:** clsx, tailwind-merge, class-variance-authority

#### Backend/Data
- `@supabase/supabase-js@2.103.3` - PostgreSQL + Auth + Realtime
- Authentication via Supabase with auto-refresh tokens
- Realtime subscriptions for live data sync

#### Maps & Geolocation
- `leaflet@1.9.4` + `react-leaflet@5.0.0`
- Custom geo utilities in `src/lib/geo.ts`

#### Data Visualization
- `recharts@2.15.4` - Charts and graphs

#### Utilities & Integrations
- `date-fns@4.1.0` - Date manipulation
- `html-to-image@1.11.13`, `html2canvas@1.4.1` - Screenshot generation
- `jszip@3.10.1` - ZIP file creation
- `react-markdown@10.1.0` - Markdown rendering
- `sonner@2.0.7` - Toast notifications
- `vaul@1.1.2` - Drawer component
- `embla-carousel-react@8.6.0` - Carousels

### Build Pipeline

**vite.config.ts** provides:
- Manual code-splitting for optimal performance:
  - `vendor-react`, `vendor-router`, `vendor-query`, `vendor-supabase`
  - `vendor-ui`, `vendor-charts`, `vendor-maps`, `vendor-forms`
- Cloudflare Workers build support
- TanStack Router plugin integration

### TypeScript Configuration
- **Module Resolution:** Bundler mode
- **Path Aliases:** `@/*` → `./src/*`
- **Strict Mode:** Enabled
- **Target Files:** `src/**/*.ts`, `src/**/*.tsx`

---

## 2. 🔨 Build & Development Setup

### NPM Scripts

```json
{
  "dev": "vite dev",                    // Local dev server
  "build": "vite build",                // Production build
  "build:dev": "vite build --mode development",  // Dev build
  "preview": "vite preview",            // Preview production build
  "lint": "eslint .",                   // Run ESLint
  "format": "prettier --write .",       // Format code
  "test": "vitest run",                 // Run tests once
  "test:watch": "vitest"                // Watch mode
}
```

### Development Workflow
1. **Local:** `npm run dev` → Vite dev server (hot reload)
2. **Testing:** `npm run test:watch` → Vitest + jsdom environment
3. **Build:** `npm run build` → Optimized production bundle
4. **Deploy:** Automatic via `wrangler.jsonc` config

### Configuration Files

#### wrangler.jsonc
```json
{
  "name": "tanstack-start-app",
  "compatibility_date": "2025-09-24",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry"
}
```
- Cloudflare Workers deployment
- Node.js compatibility flag enabled
- Uses TanStack React Start as server entry point

#### vitest.config.ts
```typescript
{
  environment: "jsdom",                 // Browser-like environment
  globals: true,                        // Global test functions
  setupFiles: ["./src/test/setup.ts"],  // Test setup
  include: ["src/**/*.test.{ts,tsx}"],  // Test file pattern
  css: false                            // CSS not processed in tests
}
```

---

## 3. 📁 Project Structure & Patterns

### Directory Organization

```
src/
├── routes/                    # File-based routing (TanStack Router)
│   ├── __root.tsx            # Root layout & HTML structure
│   ├── auth.tsx              # Authentication pages
│   ├── dashboard.*.tsx       # Dashboard by role
│   ├── planes.tsx            # Pricing/subscription
│   ├── buscar.tsx            # Search functionality
│   └── ...                   # 60+ route files
├── components/
│   ├── humanix/              # Domain-specific components
│   │   ├── AppShell.tsx
│   │   ├── HumanixAssistant.tsx
│   │   ├── EnhancedPatientsModule.tsx
│   │   └── ...               # 60+ custom components
│   └── ui/                   # Radix UI + shadcn/ui primitives
│       ├── button.tsx
│       ├── dialog.tsx
│       ├── form.tsx
│       └── ...               # 45+ UI components
├── hooks/                    # Custom React hooks
│   ├── use-app-user.tsx      # User auth & role management
│   ├── use-plan.tsx          # Subscription plan state
│   ├── use-realtime-refresh.tsx  # Supabase realtime sync
│   ├── use-mobile.tsx        # Mobile detection
│   └── use-theme.tsx         # Theme management
├── integrations/
│   └── supabase/
│       ├── client.ts         # Supabase client initialization
│       ├── client.server.ts  # Server-side Supabase
│       ├── auth-middleware.ts
│       ├── auth-attacher.ts
│       └── types.ts          # Generated TypeScript types
├── lib/                      # Utilities & business logic
│   ├── utils.ts              # Helper functions (cn())
│   ├── geo.ts                # Geolocation utilities
│   ├── planCta.ts            # Plan card CTA logic (testable)
│   ├── plans.ts              # Pricing data & plan definitions
│   ├── humanixAi.ts          # AI integration
│   ├── nasa.ts               # External API integrations
│   ├── seo.ts                # SEO metadata
│   ├── social.ts             # Social media utils
│   └── *.test.ts             # Unit tests
├── content/
│   └── recursos.tsx          # Static content
├── test/
│   └── setup.ts              # Global test setup
├── router.tsx                # Router configuration
├── routeTree.gen.ts          # Auto-generated route tree
└── styles.css                # Global Tailwind styles
```

### Routing Patterns

**File-based routing** with TanStack Router:

```typescript
// Single route
export const Route = createFileRoute("/planes")({
  component: PlanesPage,
  head: () => ({ meta: [{ title: "Planes · Humanix" }] }),
});

// Dynamic route
export const Route = createFileRoute("/profesional/$proId")({
  validateSearch: (search) => ({ tab: search.tab || "profile" }),
  component: ProfessionalProfile,
});

// Nested dashboard
export const Route = createFileRoute("/dashboard/familia")({
  component: FamilyDashboard,
});
```

**Route Naming Convention:**
- `index.tsx` → `/`
- `auth.tsx` → `/auth`
- `dashboard.tsx` → `/dashboard`
- `dashboard.familia.tsx` → `/dashboard/familia`
- `dashboard.$role.tsx` → `/dashboard/{:role}`
- `$param.tsx` → `/{:param}` (dynamic)
- `[.]xml.ts` → `/sitemap.xml` (literal dot)

### Component Organization

#### Domain Components (`src/components/humanix/`)
Large, feature-rich components tied to business logic:

- **User Profile & Auth**
  - `SmartProfileCard.tsx` - Profile display with validation
  - `AvatarUploader.tsx` - Image upload handling
  - `DangerZoneCard.tsx` - Account deletion
  - `HabeasDataConsent.tsx` - Legal consent form

- **Dashboards & Navigation**
  - `AppShell.tsx` - Layout wrapper for authenticated pages
  - `Navbar.tsx` - Top navigation bar
  - `LaunchBar.tsx` - Floating action bar

- **AI & Smart Features**
  - `HumanixAssistant.tsx` - AI chat interface
  - `AiFingerprintCard.tsx` - AI profile analysis
  - `HiringCopilot.tsx` - AI-powered hiring assistant
  - `QuickCareWizard.tsx` - AI-guided workflows

- **Institutional Modules**
  - `EnhancedBulkOffersModule.tsx` - Batch job posting
  - `EnhancedPatientsModule.tsx` - Patient management
  - `EnhancedReportsWithCRMModule.tsx` - CRM analytics
  - `InstitutionModules.tsx` - Dashboard layout

- **Marketplace & Matching**
  - `MatchingOffers.tsx` - AI matching suggestions
  - `SemanticOffers.tsx` - Semantic search results
  - `OffersMap.tsx` - Map-based job browser
  - `PaidContactCard.tsx` - Contact request handling

- **Calendar & Scheduling**
  - `AvailabilityCalendar.tsx` - Availability editor
  - `FamilyNeedsCalendar.tsx` - Care schedule
  - `AgendaViewer.tsx` - Event display

- **Messaging & Notifications**
  - `ChatRoom.tsx` - Messaging interface
  - `BookingChat.tsx` - Service booking via chat
  - `NotificationsBell.tsx` - Notification center
  - `ProposalsInbox.tsx` - Proposal management

- **Content & Media**
  - `Article.tsx` - Blog/article display
  - `Testimonials.tsx` - Social proof component
  - `LiveSocialProof.tsx` - Real-time testimonials
  - `TestimonialComposer.tsx` - Testimonial creation

- **Utilities**
  - `LocationPicker.tsx` - Geolocation selector
  - `SearchBar.tsx` - Global search interface
  - `ShareButtons.tsx` - Social sharing
  - `Footer.tsx` - Site footer

#### UI Components (`src/components/ui/`)
Primitive, reusable Radix UI components styled with Tailwind:

```typescript
// Example: Button component
import * as React from "react"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "destructive" | "outline"
    size?: "default" | "sm" | "lg"
  }
>(({ variant = "default", ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant }))} {...props} />
))
```

### Hook Patterns

#### Authentication Hook
```typescript
// use-app-user.tsx - Central user management
export type AppRole = "professional" | "family" | "institution" | "superadmin" | "hr_staff" | "evaluator"
export type AppUser = { id, email, fullName, avatarUrl, roles: AppRole[], primaryRole: AppRole }

export function useAppUser(options: { requireAuth?: boolean; allow?: AppRole[] } = {}) {
  // Returns: { loading, user, error }
  // Auto-redirects unauthenticated users to /auth
  // Validates role permissions
}

// Usage
const { user, loading } = useAppUser({ allow: ["professional", "institution"] })
```

#### Real-time Sync Hook
```typescript
// use-realtime-refresh.tsx - Supabase subscriptions
export function useRealtimeRefresh(
  channelName: string,
  tables: RealtimeTable[],
  onRefresh: () => void,
  enabled = true
) {
  // Subscribes to table changes, calls onRefresh on update
  // Prevents re-subscription if dependencies change
}

// Usage
useRealtimeRefresh(
  "my_channel",
  [{ table: "professionals", event: "UPDATE" }],
  () => loadProfessionals(),
  enabled
)
```

#### Plan/Subscription Hook
```typescript
// use-plan.tsx
export function usePlan() {
  // Returns current plan: "free" | "essential_monthly" | "pro_monthly" | "institution_monthly"
  // Fetches from Supabase subscriptions table
}
```

#### Mobile Detection
```typescript
// use-mobile.tsx
export function useIsMobile(breakpoint = 768) {
  // Returns boolean based on window.innerWidth
  // Updates on resize
}
```

#### Theme Management
```typescript
// use-theme.tsx
export function useTheme() {
  // Returns: { theme, setTheme }
  // Manages dark/light mode with localStorage persistence
}
```

### Supabase Integration

#### Client Initialization (`src/integrations/supabase/client.ts`)

```typescript
import { createClient } from "@supabase/supabase-js"
import type { Database } from "./types"

function createSupabaseClient() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

// Lazy initialization via Proxy
export const supabase = new Proxy({}, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient()
    return Reflect.get(_supabase, prop, receiver)
  },
})
```

**Key Features:**
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Auto-token refresh enabled
- Session persistence in localStorage
- Lazy initialization prevents errors in SSR

#### Database Types (`src/integrations/supabase/types.ts`)

Auto-generated from Supabase schema. Key tables:
- `ad_banners` - Advertisement campaigns
- `professionals` - Service providers
- `families` - Care seekers
- `institutions` - Healthcare organizations
- `bookings` - Service bookings
- `user_roles` - Role-based access control
- `subscriptions` - Plan management
- `messages` - Real-time chat

#### Authentication Middleware

- `auth-middleware.ts` - Protects server functions
- `auth-attacher.ts` - Attaches auth context to requests
- `client.server.ts` - Server-side Supabase client

---

## 4. 📖 Key Files & Patterns

### Entry Point & Root Layout

#### Router Configuration (`src/router.tsx`)

```typescript
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

function DefaultErrorComponent({ error, reset }) {
  // Global error boundary UI
}

export const router = createRouter({
  routeTree,
  defaultErrorComponent: DefaultErrorComponent,
})
```

#### Root Route (`src/routes/__root.tsx`)

```typescript
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Rich SEO: Open Graph, Twitter, JSON-LD structured data
    ],
    links: [
      // Preconnect to Supabase, Google Fonts, CDNs
      { rel: "preconnect", href: "https://rwllmouomrytejtbpxvn.supabase.co" },
      // Preload fonts for CWV optimization
    ],
  }),
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Outlet />  // Router outlet
      <Toaster /> // Toast notifications (Sonner)
      <FloatingWAChat /> // Lazy-loaded WhatsApp chat
    </>
  )
}
```

### Authentication Flow

#### Auth Route (`src/routes/auth.tsx`)

**Features:**
- Sign-in and sign-up forms
- Role selection: professional / family / institution
- Email verification
- Password reset
- Search query validation: `?role=professional&redirect=/dashboard/profesional&mode=signup`

**Pattern:**
```typescript
export const Route = createFileRoute("/auth")({
  validateSearch: (search) => ({
    role: isValidRole(search.role),
    redirect: isValidRedirect(search.redirect),
    mode: ["signin", "signup"].includes(search.mode) ? search.mode : "signin",
  }),
  component: AuthPage,
})
```

#### Plan CTA Logic (`src/lib/planCta.ts`)

**Purpose:** Testable, pure function for determining call-to-action on pricing cards

```typescript
type CtaContext = {
  userId: string | null         // Auth state
  currentPlan: PlanKey          // Current subscription
  cancelAtPeriodEnd: boolean    // Pending cancellation
}

type CtaAction =
  | { kind: "current" }                      // Already on plan
  | { kind: "checkout" }                     // Upgrade/downgrade
  | { kind: "reactivate" }                   // Re-enable cancelled
  | { kind: "login"; redirectTo: string }   // Auth required
  | { kind: "free" }                         // Free tier
  | { kind: "sales" }                        // Contact sales

export function computeCta(target: PlanKey, ctx: CtaContext): CtaPlan
```

**Tested scenarios:**
- Logged out user on free card → "Crear cuenta gratis"
- Logged out user on paid card → "Empezar con {plan}", redirect to auth
- User on free upgrading to essential → "Mejorar a Esencial", checkout
- User with pending cancellation → "Reactivar renovación"

**Tests:** `src/lib/planCta.test.ts` (comprehensive unit tests)

### Common Patterns

#### Form Handling with react-hook-form + Zod

```typescript
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

type FormData = z.infer<typeof schema>

export function LoginForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("email")} />
      {errors.email && <span>{errors.email.message}</span>}
    </form>
  )
}
```

#### Styling with Tailwind + CVA (Class Variance Authority)

```typescript
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
)
```

#### Utility Function (`src/lib/utils.ts`)

```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
**Used throughout:** Merges Tailwind class conflicts (Radix UI + custom utilities)

#### Geolocation Utilities (`src/lib/geo.ts`)

```typescript
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number
export function formatKm(km: number): string // "1.5 km", "2.3 km"
```

Used in:
- Distance filtering on offer search
- Map-based job browser
- Location recommendations

#### Error Boundaries

```typescript
// src/router.tsx - Global error handler
function DefaultErrorComponent({ error, reset }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="max-w-md text-center">
        <h1>Something went wrong</h1>
        {import.meta.env.DEV && <pre>{error.message}</pre>}
        <button onClick={() => reset()}>Try again</button>
      </div>
    </div>
  )
}
```

#### Notifications Pattern

```typescript
import { toast } from "sonner"

// Success
toast.success("Perfil actualizado")

// Error
toast.error("Error al guardar", { description: error.message })

// Loading
const id = toast.loading("Guardando...")
// Later...
toast.dismiss(id)
toast.success("¡Listo!")
```

---

## 5. 🧪 Testing & Quality

### Test Setup

**Global Setup** (`src/test/setup.ts`):
```typescript
import "@testing-library/jest-dom/vitest"
```

**Configuration** (`vitest.config.ts`):
- Environment: `jsdom` (browser simulation)
- Globals enabled (describe, it, expect without imports)
- Path alias support (@/ → ./src/)

### Example Tests

#### Unit Test: Plan CTA Logic (`src/lib/planCta.test.ts`)

```typescript
import { describe, it, expect } from "vitest"
import { computeCta } from "./planCta"
import type { PlanKey } from "./plans"

const LOGGED_OUT = { userId: null, currentPlan: "free" as PlanKey, cancelAtPeriodEnd: false }
const ON_FREE = { userId: "u1", currentPlan: "free" as PlanKey, cancelAtPeriodEnd: false }
const ON_PRO = { userId: "u1", currentPlan: "pro_monthly" as PlanKey, cancelAtPeriodEnd: false }

describe("computeCta — logged out", () => {
  it("Free → 'Crear cuenta gratis'", () => {
    const r = computeCta("free", LOGGED_OUT)
    expect(r).toMatchObject({ label: "Crear cuenta gratis", disabled: false })
    expect(r.action.kind).toBe("free")
  })

  it("Essential → redirects to auth with plan param", () => {
    const r = computeCta("essential_monthly", LOGGED_OUT)
    expect(r.action).toEqual({ kind: "login", redirectTo: "/planes?plan=essential_monthly" })
  })
})

describe("computeCta — on Free (upgrades)", () => {
  it("Essential → 'Mejorar a Esencial'", () => {
    const r = computeCta("essential_monthly", ON_FREE)
    expect(r.label).toBe("Mejorar a Esencial")
    expect(r.action.kind).toBe("checkout")
  })
})

describe("computeCta — paid plan (downgrades / cancellations)", () => {
  it("Pro → Pro shows 'Tu plan actual' when not cancelling", () => {
    const r = computeCta("pro_monthly", ON_PRO)
    expect(r.action.kind).toBe("current")
    expect(r.disabled).toBe(true)
  })

  it("Pro → Pro shows 'Reactivar renovación' when cancelling pending", () => {
    const ctx = { ...ON_PRO, cancelAtPeriodEnd: true }
    const r = computeCta("pro_monthly", ctx)
    expect(r.label).toBe("Reactivar renovación")
    expect(r.action.kind).toBe("reactivate")
  })
})
```

**Key Testing Principles:**
- ✅ Pure functions (deterministic, no side effects)
- ✅ Test context/state combinations
- ✅ No mocking needed for business logic
- ✅ Clear test descriptions in Spanish

### Running Tests

```bash
npm run test          # Run once
npm run test:watch   # Watch mode with UI
npm run test -- --ui # Open browser UI
```

---

## 6. 🎨 Project-Specific Conventions

### UI Library: Radix UI + shadcn/ui

**Why this combination:**
- Radix UI: Unstyled, accessible primitives
- shadcn/ui: Pre-styled Tailwind + Radix components
- 45+ components ready to use

**Configuration** (`components.json`):
```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/styles.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

**Component Pattern:**
```typescript
// src/components/ui/button.tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
    size?: "default" | "sm" | "lg" | "icon"
    asChild?: boolean
  }
>(({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
```

### Form Handling Patterns

**Zod + react-hook-form**
- Validation schemas defined with Zod
- Type-safe form data via `z.infer<typeof schema>`
- Automatic error messages
- Custom resolvers for complex validation

### Styling Conventions

**Tailwind CSS with CSS Variables:**
```css
/* src/styles.css */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.6% 11.2%;
    --primary-foreground: 210 40% 98%;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
    }
  }
}
```

**Usage in Components:**
```tsx
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground">Action</button>
</div>
```

### Naming Conventions

#### Components
- **Domain components:** PascalCase, descriptive name
  - ✅ `SmartProfileCard.tsx`
  - ✅ `EnhancedPatientsModule.tsx`
  - ❌ `Card.tsx`, `Component.tsx`

- **UI primitives:** PascalCase, single word
  - ✅ `Button.tsx`, `Dialog.tsx`, `Input.tsx`

#### Hooks
- Kebab-case with `use-` prefix
  - ✅ `use-app-user.tsx`
  - ✅ `use-realtime-refresh.tsx`
  - ❌ `useAppUser.tsx`, `userAuth.tsx`

#### Routes
- Kebab-case or dot-notation for nesting
  - ✅ `dashboard.familia.tsx` → `/dashboard/familia`
  - ✅ `reset-password.tsx` → `/reset-password`
  - Dynamic: `$id.tsx` → `/{:id}`

#### Files
- PascalCase for components, kebab-case for utilities
  - ✅ `src/components/humanix/SmartProfileCard.tsx`
  - ✅ `src/lib/plan-cta.ts`
  - ✅ `src/hooks/use-app-user.tsx`

### SEO & Metadata

**Head Management** (TanStack Router):

```typescript
export const Route = createFileRoute("/planes")({
  head: () => ({
    meta: [
      { title: "Planes · Humanix" },
      { name: "description", content: "Elige el plan perfecto para tu rol..." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Planes · Humanix" },
      { property: "og:description", content: "..." },
      { property: "og:image", content: "..." },
    ],
    links: [{ rel: "canonical", href: "https://humanix.co/planes" }],
  }),
  component: PlanesPage,
})
```

**Structured Data** (JSON-LD in root layout):
- Organization schema
- Website schema
- LocalBusiness schema
- WebApplication schema

### Localization

**Language:** Spanish (Colombia dialect)
- ✅ "Crear cuenta", "Bajar a Free", "Mejorar a Esencial"
- ✅ Medical terminology: "Enfermería", "Auxiliar de Enfermería", "Cuidado Paliativo"
- ✅ Location-aware: "Bogotá", "Medellín", "Cali", etc.

---

## 7. 🗂️ Data Models & Domain Concepts

### User Roles

```typescript
type AppRole = 
  | "professional"    // Healthcare worker (nurse, carer)
  | "family"          // Care seeker/family
  | "institution"     // Healthcare organization (clinic, hospital)
  | "superadmin"      // Platform admin
  | "hr_staff"        // HR management team
  | "evaluator"       // Interview/evaluation staff
```

**Role Routing:**
```typescript
professional  → /dashboard/profesional
family        → /dashboard/familia
institution   → /dashboard/institucion
superadmin    → /superadmin
hr_staff      → /talento-humano
evaluator     → /evaluador
```

### Subscription Plans

```typescript
type PlanKey = 
  | "free"
  | "essential_monthly"
  | "pro_monthly"
  | "institution_monthly"
```

**Plan Attributes:**
- Tier-based system (free < essential < pro)
- Monthly billing
- Features gated by tier
- Checkout via MercadoPago

### Core Entities

- **Professional:** Healthcare worker with certifications, availability, ratings
- **Family:** Care seeker with needs, location, preferences
- **Booking:** Service request matching professional ↔ family
- **Message:** Real-time chat between users
- **Subscription:** Monthly billing tracked with cancel pending
- **AdBanner:** Marketing campaigns with AI matching

---

## 8. 🚀 Quick Reference for AI Agents

### To Add a New Feature

1. **Create Route:** `src/routes/feature-name.tsx`
   ```typescript
   export const Route = createFileRoute("/feature-name")({
     component: FeaturePage,
   })
   ```

2. **Create Component:** `src/components/humanix/FeatureComponent.tsx`
   - Import UI primitives from `@/components/ui/`
   - Use `cn()` for class merging
   - Follow PascalCase naming

3. **Create Hook (if stateful):** `src/hooks/use-feature.tsx`
   - Use `useAppUser()` for auth
   - Use `useRealtimeRefresh()` for real-time data
   - Return state and handlers

4. **Add Tests:** `src/lib/feature.test.ts`
   - Pure functions → unit tests
   - Use Vitest + Testing Library
   - Test user flows, not implementation

5. **Deploy:** `npm run build` → Automatic Cloudflare deployment

### To Debug

- **Auth Issues:** Check `src/hooks/use-app-user.tsx` and Supabase session
- **Real-time Data:** Verify `useRealtimeRefresh` subscriptions
- **Styling:** Check Tailwind merge conflicts using `cn()`
- **Tests:** Run `npm run test:watch` with UI

### File Locations

| Task | File |
|------|------|
| Add API endpoint | Supabase functions in `supabase/functions/` |
| Add UI component | `src/components/ui/` |
| Add business logic | `src/lib/` (testable, pure functions) |
| Add hook | `src/hooks/use-*.tsx` |
| Add route | `src/routes/name.tsx` |
| Add test | `src/lib/name.test.ts` or `src/routes/name.tsx` |
| Update SEO | `src/routes/__root.tsx` head function |

### Environment Variables

Required in `.env`:
```
VITE_SUPABASE_URL=https://rwllmouomrytejtbpxvn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-key
```

### Git Workflow

1. Feature branch: `git checkout -b feature/name`
2. Develop locally: `npm run dev`
3. Run tests: `npm run test`
4. Format: `npm run format`
5. Lint: `npm run lint`
6. Push and create PR
7. Merge deploys automatically to Cloudflare Workers

---

## 9. 📚 Additional Resources

- **TanStack Router:** https://tanstack.com/router/latest
- **React Hook Form:** https://react-hook-form.com/
- **Zod:** https://zod.dev/
- **Radix UI:** https://radix-ui.com/
- **Tailwind CSS:** https://tailwindcss.com/
- **Supabase:** https://supabase.com/docs
- **Vitest:** https://vitest.dev/

---

**Created for AI Agent Reference**  
*Last synced: May 26, 2026*
