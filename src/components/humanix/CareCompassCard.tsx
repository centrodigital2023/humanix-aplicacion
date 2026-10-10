// Brújula del día: saludo cálido, estado del día en una frase y las próximas acciones priorizadas.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Compass, HeartHandshake, Sparkles } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveServices } from "@/hooks/use-care-loop";
import { buildBriefing, type CompassRole, type CompassTone } from "@/lib/careCompass";
import { cn } from "@/lib/utils";

const sb = supabase as unknown as SupabaseClient;

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count: c, error } = await q;
    return error ? 0 : (c ?? 0);
  } catch {
    return 0;
  }
}

function useCompassCounts(role: CompassRole, userId: string) {
  return useQuery({
    queryKey: ["compass", role, userId],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const head = { count: "exact" as const, head: true };
      const unread = count(
        sb.from("notifications").select("id", head).eq("user_id", userId).is("read_at", null),
      );
      let proposals = Promise.resolve(0);
      let applications = Promise.resolve(0);
      let openOffers = Promise.resolve(0);
      if (role === "family") {
        proposals = count(
          sb.from("slot_proposals").select("id", head).eq("family_user_id", userId)
            .eq("status", "pending").eq("proposed_by", "professional"),
        );
      } else if (role === "professional") {
        proposals = count(
          sb.from("slot_proposals").select("id", head).eq("professional_id", userId)
            .eq("status", "pending").eq("proposed_by", "family"),
        );
        applications = count(
          sb.from("applications").select("id", head).eq("professional_id", userId)
            .eq("status", "pending").eq("awaiting", "professional"),
        );
      } else {
        applications = count(
          sb.from("applications").select("id, job_offers!inner(posted_by)", head)
            .eq("job_offers.posted_by", userId).eq("status", "pending").eq("awaiting", "institution"),
        );
        openOffers = count(
          sb.from("job_offers").select("id", head).eq("posted_by", userId).eq("status", "open"),
        );
      }
      const [u, p, a, o] = await Promise.all([unread, proposals, applications, openOffers]);
      return { unread: u, proposals: p, applications: a, openOffers: o };
    },
  });
}

const TONE: Record<CompassTone, { ring: string; chip: string; label: string }> = {
  calm: { ring: "ring-ok/30", chip: "bg-ok/15 text-ok", label: "Todo en orden" },
  attention: { ring: "ring-warn/40", chip: "bg-warn/15 text-warn", label: "Requiere atención" },
  urgent: { ring: "ring-destructive/40", chip: "bg-destructive/15 text-destructive", label: "Urgente" },
};

export function CareCompassCard({
  role,
  userId,
  name,
}: {
  role: CompassRole;
  userId: string;
  name?: string | null;
}) {
  const services = useActiveServices(userId);
  const counts = useCompassCounts(role, userId);

  if (services.isLoading || counts.isLoading) {
    return <Skeleton className="h-56 w-full rounded-3xl" />;
  }

  const b = buildBriefing({
    role,
    now: new Date(),
    firstName: name,
    services: services.data ?? [],
    unreadNotifications: counts.data?.unread ?? 0,
    pendingProposals: counts.data?.proposals ?? 0,
    pendingApplications: counts.data?.applications ?? 0,
    openOffers: counts.data?.openOffers ?? 0,
  });
  const tone = TONE[b.tone];
  const r = 34;
  const circ = 2 * Math.PI * r;

  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-primary/10 via-background to-trust/10 p-5 ring-1 sm:p-6",
        tone.ring,
      )}
      aria-label="Brújula del día"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative mx-auto h-24 w-24 shrink-0 sm:mx-0" aria-hidden="true">
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
            <circle cx="40" cy="40" r={r} className="fill-none stroke-muted" strokeWidth="7" />
            <circle
              cx="40"
              cy="40"
              r={r}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - b.calm / 100)}
              className={cn(
                "fill-none transition-all duration-700",
                b.tone === "urgent" ? "stroke-destructive" : b.tone === "attention" ? "stroke-warn" : "stroke-ok",
              )}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-2xl font-bold">{b.calm}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">calma</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Compass className="h-3.5 w-3.5" aria-hidden="true" /> Brújula del día
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone.chip)}>{tone.label}</span>
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold">{b.greeting}</h2>
          <p className="mt-1 text-base text-muted-foreground">{b.headline}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {b.stats.map((st) => (
              <div key={st.label} className="rounded-2xl bg-background/70 px-3 py-2 text-center ring-1 ring-border">
                <dd className="font-display text-xl font-bold">{st.value}</dd>
                <dt className="text-xs text-muted-foreground">{st.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 inline-flex items-center gap-1 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Lo que te sugerimos ahora
        </p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {b.actions.map((a, i) => (
            <li key={a.id}>
              <Link
                to={a.to}
                className="group flex min-h-16 items-start gap-3 rounded-2xl bg-background/80 p-3 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    a.tone === "urgent"
                      ? "bg-destructive/15 text-destructive"
                      : a.tone === "attention"
                        ? "bg-warn/15 text-warn"
                        : "bg-primary/10 text-primary",
                  )}
                >
                  {a.tone === "urgent" ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.title}</span>
                  <span className="block text-sm text-muted-foreground">{a.reason}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" /> Sugerencias automáticas: tú decides siempre.
      </p>
    </Card>
  );
}
