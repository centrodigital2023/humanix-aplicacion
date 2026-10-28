// Alerta flotante en vivo, en cualquier página: al profesional le llega cada solicitud nueva (familia o EPS/IPS)
// con sonido y botón «Aceptar»; a la familia y a la EPS/IPS, cada cambio de su servicio (Aceptado, En camino…).
// Se monta una sola vez en la raíz. Sin sesión no se suscribe a nada.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BellRing, CheckCircle2, Loader2, Siren, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useRealtimeProfessionalFeed } from "@/hooks/use-realtime-professional-feed";
import { acceptPendingBooking } from "@/hooks/use-pending-bookings";
import {
  askSystemNotifications,
  canAskSystemNotifications,
  primeAlertSound,
} from "@/lib/alertSound";
import { friendlyError } from "@/lib/friendlyError";
import type { LiveAlert, LiveAlertTone } from "@/lib/serviceFlow";

/** Sesión y rol profesional, escuchando cambios de sesión (entrar, salir, cambiar de cuenta). */
function useSessionRole() {
  const [state, setState] = useState<{ userId: string | null; isProfessional: boolean }>({
    userId: null,
    isProfessional: false,
  });
  useEffect(() => {
    let active = true;
    const resolve = async (uid: string | null) => {
      if (!uid) {
        if (active) setState({ userId: null, isProfessional: false });
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "professional")
        .maybeSingle();
      if (active) setState({ userId: uid, isProfessional: Boolean(data) });
    };
    let current: string | null | undefined;
    const onUid = (uid: string | null) => {
      if (uid === current) return;
      current = uid;
      void resolve(uid);
    };
    void supabase.auth.getSession().then(({ data }) => onUid(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      onUid(session?.user.id ?? null),
    );
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}

const TONE: Record<LiveAlertTone, { card: string; icon: typeof BellRing; iconClass: string }> = {
  request: {
    card: "border-copper/50 shadow-copper/20",
    icon: BellRing,
    iconClass: "bg-copper/15 text-copper",
  },
  good: {
    card: "border-biosensor/50 shadow-biosensor/20",
    icon: CheckCircle2,
    iconClass: "bg-biosensor/15 text-biosensor",
  },
  info: { card: "border-border", icon: Sparkles, iconClass: "bg-biosensor/10 text-biosensor" },
  alert: { card: "border-sos/60 shadow-sos/20", icon: Siren, iconClass: "bg-sos/15 text-sos" },
};

export function LiveServiceAlerts() {
  const { userId, isProfessional } = useSessionRole();
  const { alerts, dismiss, remove } = useRealtimeProfessionalFeed(userId, isProfessional);

  useEffect(() => primeAlertSound(), []);

  if (!userId || alerts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4"
      aria-live="assertive"
      aria-label="Alertas en vivo"
    >
      {alerts.map((a) => (
        <AlertCard
          key={a.key}
          alert={a}
          onDismiss={() => dismiss(a.key)}
          onDone={() => remove(a.key)}
        />
      ))}
    </div>
  );
}

function AlertCard({
  alert,
  onDismiss,
  onDone,
}: {
  alert: LiveAlert;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [accepting, setAccepting] = useState(false);
  const [askPush, setAskPush] = useState(false);
  // En la página del mismo servicio el cambio ya se ve en pantalla: la alerta no se queda fija.
  const sticky = alert.sticky && pathname !== alert.link;
  const tone = TONE[alert.tone];
  const Icon = tone.icon;

  useEffect(() => {
    setAskPush(alert.tone === "request" && canAskSystemNotifications());
  }, [alert.tone]);

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (sticky) return;
    const t = window.setTimeout(() => doneRef.current(), 9000);
    return () => window.clearTimeout(t);
  }, [sticky]);

  const accept = async () => {
    if (!alert.bookingId) return;
    setAccepting(true);
    let ok = false;
    try {
      ok = await acceptPendingBooking(alert.bookingId);
    } catch (error) {
      setAccepting(false);
      toast.error(friendlyError(error));
      return;
    }
    setAccepting(false);
    onDismiss();
    if (!ok) {
      toast.info("Esta solicitud ya no está disponible.");
      return;
    }
    toast.success("¡Aceptaste el servicio! Ya puedes escribir y llamar.");
    void navigate({ to: "/servicio/$bookingId", params: { bookingId: alert.bookingId } });
  };

  return (
    <div
      role="alert"
      className={`pointer-events-auto w-full max-w-md rounded-2xl border-2 bg-card p-4 text-card-foreground shadow-xl animate-in fade-in slide-in-from-top-4 ${tone.card}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.iconClass} ${
            alert.tone === "request" ? "animate-pulse" : ""
          }`}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-tight">{alert.title}</p>
          {alert.body && <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          aria-label="Cerrar alerta"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {alert.bookingId && (
          <Button size="sm" onClick={() => void accept()} disabled={accepting}>
            {accepting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
            Aceptar
          </Button>
        )}
        {alert.link && pathname !== alert.link && (
          <Button size="sm" variant={alert.bookingId ? "outline" : "default"} asChild>
            <Link to={alert.link} onClick={onDismiss}>
              {alert.bookingId ? "Ver detalle" : "Abrir"}
            </Link>
          </Button>
        )}
        {askPush && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void askSystemNotifications().then(() => setAskPush(false));
            }}
          >
            Avisarme también en segundo plano
          </Button>
        )}
      </div>
    </div>
  );
}
