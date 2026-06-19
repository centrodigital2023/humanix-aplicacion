import { useState } from "react";
import JSZip from "jszip";
import {
  Calendar,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Doc = {
  id: string;
  doc_type: string;
  file_name: string | null;
  file_url: string;
};

type Props = {
  proName: string;
  proEmail: string | null;
  proPhone: string | null;
  docs: Doc[];
  onAnalyzeAll?: () => void;
  analyzingAll?: boolean;
};

function extractPath(fileUrl: string): string | null {
  const marker = "/professional-docs/";
  const idx = fileUrl.indexOf(marker);
  if (idx >= 0) return fileUrl.slice(idx + marker.length);
  if (!fileUrl.includes("://")) return fileUrl;
  return null;
}

function defaultInterviewDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 0, 0, 0);
  // format yyyy-MM-ddTHH:mm for datetime-local
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/[^0-9]/g, "");
  if (!digits) return null;
  // Default to Colombia +57 if no country code and length is 10
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

export function InterviewActions({
  proName,
  proEmail,
  proPhone,
  docs,
  onAnalyzeAll,
  analyzingAll,
}: Props) {
  const [zipBusy, setZipBusy] = useState(false);
  const [when, setWhen] = useState<string>(defaultInterviewDate());
  const [location, setLocation] = useState<string>("Videollamada (te enviamos el enlace)");
  const [note, setNote] = useState<string>(
    "Hola, queremos invitarte a una breve entrevista para validar tu perfil en Humanix.",
  );

  const phone = normalizePhone(proPhone);

  const downloadAllZip = async () => {
    if (!docs.length) {
      toast.error("No hay documentos para descargar");
      return;
    }
    setZipBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`humanix-${proName.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
      if (!folder) throw new Error("No se pudo crear la carpeta");
      let ok = 0;
      for (const d of docs) {
        const path = extractPath(d.file_url);
        if (!path) continue;
        const { data: signed } = await supabase.storage
          .from("professional-docs")
          .createSignedUrl(path, 120);
        if (!signed?.signedUrl) continue;
        const res = await fetch(signed.signedUrl);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const safe = (d.file_name ?? `${d.doc_type}.bin`).replace(/[^a-zA-Z0-9._-]/g, "_");
        folder.file(`${d.doc_type}__${safe}`, buf);
        ok++;
      }
      if (!ok) throw new Error("No se pudo descargar ningún documento");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `humanix-docs-${proName.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Carpeta descargada (${ok} documentos)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al empaquetar");
    } finally {
      setZipBusy(false);
    }
  };

  const formattedWhen = () => {
    if (!when) return "";
    try {
      const d = new Date(when);
      return d.toLocaleString("es-CO", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return when;
    }
  };

  const inviteText = () =>
    `Hola ${proName}, ${note.trim()}\n\n📅 Fecha: ${formattedWhen()}\n📍 Lugar: ${location}\n\nConfirma tu asistencia respondiendo a este mensaje. — Equipo Humanix`;

  const sendWhatsApp = () => {
    if (!phone) {
      toast.error("Sin teléfono para WhatsApp");
      return;
    }
    const msg = encodeURIComponent(inviteText());
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
    toast.success("WhatsApp abierto");
  };

  const sendEmail = () => {
    if (!proEmail) {
      toast.error("Sin email del profesional");
      return;
    }
    const subject = encodeURIComponent("Entrevista Humanix — confirmación");
    const body = encodeURIComponent(inviteText());
    window.location.href = `mailto:${proEmail}?subject=${subject}&body=${body}`;
  };

  const callPro = () => {
    if (!phone) {
      toast.error("Sin teléfono para llamar");
      return;
    }
    window.location.href = `tel:+${phone}`;
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-fuchsia-neural" /> Programar entrevista &amp; contacto
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Envía la cita por WhatsApp o email, llama directamente o descarga toda la carpeta documental.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {onAnalyzeAll && (
            <Button
              size="sm"
              variant="hero"
              onClick={onAnalyzeAll}
              disabled={analyzingAll || !docs.length}
            >
              {analyzingAll ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Analizando…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Analizar todos
                </>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={downloadAllZip}
            disabled={zipBusy || !docs.length}
          >
            {zipBusy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Empaquetando…
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1" /> Descargar carpeta (.zip)
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Fecha y hora
          </label>
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Lugar / enlace
          </label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Videollamada, oficina, dirección…"
            className="h-9"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Mensaje
        </label>
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Mensaje personalizado para el profesional"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={sendWhatsApp}
          disabled={!phone}
          className="bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
        >
          <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
        </Button>
        <Button size="sm" variant="outline" onClick={sendEmail} disabled={!proEmail}>
          <Mail className="h-3.5 w-3.5 mr-1" /> Email
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={callPro}
          disabled={!phone}
          className="bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20 text-sky-700 dark:text-sky-400"
        >
          <Phone className="h-3.5 w-3.5 mr-1" /> Llamar
        </Button>
        <Button
          size="sm"
          variant="hero"
          onClick={() => {
            if (phone) sendWhatsApp();
            else if (proEmail) sendEmail();
            else toast.error("Sin contacto disponible");
          }}
          disabled={!phone && !proEmail}
        >
          <Send className="h-3.5 w-3.5 mr-1" /> Enviar cita
        </Button>
      </div>
    </Card>
  );
}
