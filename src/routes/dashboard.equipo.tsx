import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Briefcase,
  Building2,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Logo } from "@/components/humanix/Logo";
import { StaffOffersTab } from "@/components/humanix/staff/StaffOffersTab";
import { StaffPasswordDialog } from "@/components/humanix/staff/StaffPasswordDialog";
import { StaffTalentTab } from "@/components/humanix/staff/StaffTalentTab";
import { useAppUser } from "@/hooks/use-app-user";
import { useStaffContext } from "@/hooks/use-staff";
import { supabase } from "@/integrations/supabase/client";
import {
  RESERVED_FOR_OWNER,
  isStaffModule,
  moduleLabel,
  type StaffModuleKey,
} from "@/lib/institutionMembers";
import { resolveStaffTab, staffGate, type StaffContext } from "@/lib/staffPanel";

export const Route = createFileRoute("/dashboard/equipo")({
  validateSearch: (search: Record<string, unknown>): { tab?: StaffModuleKey } =>
    isStaffModule(search.tab) ? { tab: search.tab } : {},
  head: () => ({
    meta: [
      { title: "Panel del equipo · Humanix" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: StaffDashboard,
});

const TAB_ICON: Record<StaffModuleKey, typeof Briefcase> = { ofertas: Briefcase, talento: Users };

function StaffDashboard() {
  const { user, loading, logout } = useAppUser({ allow: ["institution_staff"] });
  const navigate = useNavigate();
  const search = Route.useSearch();
  const contextQuery = useStaffContext(user?.id);
  const [passwordOpen, setPasswordOpen] = useState(false);

  // Mientras llega la respuesta fresca se usa la que ya cargó useAppUser.
  const ctx: StaffContext | null = contextQuery.isSuccess
    ? contextQuery.data
    : (user?.staff ?? null);
  const knownGone = contextQuery.isSuccess && contextQuery.data === null;
  const gate = staffGate(ctx);
  const mustLeave = knownGone || gate.state === "suspended";

  // Suspendida o retirada: se cierra la sesión y se le explica por qué (la base de datos ya le cortó el acceso a los datos).
  useEffect(() => {
    if (!user || !mustLeave) return;
    let cancelled = false;
    void (async () => {
      await supabase.auth.signOut();
      if (!cancelled) {
        await navigate({
          to: "/acceso-equipo",
          search: { motivo: knownGone ? "retirado" : "suspendido" },
          replace: true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mustLeave, knownGone, navigate]);

  if (loading || !user || !ctx || mustLeave) {
    return (
      <div
        className="min-h-screen bg-background bg-aurora p-6"
        aria-busy="true"
        aria-label="Cargando el panel del equipo"
      >
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const tabs = gate.state === "ready" ? gate.tabs : [];
  const tab = resolveStaffTab(search.tab, tabs);

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora pb-16">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden sm:block">
              <Logo />
            </span>
            <div className="min-w-0">
              <p
                className="flex items-center gap-1.5 truncate text-sm font-semibold"
                data-testid="staff-institution"
              >
                <Building2 className="h-4 w-4 shrink-0 text-fuchsia-neural" aria-hidden />
                {ctx.institutionName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground" data-testid="staff-person">
                {ctx.displayName}
                {ctx.jobTitle ? ` · ${ctx.jobTitle}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Mi contraseña</span>
              <span className="sr-only sm:hidden">Mi contraseña</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={logout} title="Salir" aria-label="Salir">
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {gate.state !== "ready" ? (
          <Alert role="status" data-testid={`staff-gate-${gate.state}`}>
            <Lock className="h-4 w-4" aria-hidden />
            <AlertTitle>
              {gate.state === "paused" ? "Tu acceso está en pausa" : "Todavía no tienes módulos"}
            </AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{gate.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void contextQuery.refetch()}
                disabled={contextQuery.isFetching}
              >
                {contextQuery.isFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                Volver a revisar
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          tab && (
            <Tabs
              value={tab}
              onValueChange={(next) => {
                if (isStaffModule(next))
                  void navigate({ to: "/dashboard/equipo", search: { tab: next }, replace: true });
              }}
            >
              <TabsList
                aria-label="Módulos a los que tienes acceso"
                className="h-auto w-full flex-wrap justify-start gap-1"
              >
                {tabs.map((key) => {
                  const Icon = TAB_ICON[key];
                  return (
                    <TabsTrigger key={key} value={key} className="gap-1.5">
                      <Icon className="h-4 w-4" aria-hidden /> {moduleLabel(key)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {tabs.includes("ofertas") && (
                <TabsContent value="ofertas" className="mt-5">
                  <StaffOffersTab
                    institutionId={ctx.institutionId}
                    defaultCity={ctx.institutionCity}
                  />
                </TabsContent>
              )}
              {tabs.includes("talento") && (
                <TabsContent value="talento" className="mt-5">
                  <StaffTalentTab viewerId={user.id} />
                </TabsContent>
              )}
            </Tabs>
          )
        )}

        <section
          className="rounded-2xl border border-border bg-card/70 p-4 text-xs text-muted-foreground"
          aria-label="Tu acceso"
          data-testid="staff-scope"
        >
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
            Tu acceso
            {ctx.modules.map((m) => (
              <Badge key={m} variant="outline" className="text-biosensor">
                {moduleLabel(m)}
              </Badge>
            ))}
          </div>
          <p className="mb-1">Esto sigue siendo solo de la cuenta de la institución:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {RESERVED_FOR_OWNER.map((r) => (
              <li key={r.label}>
                <span className="font-medium text-foreground">{r.label}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <StaffPasswordDialog
        username={ctx.username}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  );
}
