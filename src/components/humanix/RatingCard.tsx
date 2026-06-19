// Calificación bidireccional: familia/institución ↔ profesional.
// Estrellas interactivas, subcategorías, distribución tipo Amazon,
// respuesta del calificado y opción anónima.
import { useState } from "react";
import {
  Star,
  MessageSquare,
  Send,
  Loader2,
  ShieldCheck,
  ChevronDown,
  ThumbsUp,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

// ── Tipos ────────────────────────────────────────────────────────────────────

export type RatingRow = {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  booking_id: string | null;
  stars: number;
  comment: string | null;
  is_anonymous: boolean;
  punctuality_stars: number | null;
  communication_stars: number | null;
  professionalism_stars: number | null;
  response_text: string | null;
  response_at: string | null;
  status: "published" | "flagged" | "removed";
  created_at: string;
  // joins opcionales
  reviewer_name?: string;
  reviewer_avatar?: string;
  reviewer_role?: string;
};

export type RatingSummary = {
  total_reviews: number;
  avg_stars: number;
  avg_punctuality: number | null;
  avg_communication: number | null;
  avg_professionalism: number | null;
  five_star_count: number;
  four_star_count: number;
  three_star_count: number;
  two_star_count: number;
  one_star_count: number;
};

// ── StarPicker ────────────────────────────────────────────────────────────────

function StarPicker({
  value,
  onChange,
  size = "md",
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const sz = size === "lg" ? "h-8 w-8" : size === "sm" ? "h-4 w-4" : "h-6 w-6";
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <div className="flex gap-0.5" role="group" aria-label={label ?? "Calificación"}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrella${n !== 1 ? "s" : ""}`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-transform active:scale-90"
          >
            <Star
              className={`${sz} transition-colors ${
                n <= (hover || value)
                  ? "fill-copper text-copper"
                  : "fill-transparent text-muted-foreground/40"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── StarDisplay ───────────────────────────────────────────────────────────────

export function StarDisplay({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const sz = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <div className="flex gap-0.5" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${sz} ${
            n <= value ? "fill-copper text-copper" : "fill-transparent text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

// ── DistributionBar ───────────────────────────────────────────────────────────

function DistributionBar({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-right text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-copper transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ── RatingSummaryCard ─────────────────────────────────────────────────────────

export function RatingSummaryCard({ summary }: { summary: RatingSummary }) {
  const total = summary.total_reviews;
  return (
    <div className="flex flex-col sm:flex-row gap-6 p-5 rounded-2xl border border-border bg-card">
      {/* Número grande */}
      <div className="flex flex-col items-center justify-center min-w-[100px]">
        <span className="font-display text-5xl font-bold text-foreground">
          {summary.avg_stars.toFixed(1)}
        </span>
        <StarDisplay value={Math.round(summary.avg_stars)} size="md" />
        <span className="text-xs text-muted-foreground mt-1">
          {total} reseña{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Distribución */}
      <div className="flex-1 flex flex-col justify-center gap-1.5">
        <DistributionBar label="5 ★" count={summary.five_star_count} total={total} />
        <DistributionBar label="4 ★" count={summary.four_star_count} total={total} />
        <DistributionBar label="3 ★" count={summary.three_star_count} total={total} />
        <DistributionBar label="2 ★" count={summary.two_star_count} total={total} />
        <DistributionBar label="1 ★" count={summary.one_star_count} total={total} />
      </div>

      {/* Sub-categorías */}
      {(summary.avg_punctuality || summary.avg_communication || summary.avg_professionalism) && (
        <div className="flex flex-col justify-center gap-3 min-w-[140px]">
          {summary.avg_punctuality && (
            <div className="flex items-center justify-between text-xs gap-3">
              <span className="text-muted-foreground">Puntualidad</span>
              <StarDisplay value={Math.round(summary.avg_punctuality)} />
            </div>
          )}
          {summary.avg_communication && (
            <div className="flex items-center justify-between text-xs gap-3">
              <span className="text-muted-foreground">Comunicación</span>
              <StarDisplay value={Math.round(summary.avg_communication)} />
            </div>
          )}
          {summary.avg_professionalism && (
            <div className="flex items-center justify-between text-xs gap-3">
              <span className="text-muted-foreground">Profesionalismo</span>
              <StarDisplay value={Math.round(summary.avg_professionalism)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RatingItem ────────────────────────────────────────────────────────────────

function RatingItem({
  rating,
  currentUserId,
  onRespond,
}: {
  rating: RatingRow;
  currentUserId?: string;
  onRespond?: (id: string, text: string) => void;
}) {
  const [responseOpen, setResponseOpen] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canRespond =
    currentUserId === rating.reviewed_id && !rating.response_text && onRespond;

  const handleRespond = async () => {
    if (!responseText.trim() || !onRespond) return;
    setSubmitting(true);
    try {
      await onRespond(rating.id, responseText.trim());
      setResponseOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const date = new Date(rating.created_at).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="border-b border-border/50 pb-5 last:border-0 last:pb-0">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {rating.reviewer_avatar ? (
            <img
              src={rating.reviewer_avatar}
              alt={rating.is_anonymous ? "Usuario verificado" : (rating.reviewer_name ?? "U")}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">
              {rating.is_anonymous
                ? "U"
                : (rating.reviewer_name?.[0] ?? "U").toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">
              {rating.is_anonymous ? "Usuario verificado" : (rating.reviewer_name ?? "Usuario")}
            </span>
            {rating.is_anonymous && (
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Anónimo
              </Badge>
            )}
            {rating.reviewer_role && !rating.is_anonymous && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                {rating.reviewer_role === "family"
                  ? "Familia"
                  : rating.reviewer_role === "institution"
                  ? "Institución"
                  : "Profesional"}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{date}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-1">
            <StarDisplay value={rating.stars} />
            {rating.punctuality_stars && (
              <span className="text-xs text-muted-foreground">
                Puntualidad {rating.punctuality_stars}★
              </span>
            )}
            {rating.communication_stars && (
              <span className="text-xs text-muted-foreground">
                Comunicación {rating.communication_stars}★
              </span>
            )}
            {rating.professionalism_stars && (
              <span className="text-xs text-muted-foreground">
                Profesionalismo {rating.professionalism_stars}★
              </span>
            )}
          </div>

          {rating.comment && (
            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{rating.comment}</p>
          )}

          {/* Respuesta del calificado */}
          {rating.response_text && (
            <div className="mt-3 ml-3 pl-3 border-l-2 border-biosensor/40">
              <p className="text-xs font-semibold text-biosensor">Respuesta del profesional</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {rating.response_text}
              </p>
              {rating.response_at && (
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {new Date(rating.response_at).toLocaleDateString("es-CO")}
                </p>
              )}
            </div>
          )}

          {/* CTA responder */}
          {canRespond && !responseOpen && (
            <button
              type="button"
              onClick={() => setResponseOpen(true)}
              className="mt-2 flex items-center gap-1 text-xs text-biosensor hover:underline"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Responder
            </button>
          )}

          {responseOpen && (
            <div className="mt-3 space-y-2">
              <Textarea
                value={responseText}
                onChange={(e) => setResponseText(e.target.value.slice(0, 300))}
                placeholder="Tu respuesta (máx. 300 caracteres)..."
                rows={3}
                className="text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{responseText.length}/300</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setResponseOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleRespond}
                    disabled={!responseText.trim() || submitting}
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Publicar respuesta
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RatingComposer ────────────────────────────────────────────────────────────

type ComposerProps = {
  reviewerId: string;
  reviewedId: string;
  bookingId?: string;
  reviewedName: string;
  onSuccess?: () => void;
};

export function RatingComposer({
  reviewerId,
  reviewedId,
  bookingId,
  reviewedName,
  onSuccess,
}: ComposerProps) {
  const [stars, setStars] = useState(0);
  const [punctuality, setPunctuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [professionalism, setProfessionalism] = useState(0);
  const [comment, setComment] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = stars > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { error } = await (sb as SupabaseClient)
        .from("ratings")
        .insert({
          reviewer_id: reviewerId,
          reviewed_id: reviewedId,
          booking_id: bookingId ?? null,
          stars,
          comment: comment.trim() || null,
          is_anonymous: anonymous,
          punctuality_stars: punctuality || null,
          communication_stars: communication || null,
          professionalism_stars: professionalism || null,
        });

      if (error) throw error;
      toast.success("¡Gracias por tu calificación!", {
        description: "Tu reseña ya es visible en el perfil.",
      });
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo enviar la calificación",
      );
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="rounded-2xl border border-copper/30 bg-copper/5 p-5 space-y-3">
        <p className="font-semibold text-sm">
          ¿Confirmas tu calificación de <span className="text-copper">{stars} ★</span> para{" "}
          <span className="font-bold">{reviewedName}</span>?
        </p>
        <p className="text-xs text-muted-foreground">
          No podrás editar tu reseña después de publicarla.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={submitting}
          >
            Revisar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Publicar reseña
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-display text-base font-semibold">
        Califica a <span className="text-biosensor">{reviewedName}</span>
      </h3>

      {/* Estrellas principales */}
      <StarPicker value={stars} onChange={setStars} size="lg" label="Calificación general *" />

      {/* Categorías opcionales */}
      <button
        type="button"
        onClick={() => setShowCategories((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-biosensor hover:underline"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showCategories ? "rotate-180" : ""}`}
        />
        {showCategories ? "Ocultar" : "Agregar"} categorías específicas (opcional)
      </button>

      {showCategories && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
          <StarPicker value={punctuality} onChange={setPunctuality} size="sm" label="Puntualidad" />
          <StarPicker
            value={communication}
            onChange={setCommunication}
            size="sm"
            label="Comunicación"
          />
          <StarPicker
            value={professionalism}
            onChange={setProfessionalism}
            size="sm"
            label="Profesionalismo"
          />
        </div>
      )}

      {/* Comentario */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Comentario (opcional · máx. 300 caracteres)
        </label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 300))}
          placeholder="Cuéntanos tu experiencia..."
          rows={3}
          className="text-sm resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">{comment.length}/300</p>
      </div>

      {/* Opciones */}
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="rounded border-border accent-biosensor"
        />
        <span>
          Publicar de forma anónima{" "}
          <span className="text-muted-foreground text-xs">(apareces como "Usuario verificado")</span>
        </span>
      </label>

      <Button
        className="w-full"
        disabled={!canSubmit || submitting}
        onClick={() => setConfirming(true)}
      >
        <Send className="h-4 w-4 mr-2" />
        Enviar calificación
      </Button>
    </div>
  );
}

// ── RatingList ────────────────────────────────────────────────────────────────

export function RatingList({
  ratings,
  currentUserId,
  onRespond,
  onFlag,
}: {
  ratings: RatingRow[];
  currentUserId?: string;
  onRespond?: (id: string, text: string) => void;
  onFlag?: (id: string) => void;
}) {
  if (ratings.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        <ThumbsUp className="mx-auto h-8 w-8 mb-2 opacity-30" />
        Aún no hay calificaciones.
      </div>
    );
  }

  const handleRespond = async (id: string, text: string) => {
    try {
      const { error } = await (sb as SupabaseClient).rpc("respond_to_rating", {
        p_rating_id: id,
        p_response: text,
      });
      if (error) throw error;
      toast.success("Respuesta publicada.");
      onRespond?.(id, text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al publicar respuesta");
    }
  };

  const handleFlag = async (id: string) => {
    try {
      const { error } = await (sb as SupabaseClient).rpc("flag_rating", {
        p_rating_id: id,
        p_reason: "Reportado por el usuario",
      });
      if (error) throw error;
      toast.success("Reseña reportada para revisión.");
      onFlag?.(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al reportar");
    }
  };

  return (
    <div className="space-y-5">
      {ratings.map((r) => (
        <div key={r.id} className="relative group">
          <RatingItem rating={r} currentUserId={currentUserId} onRespond={handleRespond} />
          {/* Reportar (visible al hover) */}
          {currentUserId && currentUserId !== r.reviewer_id && (
            <button
              type="button"
              onClick={() => handleFlag(r.id)}
              className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              aria-label="Reportar reseña"
              title="Reportar reseña"
            >
              <Flag className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
