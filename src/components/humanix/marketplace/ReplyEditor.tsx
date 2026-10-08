import { useState } from "react";
import { Copy, Loader2, Mail, Sparkles } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { functionErrorMessage } from "./errors";
import type { TicketRow } from "./types";

const sb = supabase as unknown as SupabaseClient;

interface DraftMeta {
  next_steps: string[];
  missing_info: string[];
  escalate: boolean;
  flagged: boolean;
}

export function ReplyEditor({ ticket, onChanged }: { ticket: TicketRow; onChanged: () => void }) {
  const closed = ticket.status === "resolved" || ticket.status === "closed";
  const [text, setText] = useState(ticket.resolution ?? ticket.ai_reply_draft ?? "");
  const [baseline, setBaseline] = useState<string | null>(ticket.ai_reply_draft);
  const [meta, setMeta] = useState<DraftMeta | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const blocked = text.startsWith("[Borrador bloqueado");

  const generate = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("pqrs-assistant", {
      body: { ticket_id: ticket.id },
    });
    setGenerating(false);
    if (error || !data?.draft) {
      toast.error(await functionErrorMessage(error, "No se pudo generar el borrador"));
      return;
    }
    const d = data.draft as DraftMeta & { body: string };
    setText(d.body);
    setBaseline(d.flagged ? null : d.body);
    setMeta({
      next_steps: d.next_steps,
      missing_info: d.missing_info,
      escalate: d.escalate,
      flagged: d.flagged,
    });
    if (d.flagged)
      toast.warning(
        "La IA mencionó un medio de pago o un enlace externo. Redacta la respuesta manualmente.",
      );
    else toast.success("Borrador listo. Revísalo y edítalo antes de enviarlo.");
  };

  const resolve = async () => {
    const final = text.trim();
    if (final.length < 20) {
      toast.error("La respuesta debe tener al menos 20 caracteres.");
      return;
    }
    setSaving(true);
    const { error } = await sb
      .from("pqrs_tickets")
      .update({
        resolution: final,
        status: "resolved",
        reply_draft_edited: baseline ? final !== baseline.trim() : null,
      })
      .eq("id", ticket.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Respuesta guardada. El solicitante la verá al consultar su radicado.");
    onChanged();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Respuesta copiada");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const mailto = ticket.contact_email
    ? `mailto:${ticket.contact_email}?subject=${encodeURIComponent(`Respuesta a tu solicitud ${ticket.radicado ?? ""}`.trim())}&body=${encodeURIComponent(text)}`
    : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Respuesta al solicitante
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={generate}
          disabled={generating}
          className="gap-1.5"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-biosensor" aria-hidden="true" />
          )}
          {text ? "Regenerar borrador IA" : "Borrador con IA"}
        </Button>
      </div>

      {meta?.escalate && (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-700"
        >
          La IA recomienda atención humana prioritaria para este caso.
        </p>
      )}
      {meta && meta.missing_info.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <strong>Datos que faltan:</strong> {meta.missing_info.join(" · ")}
        </p>
      )}
      {meta && meta.next_steps.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <strong>Pasos propuestos:</strong> {meta.next_steps.join(" · ")}
        </p>
      )}

      <Textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        placeholder="Escribe la respuesta o genera un borrador con IA. Una persona siempre debe revisarla antes de enviarla."
        aria-label="Respuesta al solicitante"
      />
      <p className="text-[11px] text-muted-foreground">
        Los pagos se realizan únicamente en la página web de Humanix: no incluyas enlaces de pago,
        cuentas ni números de Nequi o Daviplata.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={resolve} disabled={saving || blocked || text.trim().length < 20}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {closed ? "Actualizar respuesta" : "Guardar y resolver"}
        </Button>
        <Button size="sm" variant="outline" onClick={copy} disabled={!text} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copiar
        </Button>
        {mailto && text && !blocked && (
          <Button size="sm" variant="outline" asChild>
            <a href={mailto} className="gap-1.5">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Enviar por correo
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
