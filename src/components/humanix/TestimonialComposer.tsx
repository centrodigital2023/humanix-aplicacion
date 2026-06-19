import { useEffect, useState } from "react";
import { MessageSquarePlus, Loader2, ShieldCheck, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAppUser, type AppRole } from "@/hooks/use-app-user";
import { usePlan } from "@/hooks/use-plan";

const sb = supabase as unknown as SupabaseClient;

const ELIGIBLE: AppRole[] = ["professional", "family", "institution"];

function pickAuthorRole(roles: AppRole[]): "professional" | "family" | "institution" | null {
  if (roles.includes("institution")) return "institution";
  if (roles.includes("family")) return "family";
  if (roles.includes("professional")) return "professional";
  return null;
}

export function TestimonialComposer() {
  const { user } = useAppUser({ requireAuth: false });
  const plan = usePlan(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [city, setCity] = useState("");
  const [rating, setRating] = useState(5);
  const [trustScore, setTrustScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const authorRole = user ? pickAuthorRole(user.roles) : null;
  const eligibleRole = !!authorRole && ELIGIBLE.includes(authorRole);
  const isPaying = plan.has("pro_monthly");
  const canCompose = !!user && eligibleRole && isPaying;

  useEffect(() => {
    if (!user || authorRole !== "professional") return;
    void sb
      .from("professional_profiles")
      .select("trust_score, home_city")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTrustScore((data as { trust_score?: number }).trust_score ?? 0);
          if (!city) setCity((data as { home_city?: string }).home_city ?? "");
        }
      });
  }, [user, authorRole, city]);

  if (!user) return null;
  if (!eligibleRole) return null;

  const submit = async () => {
    if (!user || !authorRole) return;
    if (content.trim().length < 20) {
      toast.error("Mínimo 20 caracteres");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await sb.from("community_testimonials").insert({
        user_id: user.id,
        author_name: user.fullName || "Comunidad Humanix",
        author_role: authorRole,
        author_city: city || null,
        author_avatar_url: user.avatarUrl,
        content: content.trim(),
        rating,
        trust_score_snapshot: trustScore,
        plan_snapshot: plan.plan,
      });
      if (error) throw error;
      toast.success(
        trustScore >= 70
          ? "¡Publicado! Tu testimonio ya está en la web."
          : "Recibido. Un moderador lo revisará pronto.",
      );
      setContent("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={!canCompose}
          title={!isPaying ? "Disponible para planes de pago" : undefined}
        >
          <MessageSquarePlus className="h-4 w-4" />
          Comparte tu historia
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Comparte tu experiencia con Humanix</DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            {trustScore >= 70 ? (
              <>
                <ShieldCheck className="h-3 w-3 text-biosensor" />
                Tu Trust Score ({trustScore}) te permite publicar al instante.
              </>
            ) : (
              <>
                <Clock className="h-3 w-3 text-amber-500" />
                Tu mensaje pasará por moderación rápida (24h máx).
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Ciudad"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-9"
              maxLength={60}
            />
            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} ★
                </option>
              ))}
            </select>
          </div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Cuenta en pocas líneas cómo Humanix te ayudó…"
            rows={5}
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground text-right">
            {content.length}/500 · mínimo 20
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || content.trim().length < 20}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
