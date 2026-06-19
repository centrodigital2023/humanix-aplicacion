# AI Agent Instructions for humanix-care-connect

> **Last Updated:** May 26, 2026

## 🚀 Quick Start Commands

```bash
# Install dependencies
bun install

# Development server
bun run dev

# Build for production
bun run build

# Run tests
bun run test          # Single run
bun run test:watch    # Watch mode

# Linting & formatting
bun run lint
bun run format
```

**Dev Server:** http://localhost:5173

---

## 📋 Project Overview

**humanix-care-connect** is a comprehensive healthcare coordination platform built with:

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | TanStack Start + React 19 (file-based routing) |
| **UI Components** | Radix UI (unstyled) + shadcn/ui (styled) |
| **Styling** | Tailwind CSS 4.2.1 with CSS variables |
| **Backend** | Supabase (PostgreSQL + Auth + Realtime) |
| **Build Tool** | Vite + Cloudflare Workers integration |
| **Testing** | Vitest + jsdom |
| **Package Manager** | Bun |

**Core Purpose:** Match healthcare professionals with families/institutions for coordinated home care, with FUID compliance and role-based dashboards.

---

## 🏗️ Project Architecture

### Directory Structure

```
src/
├── routes/               # 60+ file-based routes (TanStack Router)
│   ├── __root.tsx       # Root layout wrapper
│   ├── dashboard.*.tsx  # 6 role-specific dashboards
│   ├── auth.tsx         # Authentication routes
│   └── ...              # Domain routes (planes, profesionales, etc.)
├── components/
│   ├── humanix/         # 60+ domain-specific components
│   │   ├── Enhanced*.tsx # New high-value features (May 2026)
│   │   └── ...          # Modular, reusable business logic
│   └── ui/              # 45+ shadcn/ui primitive components
├── hooks/               # 5 key custom hooks
│   ├── use-app-user.tsx # Auth & user context
│   ├── use-plan.tsx     # Subscription tier logic
│   ├── use-realtime-refresh.tsx # Supabase realtime
│   └── ...
├── lib/
│   ├── planCta.ts       # Pricing/subscription logic (well-tested)
│   ├── humanixAi.ts     # AI integration utilities
│   ├── utils.ts         # Common helpers
│   └── ...
├── integrations/
│   └── supabase/        # Supabase client initialization
├── content/
│   └── recursos.tsx     # Static content routes
└── styles.css           # Global Tailwind + CSS variables
```

### Key Files by Role

| What I Need | Location | Notes |
|------------|----------|-------|
| Add a new route | `src/routes/[name].tsx` | Use file-based naming; see existing patterns |
| Create a component | `src/components/humanix/[Name].tsx` | Use PascalCase; follow shadcn/ui patterns |
| Add a hook | `src/hooks/use-[name].tsx` | Use kebab-case; see `use-plan.tsx` for example |
| Business logic | `src/lib/[function].ts` | Keep functions pure & testable |
| Tests | `src/lib/[file].test.ts` | Collocate with source; use Vitest syntax |
| Styling | `src/styles.css` | Tailwind @directives + CSS variables |

---

## 🎯 Key Conventions & Patterns

### 1. **Routing (TanStack Router)**

```tsx
// ✅ File-based routing - matches path structure
// File: src/routes/profesionales.tsx → /profesionales
// File: src/routes/profesional.$proId.tsx → /profesional/:proId
// File: src/routes/dashboard.familia.tsx → /dashboard/familia

// ✅ Use route metadata for auth guards
export const Route = createFileRoute('/dashboard/familia')({
  beforeLoad: ({ context }) => {
    if (context.user?.role !== 'familia') {
      throw redirect({ to: '/auth' });
    }
  },
  component: DashboardFamiliaComponent,
});

// ❌ Don't use hash routing or manually create Router
```

### 2. **Components & Composition**

```tsx
// ✅ Radix UI + shadcn/ui pattern
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { EnhancedPatientsModule } from '@/components/humanix/EnhancedPatientsModule';

export function MyFeature() {
  return (
    <div className="space-y-4">
      <EnhancedPatientsModule userId={userId} />
      <Button onClick={handleAction}>Submit</Button>
    </div>
  );
}

// ✅ Modular components with clear prop interfaces
interface PatientListProps {
  patients: Patient[];
  onSelect: (id: string) => void;
  loading?: boolean;
}

// ❌ Don't prop-drill deeply; use Context for auth/theme/user
// ❌ Don't import from 'react-icons' or other UI libs; use Radix/shadcn only
```

