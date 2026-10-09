// Invitación en el momento más cálido (después de dar las gracias): comparte tu enlace de referido por WhatsApp o
// cópialo. El código lo genera el servidor (`get_or_create_referral_code`); aquí no se paga ni se cobra nada.
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { inviteText } from "@/lib/careLoop";
import { ShareTextButtons } from "./ShareTextButtons";

const sb = supabase as unknown as SupabaseClient;

export function InviteFriendInline({
  userId,
  role,
}: {
  userId: string;
  role: "family" | "professional";
}) {
  const code = useQuery({
    queryKey: ["referral-code", userId],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("get_or_create_referral_code", { p_user_id: userId });
      if (error) throw error;
      return data as string;
    },
  });

  if (!code.data) return null;
  const link = `https://humanix.lat/auth?ref=${code.data}`;
  const text = inviteText(role, link);

  return (
    <div className="rounded-xl border border-dashed border-copper/40 bg-copper/5 p-3">
      <p className="text-sm font-semibold">
        {role === "family"
          ? "¿Conoces a otra familia que lo necesite?"
          : "¿Un colega querría esto también?"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Por cada persona que se suscriba con tu enlace ganas 1 mes del Plan Esencial gratis.
      </p>
      <ShareTextButtons
        text={text}
        whatsappLabel="Invitar por WhatsApp"
        className="mt-2 flex flex-wrap gap-2"
      />
    </div>
  );
}
