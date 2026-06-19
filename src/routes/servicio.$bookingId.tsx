// Página de seguimiento activo de un servicio contratado.
// Mapa + ETA + emergencia + chat + valoración por voz al finalizar.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  CircleDollarSign,
  CalendarClock,
  ArrowLeft,
  PlayCircle,
  Flag,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/humanix/Navbar";
import { LiveTracking } from "@/components/humanix/LiveTracking";
import { BookingChat } from "@/components/humanix/BookingChat";
import { PaidContactCard } from "@/components/humanix/PaidContactCard";
import { VoiceRating } from "@/components/humanix/VoiceRating";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { toast } from "sonner";

const PAID_STATUSES = new Set(["confirmed", "in_route", "in_progress", "completed"]);

export const Route = createFileRoute("/servicio/$bookingId")({
  head: () => ({
    meta: [
      { title: "Servicio en curso · Humanix" },
      {
        name: "description",
        content:
          "Sigue en vivo a tu profesional de salud, conversa por chat y valora el servicio cuando termine.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ServicePage,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p>Servicio no encontrado.</p>
        <Link to="/" className="text-biosensor hover:underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <p>Error: {error.message}</p>
    </div>
  ),
});

type Booking = {
  id: string;
  client_id: string;
  professional_id: string;
  status: string;
  scheduled_at: string;
  duration_hours: number;
  hourly_rate: number;
  total_amount: number;
  service_address: string | null;
  service_lat: number | null;
  service_lng: number | null;
  notes: string | null;
  emergency_phone: string | null;
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente de confirmación", color: "bg-muted text-foreground" },
  confirmed: { label: "Confirmado", color: "bg-biosensor/15 text-biosensor" },
  in_route: { label: "En ruta", color: "bg-copper/15 text-copper" },
  in_progress: { label: "En servicio", color: "bg-biosensor/15 text-biosensor" },
  completed: { label: "Completado", color: "bg-foreground/10 text-foreground" },
  cancelled: { label: "Cancelado", color: "bg-fuchsia-neural/15 text-fuchsia-neural" },
};

function ServicePage() {
  const { bookingId } = Route.useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hasRating, setHasRating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      const uid = sess.session.user.id;
      if (cancelled) return;
      setUserId(uid);

      const { data, error } = await supabase
        .from("service_bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("No encontramos ese servicio.");
        navigate({ to: "/" });
        return;
      }
      setBooking(data as Booking);

      // Cargar nombre del peer
      const peerId = uid === data.client_id ? data.professional_id : data.client_id;
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", peerId)
        .maybeSingle();
      if (!cancelled) setPeerName(prof?.full_name ?? "Tu contraparte");

      // Conversación: buscar la primera relacionada al profesional+cliente
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("poster_id", data.client_id)
        .eq("professional_id", data.professional_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setConversationId(conv?.id ?? null);

      // Saber si ya valoró
      const { data: rating } = await supabase
        .from("service_ratings")
        .select("id")
        .eq("booking_id", bookingId)
        .eq("rater_id", uid)
        .maybeSingle();
      if (!cancelled) setHasRating(!!rating);

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, navigate]);

  // Realtime al booking
  useEffect(() => {
    if (!bookingId) return;
    const ch = supabase
      .channel(`booking:${bookingId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "service_bookings",
          filter: `id=eq.${bookingId}`,
        },
        (p) => setBooking(p.new as Booking),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [bookingId]);

  const updateStatus = async (
    patch: Partial<
      Pick<Booking, "status" | "started_at" | "arrived_at" | "completed_at" | "cancelled_at">
    > & {
      cancel_reason?: string | null;
    },
  ) => {
    const { error } = await supabase.from("service_bookings").update(patch).eq("id", bookingId);
    if (error) toast.error(error.message);
  };

  if (loading || !booking || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando servicio…
      </div>
    );
  }

  const isProfessional = userId === booking.professional_id;
  const isClient = userId === booking.client_id;
  const status = STATUS_LABEL[booking.status] ?? STATUS_LABEL.pending;
  const completed = booking.status === "completed";
  const cancelled = booking.status === "cancelled";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="pt-24 pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al panel
          </Link>

          <header className="mt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.color}`}
              >
                {status.label}
              </span>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold">
                Servicio con {peerName}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                {new Date(booking.scheduled_at).toLocaleString("es-CO", {
                  dateStyle: "full",
                  timeStyle: "short",
                })}{" "}
                · {booking.duration_hours} h
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Total acordado
              </p>
              <p className="font-display text-3xl font-bold text-biosensor inline-flex items-center gap-1">
                <CircleDollarSign className="h-6 w-6" />
                {COP(booking.total_amount)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Retención según tipo de contratante (Ley 1819/2016)
              </p>
            </div>
          </header>

          {!cancelled && !completed && (
            <div className="mt-6 grid lg:grid-cols-[1fr_360px] gap-4">
              <div className="space-y-4">
                <LiveTracking booking={booking} isProfessional={isProfessional} />

                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Acciones del servicio
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isProfessional && booking.status === "pending" && (
                      <ActionButton
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        label="Aceptar servicio"
                        onClick={() => updateStatus({ status: "confirmed" })}
                        tone="bio"
                      />
                    )}
                    {isProfessional && booking.status === "confirmed" && (
                      <ActionButton
                        icon={<PlayCircle className="h-4 w-4" />}
                        label="Iniciar trayecto"
                        onClick={() =>
                          updateStatus({ status: "in_route", started_at: new Date().toISOString() })
                        }
                        tone="copper"
                      />
                    )}
                    {isProfessional && booking.status === "in_route" && (
                      <ActionButton
                        icon={<Flag className="h-4 w-4" />}
                        label="Llegué al sitio"
                        onClick={() =>
                          updateStatus({
                            status: "in_progress",
                            arrived_at: new Date().toISOString(),
                          })
                        }
                        tone="bio"
                      />
                    )}
                    {(isProfessional || isClient) && booking.status === "in_progress" && (
                      <ActionButton
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        label="Finalizar servicio"
                        onClick={() =>
                          updateStatus({
                            status: "completed",
                            completed_at: new Date().toISOString(),
                          })
                        }
                        tone="bio"
                      />
                    )}
                    {!completed && !cancelled && (
                      <ActionButton
                        icon={<XCircle className="h-4 w-4" />}
                        label="Cancelar"
                        onClick={() => {
                          const reason = window.prompt("Motivo de la cancelación:");
                          if (!reason) return;
                          updateStatus({
                            status: "cancelled",
                            cancelled_at: new Date().toISOString(),
                            cancel_reason: reason,
                          });
                        }}
                        tone="fuchsia"
                      />
                    )}
                  </div>
                  {booking.service_address && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      <strong className="text-foreground">Dirección:</strong>{" "}
                      {booking.service_address}
                    </p>
                  )}
                  {booking.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <strong className="text-foreground">Notas:</strong> {booking.notes}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <PaidContactCard
                  bookingId={booking.id}
                  peerName={peerName}
                  isPaid={PAID_STATUSES.has(booking.status)}
                  amountCOP={booking.total_amount}
                />
                <BookingChat
                  conversationId={conversationId}
                  currentUserId={userId}
                  peerName={peerName}
                />
              </div>
            </div>
          )}

          {completed && (
            <section className="mt-8">
              {hasRating ? (
                <div className="rounded-2xl border border-biosensor/30 bg-biosensor/5 p-8 text-center">
                  <CheckCircle2 className="h-10 w-10 text-biosensor mx-auto" />
                  <h2 className="mt-3 font-display text-xl font-bold">Valoración registrada</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Gracias por contribuir a la calidad de Humanix.
                  </p>
                  <Link
                    to="/dashboard"
                    className="mt-5 inline-flex items-center gap-1.5 text-biosensor font-semibold text-sm"
                  >
                    Volver al panel →
                  </Link>
                </div>
              ) : isClient ? (
                <>
                  <h2 className="font-display text-2xl font-bold mb-4">Cuéntanos cómo te fue</h2>
                  <VoiceRating
                    bookingId={booking.id}
                    ratedUserId={booking.professional_id}
                    onSubmitted={() => setHasRating(true)}
                  />
                </>
              ) : (
                <>
                  <h2 className="font-display text-2xl font-bold mb-4">Tu impresión del cliente</h2>
                  <VoiceRating
                    bookingId={booking.id}
                    ratedUserId={booking.client_id}
                    onSubmitted={() => setHasRating(true)}
                  />
                </>
              )}
            </section>
          )}

          {cancelled && (
            <div className="mt-8 rounded-2xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-8 text-center">
              <XCircle className="h-10 w-10 text-fuchsia-neural mx-auto" />
              <h2 className="mt-3 font-display text-xl font-bold">Servicio cancelado</h2>
              <Link to="/buscar" className="mt-4 inline-flex text-biosensor font-semibold text-sm">
                Buscar otro profesional →
              </Link>
            </div>
          )}
        </div>
      </main>
      <HabeasDataConsent />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: "bio" | "copper" | "fuchsia";
}) {
  const cls = {
    bio: "bg-biosensor text-biosensor-foreground",
    copper: "bg-copper text-copper-foreground",
    fuchsia: "bg-fuchsia-neural text-fuchsia-neural-foreground",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${cls} hover:opacity-95 transition`}
    >
      {icon}
      {label}
    </button>
  );
}
