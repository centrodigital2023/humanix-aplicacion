// Valoración 5⭐ + grabación de voz analizada por IA (sentimiento → alerta superadmin).
import { useRef, useState } from "react";
import { Mic, Square, Star, Loader2, Send, ShieldAlert, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Analysis = {
  transcript: string;
  sentiment: "positive" | "neutral" | "negative";
  score: number;
  summary: string;
  alert: boolean;
};

export function VoiceRating({
  bookingId,
  ratedUserId,
  onSubmitted,
}: {
  bookingId: string;
  ratedUserId: string;
  onSubmitted?: () => void;
}) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("No pudimos acceder al micrófono");
    }
  };

  const stopRec = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const blobToBase64 = (b: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const s = String(r.result || "");
        resolve(s.split(",")[1] || "");
      };
      r.onerror = reject;
      r.readAsDataURL(b);
    });

  const analyze = async () => {
    if (!audioBlob) return;
    setAnalyzing(true);
    try {
      const audio_base64 = await blobToBase64(audioBlob);
      const { data, error } = await supabase.functions.invoke("analyze-rating-voice", {
        body: { audio_base64, mime_type: audioBlob.type },
      });
      if (error) throw error;
      setAnalysis(data as Analysis);
      if ((data as Analysis).alert) {
        toast.warning("Audio marcado para revisión del superadmin");
      } else {
        toast.success("Análisis listo");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo analizar el audio");
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) throw new Error("Sesión expirada");
      const userId = sess.session.user.id;

      let voice_url: string | null = null;
      if (audioBlob) {
        const path = `${userId}/${bookingId}-${Date.now()}.webm`;
        const { error: upErr } = await supabase.storage
          .from("rating-voice")
          .upload(path, audioBlob, { contentType: "audio/webm", upsert: false });
        if (upErr) throw upErr;
        // Bucket is private — store the object path; participants/staff fetch
        // a short-lived signed URL on demand via supabase.storage.createSignedUrl().
        voice_url = path;
      }

      const { error } = await supabase.from("service_ratings").insert({
        booking_id: bookingId,
        rater_id: userId,
        rated_id: ratedUserId,
        stars,
        comment: comment || null,
        voice_url,
        voice_transcript: analysis?.transcript ?? null,
        ai_sentiment: analysis?.sentiment ?? null,
        ai_sentiment_score: analysis?.score ?? null,
        ai_alert: analysis?.alert ?? false,
        ai_summary: analysis?.summary ?? null,
      });
      if (error) throw error;

      // Si hay alerta, registrar fraud_flag para superadmin
      if (analysis?.alert) {
        await supabase.from("fraud_flags").insert({
          user_id: ratedUserId,
          severity: "high",
          reason: `Valoración negativa con voz: ${analysis.summary}`,
          meta: { booking_id: bookingId, transcript: analysis.transcript },
        });
      }

      toast.success("¡Gracias por tu valoración!");
      onSubmitted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar la valoración");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold">¿Cómo fue tu experiencia?</p>
        <div className="mt-2 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
              className="p-1"
            >
              <Star
                className={`h-7 w-7 transition ${
                  n <= stars ? "fill-copper text-copper" : "text-muted-foreground/30"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Cuéntanos brevemente (opcional)…"
        rows={2}
        maxLength={500}
        className="w-full rounded-xl bg-background border border-input p-3 text-sm outline-none focus:border-foreground/40"
      />

      <div className="rounded-xl border border-dashed border-biosensor/40 bg-biosensor/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Mic className="h-4 w-4 text-biosensor" />
            <span className="font-medium">Grabar valoración por voz</span>
          </div>
          {!recording ? (
            <button
              type="button"
              onClick={startRec}
              className="text-xs px-3 py-1.5 rounded-lg bg-biosensor text-biosensor-foreground font-semibold"
            >
              Empezar
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRec}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-fuchsia-neural text-fuchsia-neural-foreground font-semibold"
            >
              <Square className="h-3 w-3" />
              Detener
            </button>
          )}
        </div>

        {audioUrl && (
          <div className="mt-3 space-y-2">
            <audio src={audioUrl} controls className="w-full h-10" />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={analyze}
                disabled={analyzing}
                className="flex-1"
              >
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Analizar con IA"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setAnalysis(null);
                }}
              >
                Borrar
              </Button>
            </div>
          </div>
        )}

        {analysis && (
          <div
            className={`mt-3 rounded-lg border p-2.5 text-xs ${
              analysis.alert
                ? "border-fuchsia-neural/40 bg-fuchsia-neural/5 text-fuchsia-neural"
                : "border-biosensor/40 bg-biosensor/5 text-foreground"
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              {analysis.alert ? (
                <ShieldAlert className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-biosensor" />
              )}
              Sentimiento: {analysis.sentiment} ({Math.round(analysis.score * 100)}%)
            </div>
            <p className="mt-1 text-muted-foreground italic">"{analysis.transcript}"</p>
            <p className="mt-1">{analysis.summary}</p>
          </div>
        )}
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full" variant="hero" size="lg">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar valoración
      </Button>
    </div>
  );
}
