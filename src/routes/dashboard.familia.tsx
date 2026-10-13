import { useEffect, useCallback, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  Heart,
  Search,
  LayoutDashboard,
  FileText,
  Users,
  Sparkles,
  Calendar,
  ShieldCheck,
  MessageSquare,
  Crown,
  Phone,
  MapPin,
  Star,
  Inbox,
  ChevronRight,
  Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { HiringCopilot } from "@/components/humanix/HiringCopilot";
import { OffersMap, type MapPoint } from "@/components/humanix/OffersMap";
import { LiveMapSection } from "@/components/humanix/LiveMapSection";
import { MercadoPagoSubscription } from "@/components/humanix/MercadoPagoSubscription";
import { SmartFamilyProfileForm } from "@/components/humanix/SmartFamilyProfileForm";

import { DangerZoneCard } from "@/components/humanix/DangerZoneCard";
import { PendingRatingsCard } from "@/components/humanix/PendingRatingsCard";
import { FamilyNeedsCalendar } from "@/components/humanix/FamilyNeedsCalendar";
import { ApplicantCards } from "@/components/humanix/ApplicantCards";
import { OwnTrustCard } from "@/components/humanix/OwnTrustCard";
import { MyPqrsCard } from "@/components/humanix/MyPqrsCard";
import { CareCirclePanel } from "@/components/humanix/CareCirclePanel";
import { CareFeed } from "@/components/humanix/CareFeed";
import { ActiveServicesCard } from "@/components/humanix/care/ActiveServicesCard";
import { CareHistoryCard } from "@/components/humanix/care/CareHistoryCard";
import { TrustedTeamCard } from "@/components/humanix/care/TrustedTeamCard";
import { useActiveServices } from "@/hooks/use-care-loop";
import { ClinicalMonitor } from "@/components/humanix/ClinicalMonitor";
import { WearableConnections } from "@/components/humanix/WearableConnections";
import { formatKm } from "@/lib/geo";
import { kmTo, sortProfessionals, STATUS_LABEL } from "@/lib/liveMap";
import { trustBadgeText } from "@/lib/trustScore";
import { useMapProfessionals } from "@/hooks/use-live-map";
import { FamilyMapVisibility } from "@/components/humanix/family/FamilyMapVisibility";
import { ServiceOffersFeed } from "@/components/humanix/service/ServiceOffersFeed";
import { toast } from "sonner";
import { useAppUser } from "@/hooks/use-app-user";
import { MyBookings } from "@/components/humanix/simple/MyBookings";
import { LiveNearby } from "@/components/humanix/simple/LiveNearby";
import { FamilyQuickActions } from "@/components/humanix/simple/FamilyQuickActions";
import { LivePulseBar } from "@/components/humanix/LivePulseBar";
import { FamilySmartCenter } from "@/components/humanix/family/FamilySmartCenter";
import { SosFamiliarButton } from "@/components/humanix/SosFamiliarButton";
import { SosAlertsPanel } from "@/components/humanix/SosAlertsPanel";

export const Route = createFileRoute("/dashboard/familia")({
  head: () => ({ meta: [{ title: "Familia · Humanix" }] }),
  component: FamilyDashboard,
});

const getNav = (): NavItem[] => [
  { label: "Mi panel", to: "/dashboard/familia", icon: LayoutDashboard },
  { label: "Pedir cuidado", to: "/buscar", icon: Search },
  { label: "Mensajes", to: "/mensajes", icon: MessageSquare },
  { label: "Salud en vivo", to: "/dashboard/monitoreo", icon: Heart },
  { label: "Mi plan", to: "/planes", icon: Crown },
];

type Offer = {
  id: string;
  title: string;
  city: string;
  modality: string;
  amount: number;
  status: string;
  created_at: string;
  lat: number | null;
  lng: number | null;
  reserved_until: string | null;
};

type ApplicationRow = {
  id: string;
  status: string;
  created_at: string;
  proposed_amount: number | null;
  message: string | null;
  professional_id: string;
  job_offer_id: string;
};

type NearbyOffer = {
  id: string;
  title: string;
  city: string;
  amount: number;
  modality: string;
  posted_by: string;
  created_at: string;
};

function FamilyDashboard() {
  const { user, loading, logout } = useAppUser({ allow: ["family", "superadmin"] });
  const [dataLoading, setDataLoading] = useState(true);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [nearby, setNearby] = useState<NearbyOffer[]>([]);
  const [familyCity, setFamilyCity] = useState<string>("Bogotá");
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [hasEmergencyContact, setHasEmergencyContact] = useState(true);
  const [familyCoords, setFamilyCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });
  const [familyAddress, setFamilyAddress] = useState<string>("");
  const [savingLoc, setSavingLoc] = useState(false);

  // Profesionales cercanos: función segura de la base (nombre abreviado, zona aproximada, sin teléfono ni dirección) y en vivo.
  const origin =
    familyCoords.lat != null && familyCoords.lng != null
      ? { lat: familyCoords.lat, lng: familyCoords.lng }
      : null;
  const prosQ = useMapProfessionals({ authed: !!user, enabled: !!user });
  const nearbyPros = useMemo(
    () => sortProfessionals(prosQ.data ?? [], origin).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prosQ.data, familyCoords.lat, familyCoords.lng],
  );

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [offersRes, famRes, profRes] = await Promise.all([
          supabase
            .from("job_offers")
            .select(
              "id, title, city, modality, amount, status, created_at, lat, lng, reserved_until",
            )
            .eq("posted_by", user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("family_profiles")
            .select(
              "id_number, default_address, default_lat, default_lng, emergency_contact_phone, habeas_data_accepted",
            )
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.from("profiles").select("city").eq("user_id", user.id).maybeSingle(),
        ]);
        if (!active) return;

        const offerList = (offersRes.data ?? []) as Offer[];
        setOffers(offerList);

        const fam = famRes.data;
        setOnboardingComplete(
          !!(
            fam?.id_number &&
            fam?.default_address &&
            fam?.emergency_contact_phone &&
            fam?.habeas_data_accepted
          ),
        );
        setHasEmergencyContact(!!fam?.emergency_contact_phone);
        setFamilyCoords({
          lat: fam?.default_lat ?? null,
          lng: fam?.default_lng ?? null,
        });
        setFamilyAddress(fam?.default_address ?? "");

        const myCity = profRes.data?.city ?? offerList[0]?.city ?? "Bogotá";
        setFamilyCity(myCity);

        // Postulaciones a MIS ofertas (resumen para el centro de cuidado; las tarjetas completas las trae ApplicantCards)
        const offerIds = offerList.map((o) => o.id);
        if (offerIds.length > 0) {
          const { data: appsData } = await supabase
            .from("applications")
            .select(
              "id, status, created_at, proposed_amount, message, professional_id, job_offer_id",
            )
            .in("job_offer_id", offerIds)
            .order("created_at", { ascending: false })
            .limit(50);
          const apps = (appsData ?? []) as ApplicationRow[];
          setApplications(apps);
        }

        // Ofertas cercanas (mismo city) que NO son mías y están open
        const { data: nearbyData } = await supabase
          .from("job_offers")
          .select("id, title, city, amount, modality, posted_by, created_at")
          .eq("status", "open")
          .ilike("city", `%${myCity}%`)
          .neq("posted_by", user.id)
          .order("created_at", { ascending: false })
          .limit(6);
        setNearby((nearbyData ?? []) as NearbyOffer[]);
      } catch (err) {
        console.error("[familia dashboard] load failed:", err);
      } finally {
        if (active) setDataLoading(false);
      }
    })();
    const safety = setTimeout(() => {
      if (active) setDataLoading(false);
    }, 8000);

    // Realtime: subscribe to my offers + applications + notifications
    const channel = supabase
      .channel(`fam-dash-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_offers", filter: `posted_by=eq.${user.id}` },
        (payload) => {
          setOffers((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((o) => o.id !== (payload.old as { id: string }).id);
            }
            const row = payload.new as Offer;
            const exists = prev.some((o) => o.id === row.id);
            return exists
              ? prev.map((o) => (o.id === row.id ? { ...o, ...row } : o))
              : [row, ...prev];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        (payload) => {
          // Only react if the application is for one of my offers
          const row = (payload.new ?? payload.old) as ApplicationRow;
          setOffers((prevOffers) => {
            if (!prevOffers.some((o) => o.id === row.job_offer_id)) return prevOffers;
            setApplications((prev) => {
              if (payload.eventType === "DELETE") {
                return prev.filter((a) => a.id !== row.id);
              }
              const exists = prev.some((a) => a.id === row.id);
              if (!exists && payload.eventType === "INSERT") {
                toast.success("📬 Nueva postulación recibida");
              }
              return exists
                ? prev.map((a) => (a.id === row.id ? (payload.new as ApplicationRow) : a))
                : [payload.new as ApplicationRow, ...prev];
            });
            return prevOffers;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as { title?: string; body?: string };
          if (n?.title) toast(n.title, { description: n.body ?? undefined });
        },
      )
      .subscribe();

    return () => {
      active = false;
      clearTimeout(safety);
      supabase.removeChannel(channel);
    };
  }, [user]);

  const smartProfile = useMemo(
    () => ({ complete: onboardingComplete, hasEmergencyContact }),
    [onboardingComplete, hasEmergencyContact],
  );

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  const open = offers.filter((o) => o.status === "open").length;
  const filled = offers.filter((o) => o.status === "filled").length;
  const pendingApps = applications.filter((a) => a.status === "pending").length;

  const saveLocation = async (lat: number, lng: number, address?: string) => {
    if (!user) return;
    setSavingLoc(true);
    try {
      const updates: Record<string, unknown> = { default_lat: lat, default_lng: lng };
      if (address && !familyAddress) {
        updates.default_address = address;
        setFamilyAddress(address);
      }
      const { error } = await supabase
        .from("family_profiles")
        .upsert({ user_id: user.id, ...updates } as never, { onConflict: "user_id" });
      if (error) throw error;
      setFamilyCoords({ lat, lng });
      toast.success("📍 Ubicación guardada — distancias actualizadas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la ubicación");
    } finally {
      setSavingLoc(false);
    }
  };

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={getNav()}
      title={
        user.fullName && !user.fullName.includes("@")
          ? `Hola, ${user.fullName.split(" ")[0]} 👋`
          : "Hola 👋"
      }
      subtitle="¿Qué necesitas hoy?"
      crumbs={[{ label: "🏠 Inicio", to: "/" }, { label: "Familia" }]}
      badge={{ label: "Familia", tone: "copper" }}
      actions={<HiringCopilot />}
    >
      <div className="space-y-6">
        {/* Acciones rápidas */}
        <FamilyQuickActions />

        {/* SOS: pedir ayuda con la ubicación y ver las alertas de mi círculo de cuidado */}
        {user?.id && (
          <section aria-label="Emergencias" className="space-y-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground sm:max-w-[60%]">
                ¿Necesitas ayuda urgente? Avisa a tu círculo de cuidado y a tu profesional con tu
                ubicación.
              </p>
              <SosFamiliarButton patientId={user.id} patientName={user.fullName} />
            </div>
            <SosAlertsPanel userId={user.id} />
          </section>
        )}

        {/* Tu centro de cuidado: saludo, calma y resumen del día para todas las familias, y herramientas inteligentes (plan Esencial) */}
        <FamilySmartCenter
          userId={user.id}
          name={user.fullName}
          city={familyCity}
          profile={smartProfile}
          applications={applications}
          offers={offers}
          coords={familyCoords}
        />

        {/* Quién se postuló a lo que publiqué: tarjetas con confianza, calificación, zona y valor; aceptar, rechazar o negociar según el plan */}
        {user?.id && (
          <div id="propuestas" className="scroll-mt-4">
            <ApplicantCards userId={user.id} familyName={user.fullName} />
          </div>
        )}

        {/* Profesionales que publican su servicio: Trust Score, RETHUS, calificación, estado en vivo y cercanía */}
        {user?.id && <ServiceOffersFeed viewerId={user.id} audience="family" />}

        {/* Mis servicios activos */}
        {user && <MyBookings userId={user.id} />}

        {/* Servicios de familiares que me invitaron a su círculo de cuidado (solo lectura) */}
        {user && (
          <ActiveServicesCard
            userId={user.id}
            title="Servicios de tu círculo de cuidado"
            sides={["circle"]}
          />
        )}

        {/* Parte del turno en vivo */}
        {user?.id && <ActiveCareFeedSection clientId={user.id} />}

        {/* Valoraciones pendientes */}
        {user?.id && (
          <div id="calificar" className="scroll-mt-4 empty:hidden">
            <PendingRatingsCard userId={user.id} role="family" />
          </div>
        )}

        {/* Mapa en vivo */}
        <section aria-labelledby="fam-map" className="space-y-3">
          <h2 id="fam-map" className="font-display text-xl font-bold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-copper" /> Cerca de ti
          </h2>
          <LivePulseBar role="family" />
          <LiveNearby audience="familias" user={user} />
          <FamilyMapVisibility userId={user.id} />
        </section>

        {/* ── AGENDA ─────────────────────────────────────── */}
        {user?.id && (
          <section id="agenda" className="scroll-mt-4 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-biosensor" />
              <h2 className="font-display text-xl font-bold">Mi agenda</h2>
            </div>
            <FamilyNeedsCalendar userId={user.id} serviceAddress={familyAddress ?? null} />
            <div id="circulo" className="scroll-mt-4 empty:hidden">
              <CareCirclePanel userId={user.id} userEmail={user.email} />
            </div>
          </section>
        )}

        {/* ── EQUIPO DE CONFIANZA + HISTORIA DE CUIDADO ───── */}
        {user?.id && (
          <section className="space-y-4" aria-label="Equipo de confianza e historia de cuidado">
            <div id="equipo" className="scroll-mt-4 empty:hidden">
              <TrustedTeamCard userId={user.id} role="family" />
            </div>
            <CareHistoryCard userId={user.id} kind="family" />
          </section>
        )}

        {/* ── CONFIANZA Y SOPORTE: mi Trust Score y mis PQRS (llegan al equipo de Humanix) ───────── */}
        {user?.id && (
          <section
            id="confianza"
            aria-label="Confianza y soporte"
            className="scroll-mt-4 grid items-start gap-4 lg:grid-cols-2"
          >
            <OwnTrustCard userId={user.id} kind="family" />
            <div id="pqrs" className="scroll-mt-4">
              <MyPqrsCard userId={user.id} name={user.fullName} email={user.email} />
            </div>
          </section>
        )}

        {/* ── PAGO / PLAN ─────────────────────────────────── */}
        <section
          id="planes"
          className="rounded-[2rem] bg-gradient-to-br from-card to-card/60 p-6 ring-1 ring-border shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold flex items-center gap-2">
              <Crown className="h-5 w-5 text-copper" /> Tu plan
            </h2>
            <Link
              to="/planes"
              className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Ver planes <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {user?.id && (
            <MercadoPagoSubscription
              userId={user.id}
              defaultPlan="essential_monthly"
              plans={["essential_monthly"]}
            />
          )}
        </section>

        {/* ── PERFIL ──────────────────────────────────────── */}
        <details
          id="mis-datos"
          className="group rounded-[2rem] bg-card p-5 shadow-sm ring-1 ring-border"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold">
            <span className="flex items-center gap-3">
              <span aria-hidden="true">👤</span> Mi perfil
            </span>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
            />
          </summary>
          <div className="mt-4">{user && <SmartFamilyProfileForm userId={user.id} />}</div>
        </details>

        {/* ── HERRAMIENTAS AVANZADAS ──────────────────────── */}
        <details className="group rounded-[2rem] bg-card p-5 shadow-sm ring-1 ring-border">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold">
            <span className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-muted-foreground" /> Más herramientas
            </span>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
            />
          </summary>
          <div className="mt-6 space-y-8">
            {/* Mapa completo con ubicación */}
            {user && (
              <div>
                <LiveMapSection
                  role="family"
                  userId={user.id}
                  height={520}
                  pickLocation={{
                    lat: familyCoords.lat,
                    lng: familyCoords.lng,
                    defaultCity: familyCity,
                    onChange: (lat, lng, address) => void saveLocation(lat, lng, address),
                  }}
                />
                {savingLoc && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Guardando…
                  </p>
                )}
              </div>
            )}

            {/* KPIs */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi icon={FileText} label="Solicitudes" value={offers.length} tone="bio" />
              <Kpi icon={Calendar} label="Abiertas" value={open} tone="copper" />
              <Kpi icon={Inbox} label="Postulaciones" value={pendingApps} tone="fuchsia" />
              <Kpi icon={ShieldCheck} label="Cubiertas" value={filled} tone="bio" />
            </section>

            {/* Salud en vivo */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold flex items-center gap-2">
                  <Heart className="h-4 w-4 text-rose-500 animate-pulse" />
                  Salud en vivo
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                </h2>
                <Link
                  to="/dashboard/monitoreo"
                  className="text-xs text-biosensor hover:underline flex items-center gap-1"
                >
                  Ver completo <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <WearableConnections patientId={user.id} />
              <ClinicalMonitor patientId={user.id} showDeviceGuide={false} compact />
            </section>

            {/* Profesionales cercanos */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-fuchsia-neural" /> Profesionales cercanos
                </h2>
                <Link to="/buscar" className="text-xs text-muted-foreground hover:text-foreground">
                  Ver todos →
                </Link>
              </div>
              {nearbyPros.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  Aún no hay profesionales publicados en el mapa.
                </Card>
              ) : (
                <div className="grid gap-2">
                  {nearbyPros.map((p) => {
                    const km = kmTo(origin, p);
                    return (
                      <Card key={`np-${p.id}`} className="p-3 flex items-center gap-3">
                        <div className="relative shrink-0">
                          {p.avatarUrl ? (
                            <img
                              src={p.avatarUrl}
                              alt=""
                              className="h-10 w-10 rounded-full object-cover border border-border"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                              {p.name.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span
                            title={STATUS_LABEL[p.status]}
                            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background ${
                              p.status === "available"
                                ? p.live
                                  ? "bg-ok animate-pulse"
                                  : "bg-ok"
                                : p.status === "busy"
                                  ? "bg-warn"
                                  : "bg-muted-foreground/40"
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {STATUS_LABEL[p.status]}
                            {p.live ? " · en vivo" : ""} · {p.specialty ?? "Salud"} ·{" "}
                            {p.city ?? "—"}
                            {p.rating != null && (
                              <>
                                {" "}
                                · <Star className="h-2.5 w-2.5 inline fill-copper text-copper" />{" "}
                                {p.rating.toFixed(1)}
                              </>
                            )}
                            {p.trust.score != null && <> · Confianza {trustBadgeText(p.trust)}</>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {km != null ? (
                            <span className="text-xs font-semibold text-biosensor">
                              ~{formatKm(km)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="block mt-1 text-xs h-7"
                            asChild
                          >
                            <Link to="/profesional/$proId" params={{ proId: p.id }}>
                              Ver
                            </Link>
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
              {nearby.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-3">
                  {nearby.length} solicitud{nearby.length !== 1 ? "es" : ""} activa
                  {nearby.length !== 1 ? "s" : ""} en {familyCity} —{" "}
                  <Link to="/buscar" className="underline hover:text-foreground">
                    ver mercado
                  </Link>
                </p>
              )}
            </section>

            {/* Mis solicitudes */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold">Mis solicitudes</h2>
                <Link to="/buscar" className="text-xs text-muted-foreground hover:text-foreground">
                  Ver todas →
                </Link>
              </div>
              {offers.length === 0 ? (
                <Card className="p-10 text-center">
                  <Heart className="h-8 w-8 text-copper mx-auto mb-3" />
                  <p className="font-semibold">Sin solicitudes aún</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Publicar es <span className="font-semibold text-emerald-600">gratis</span>.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    <HiringCopilot />
                    <Button variant="outline" asChild>
                      <Link to="/buscar">Buscar ahora</Link>
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="grid gap-3">
                  {Array.from(new Map(offers.map((o) => [o.id, o])).values()).map((o) => (
                    <Card
                      key={`my-offer-${o.id}`}
                      className="p-4 flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div>
                        <p className="font-medium">{o.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.city} · {o.modality} · ${o.amount.toLocaleString("es-CO")} COP
                        </p>
                      </div>
                      <StatusPill status={o.status} />
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Mapa de solicitudes */}
            {offers.some((o) => o.lat != null && o.lng != null) && (
              <section>
                <h2 className="font-display text-base font-semibold mb-3">
                  Solicitudes en el mapa
                </h2>
                <OffersMap
                  points={offers
                    .filter((o) => o.lat != null && o.lng != null)
                    .map<MapPoint>((o) => ({
                      id: o.id,
                      lat: o.lat as number,
                      lng: o.lng as number,
                      title: o.title,
                      subtitle: `${o.city} · ${o.status === "open" ? "Disponible" : o.status === "filled" ? "Tomado" : "Cerrada"}`,
                      status: o.status === "filled" ? "reserved" : "available",
                    }))}
                  height={360}
                />
              </section>
            )}

            {/* Zona de peligro */}
            {user?.id && <DangerZoneCard userId={user.id} role="family" />}
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-biosensor/10 text-biosensor border-biosensor/30",
    pending: "bg-copper/10 text-copper border-copper/30",
    accepted: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/30",
    rejected: "bg-destructive/10 text-destructive border-destructive/30",
    filled: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/30",
    closed: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${
        map[status] ?? "bg-muted text-muted-foreground border-border"
      }`}
    >
      {status}
    </span>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  tone: "bio" | "copper" | "fuchsia";
}) {
  const colors = {
    bio: "text-biosensor bg-biosensor/10",
    copper: "text-copper bg-copper/10",
    fuchsia: "text-fuchsia-neural bg-fuchsia-neural/10",
  }[tone];
  return (
    <Card className="p-4">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-2xl font-bold font-display">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </Card>
  );
}

// Parte del turno en vivo del servicio que está ocurriendo ahora (propio o de un familiar del círculo de cuidado).
function ActiveCareFeedSection({ clientId }: { clientId: string }) {
  const active = useActiveServices(clientId);
  const live = (active.data ?? []).find(
    (s) => s.status === "in_progress" && (s.side === "client" || s.side === "circle"),
  );
  if (!live) return null;

  return (
    <section className="space-y-3" aria-label="Parte del turno en vivo">
      <h2 className="font-display text-lg font-semibold">
        Parte del turno en vivo
        {live.side === "circle" && live.owner_name ? ` · ${live.owner_name}` : ""}
      </h2>
      <CareFeed bookingId={live.booking_id} status="in_progress" />
    </section>
  );
}