### 3. **Forms & Validation**

```tsx
// ✅ Use react-hook-form + Zod for validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['professional', 'family', 'institution']),
});

export function MyForm() {
  const form = useForm({ resolver: zodResolver(schema) });
  
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* Use form.register(), form.formState for errors */}
    </form>
  );
}

// ❌ Don't use uncontrolled forms or manual validation
```

### 4. **Styling**

```tsx
// ✅ Use Tailwind classes for styling
<div className="flex items-center justify-between gap-4 p-4">
  <h2 className="text-lg font-semibold text-foreground">
    Pacientes Activos
  </h2>
</div>

// ✅ Use semantic color tokens from CSS variables
// Available: --background, --foreground, --primary, --secondary, etc.

// ❌ Don't use inline styles or arbitrary values like bg-[#abc123]
// ❌ Don't import external CSS files; use global styles.css
```

### 5. **Business Logic & State Management**

```tsx
// ✅ Extract business logic to pure functions in src/lib/
// Example: src/lib/planCta.ts
export function calculateDiscountedPrice(plan: Plan, coupon?: Coupon): number {
  // Pure, testable, no side effects
  return plan.price * (1 - (coupon?.discount ?? 0));
}

// ✅ Use TanStack Query for async data
import { useQuery, useMutation } from '@tanstack/react-query';

const { data, isLoading } = useQuery({
  queryKey: ['patients', userId],
  queryFn: () => fetchPatients(userId),
});

// ✅ Use Supabase realtime for live updates
const { data } = useRealtimeRefresh({
  channel: 'messages',
  event: 'INSERT',
});

// ❌ Don't use useState for complex async state
// ❌ Don't mix business logic with components
```

### 6. **Authentication & User Context**

```tsx
// ✅ Use the use-app-user hook for current user
const { user, loading } = useAppUser();

if (loading) return <LoadingSpinner />;
if (!user) return <Redirect to="/auth" />;

// ✅ Check role-specific access early
if (user.role !== 'institution') {
  throw new Error('Only institutions can access this');
}

// ❌ Don't refetch user on every route change
// ❌ Don't store sensitive data in localStorage directly
```

### 7. **Testing**

```tsx
// ✅ Write unit tests for business logic (see src/lib/planCta.test.ts)
import { describe, it, expect } from 'vitest';
import { calculateDiscountedPrice } from './planCta';

describe('calculateDiscountedPrice', () => {
  it('applies coupon discount correctly', () => {
    const result = calculateDiscountedPrice(
      { price: 100 },
      { discount: 0.1 }
    );
    expect(result).toBe(90);
  });
});

// ✅ Mock Supabase calls in tests
// ❌ Don't write E2E tests with real database
// ❌ Don't test rendering details; test behavior instead
```

---

## 📚 User Roles & Dashboards

The platform supports 6 user roles, each with specialized functionality:

| Role | Dashboard Route | Key Features |
|------|-----------------|--------------|
| **professional** | `/dashboard/profesional` | Profile, availability, patient list, earnings |
| **family** | `/dashboard/familia` | Onboarding, patient records, payments, support |
| **institution** | `/dashboard/institucion` | Staff management, bulk offers, compliance |
| **hr_staff** | `/dashboard` | Recruiting, interview, patient assignment |
| **evaluator** | `/evaluador` | Assessment forms, scoring, recommendations |
| **superadmin** | `/superadmin` | CRM, analytics, fraud detection, content |

**Important:** Always check `user.role` before rendering role-specific features.

---

## 🔄 Common Development Tasks

### Add a New Route

1. Create file: `src/routes/my-feature.tsx`
2. Use TanStack Router patterns (see examples in existing routes)
3. Add authentication guard if needed
4. Register in route tree (auto-generated via `@tanstack/router-plugin`)

### Add a New Component

1. Create file: `src/components/humanix/MyComponent.tsx`
2. Import Radix/shadcn UI primitives
3. Keep components focused and reusable
4. Write TypeScript interfaces for props
5. Collocate tests if needed

### Connect to Supabase

```tsx
// ✅ Use the Supabase client from integration
import { createClient } from '@/integrations/supabase/client';

const supabase = createClient();
const { data, error } = await supabase
  .from('professionals')
  .select('*')
  .eq('id', userId);
```

