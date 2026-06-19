import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Share2, Gift, Users, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type ReferralStats = {
  pending: number;
  registered: number;
  rewarded: number;
  months_earned: number;
};

type Props = {
  userId: string;
};

export function ReferralCard({ userId }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [stats, setStats] = useState<ReferralStats>({ pending: 0, registered: 0, rewarded: 0, months_earned: 0 });
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const referralLink = code ? `https://humanix.lat/auth?ref=${code}` : "";
  const waText = encodeURIComponent(
    `¡Únete a Humanix y encuentra turnos de salud al instante! Regístrate con mi enlace y empieza gratis: ${referralLink}`,
  );

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Obtener o crear código de referido
      const { data: codeData, error: codeErr } = await sb.rpc("get_or_create_referral_code", {
        p_user_id: userId,
      });
      if (codeErr) throw codeErr;
      setCode(codeData as string);

      // Estadísticas del referidor
      const { data: rows } = await sb
        .from("referrals")
        .select("status")
        .eq("referrer_id", userId);

      if (rows) {
        const rewarded = rows.filter((r: { status: string }) => r.status === "rewarded").length;
        setStats({
          pending: rows.filter((r: { status: string }) => r.status === "pending").length,
          registered: rows.filter((r: { status: string }) => r.status === "registered").length,
          rewarded,
          months_earned: rewarded,
        });
      }
    } catch (err) {
      // Silencio — la tarjeta simplemente no muestra código si falla
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Enlace copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return null;

  return (
    <Card className="p-5 sm:p-6 border-biosensor/20 bg-gradient-to-br from-biosensor/5 to-card">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-biosensor/15">
          <Gift className="h-5 w-5 text-biosensor" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Invita colegas · Gana meses gratis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Por cada colega que se suscriba con tu enlace, ganas <strong>1 mes del Plan Esencial gratis</strong>.
          </p>
        </div>
      </div>

      {/* Referral link */}
      {code && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-mono text-foreground/70 truncate">
            humanix.lat/auth?ref={code}
          </div>
          <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0">
            {copied ? (
              <Check className="h-4 w-4 text-biosensor" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}

      {/* WhatsApp CTA */}
      {code && (
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1ebe5d] mb-4"
        >
          <Share2 className="h-4 w-4" />
          Compartir por WhatsApp
        </a>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/40">
        <div className="text-center">
          <Users className="h-4 w-4 text-muted-foreground mx-auto mb-0.5" />
          <p className="text-xl font-bold font-display">{stats.pending + stats.registered}</p>
          <p className="text-[10px] text-muted-foreground">Invitados</p>
        </div>
        <div className="text-center">
          <Check className="h-4 w-4 text-biosensor mx-auto mb-0.5" />
          <p className="text-xl font-bold font-display text-biosensor">{stats.rewarded}</p>
          <p className="text-[10px] text-muted-foreground">Suscritos</p>
        </div>
        <div className="text-center">
          <CalendarDays className="h-4 w-4 text-copper mx-auto mb-0.5" />
          <p className="text-xl font-bold font-display text-copper">{stats.months_earned}</p>
          <p className="text-[10px] text-muted-foreground">Meses ganados</p>
        </div>
      </div>
    </Card>
  );
}
