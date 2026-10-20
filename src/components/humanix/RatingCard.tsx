// Reseñas de `service_ratings`: resumen tipo Amazon, lista con la respuesta del calificado
// (`respond_to_rating`) y el reporte para moderación (`flag_rating`). La calificación se crea en `VoiceRating`.
import { useState } from "react";
import { Star, MessageSquare, Loader2, ShieldCheck, ThumbsUp, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyError } from "@/lib/friendlyError";

const sb = supabase as unknown as SupabaseClient;

// ── Tipos ────────────────────────────────────────────────────────────────────

export type RatingRow = {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  booking_id: string | null;
  stars: number;
  comment: string | null;
  // Columnas de `service_ratings` (rater_id/rated_id se leen con alias). Las demás son opcionales: las dimensiones viven
  // en `service_rating_dimensions` y no hay reseñas anónimas.
  is_anonymous?: boolean;
  punctuality_stars?: number | null;
  communication_stars?: number | null;
  professionalism_stars?: number | null;
  response_text: string | null;
  response_at: string | null;
  status: "published" | "flagged";
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

function DistributionBar({ label, count, total }: { label: string; count: number; total: number }) {
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

  const canRespond = currentUserId === rating.reviewed_id && !rating.response_text && onRespond;

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
              {rating.is_anonymous ? "U" : (rating.reviewer_name?.[0] ?? "U").toUpperCase()}
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
                  <Button variant="ghost" size="sm" onClick={() => setResponseOpen(false)}>
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
      toast.error(friendlyError(err, "Error al publicar respuesta"));
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
      toast.error(friendlyError(err, "Error al reportar"));
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