### Add Tests

1. Create `src/lib/my-function.test.ts` or `src/components/MyComponent.test.ts`
2. Use Vitest syntax (same as Jest)
3. Run with `bun run test:watch`
4. Aim for pure function & integration tests, not unit testing internals

---

## ⚠️ Important Do's & Don'ts

### Do's ✅

- **Use TypeScript strictly** — catch errors early
- **Keep components small** — easier to test and maintain
- **Extract logic to pure functions** — in src/lib/
- **Link related features** — use route params, not query strings
- **Test critical paths** — pricing, auth, data flows
- **Use Supabase realtime** — for live updates, don't poll
- **Follow Spanish naming where appropriate** — many routes are in Spanish
- **Write descriptive commit messages** — helps with code review

### Don'ts ❌

- **Don't use async components** — not yet supported in TanStack Start
- **Don't bypass Zod validation** — always validate form inputs
- **Don't fetch data in render** — use TanStack Query
- **Don't store auth tokens in localStorage** — Supabase handles this
- **Don't add new UI libraries** — stick with Radix/shadcn/Tailwind
- **Don't commit without formatting** — run `bun run format`
- **Don't hardcode API URLs** — use environment variables
- **Don't ignore ESLint warnings** — they catch real bugs

---

## 🧪 Testing Patterns

The project uses **Vitest** with jsdom. Key test files:

- `src/lib/planCta.test.ts` — Unit tests for pricing logic
- `src/lib/planCta.checkout.test.ts` — Checkout flow tests

**Run tests:**

```bash
bun run test              # Single run
bun run test:watch        # Watch mode
```

**Testing best practices:**

```tsx
// ✅ Test business logic
describe('Plan Pricing', () => {
  it('calculates correct tier', () => {
    expect(getPlanTier(5000)).toBe('premium');
  });
});

// ❌ Don't test implementation details
// ❌ Don't test that Button renders <button />
```

---

## 🔗 Key Integrations

### Supabase

- **Client:** `src/integrations/supabase/client.ts`
- **Auth:** Handled via `useAppUser()` hook
- **Realtime:** Use `use-realtime-refresh.tsx` hook
- **Types:** Auto-generated from Supabase schema

### Cloudflare Workers

- **Config:** `wrangler.jsonc`
- **Build:** Vite with Cloudflare plugin
- **Deploy:** Configured for workers deployment

### AI Integration

- **Utilities:** `src/lib/humanixAi.ts`
- **Embeddings:** For service recommendations
- **Chat:** Integrated in messaging routes

---

## 📝 Special Notes

### May 2026 Enhancements

Recent additions include powerful domain components:

- **EnhancedBulkOffersModule** — Institutional bulk publishing with FUID compliance
- **EnhancedPatientsModule** — Patient management with KPIs and service history
- **EnhancedAgendaModule** — 7-day calendar with operational insights
- **EnhancedCRMModule** — Superadmin CRM functionality
- **Enhanced*Panels** — Compliance tracking for all roles

See [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) for detailed feature documentation.

### FUID Compliance

The platform enforces Colombian FUID (Fondo para la Universalización de la Información y Democratización de la Comunicación) requirements:

- Criminal history checks: 5 years
- Medical exams: 3 years
- Work references: 2 years
- Certifications: 5 years

Always validate document expiry in professional profiles.

---

## 🎓 Learning Resources

- **TanStack Start:** File-based routing, layouts, loaders
- **Radix UI:** Accessible, unstyled component primitives
- **Tailwind CSS:** Utility-first styling framework
- **Supabase:** PostgreSQL + Auth + Realtime backend
- **Vitest:** Modern unit testing framework

---

## 🐛 Debugging Tips

1. **Check user context:** Always verify `useAppUser()` and permissions
2. **Inspect Supabase calls:** Look at network tab for realtime subscriptions
3. **Review route guards:** Check `beforeLoad` in `__root.tsx`
4. **Test in isolation:** Extract logic to pure functions, test separately
5. **Use ESLint:** Catches common TypeScript and React issues

---

## 📞 When Stuck

- Check similar existing implementations in `src/routes/` or `src/components/humanix/`
- Look at test files for expected behavior and patterns
- Review [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) for recent features
- Test business logic in isolation before integration
- Verify Supabase schema matches your queries

---

**Happy coding! 🚀**
