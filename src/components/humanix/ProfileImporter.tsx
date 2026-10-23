import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { extractProfessionalProfile } from "@/lib/profileExtract.functions";
import { prepareProfileImport, PROFILE_FILE_ACCEPT } from "@/lib/profileImport";
import type { ExtractedProfile } from "@/lib/profileExtraction";
import { toast } from "sonner";

export function ProfileImporter({ onExtracted }: { onExtracted: (profile: ExtractedProfile) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const extract = useServerFn(extractProfessionalProfile);
  async function importProfile() {
    setBusy(true);
    try {
      const data = await prepareProfileImport(text, file);
      const result = await extract({ data: { ...data, save_documents: true } });
      if (!result.ok) throw new Error(result.message || "No pudimos leer el documento.");
      await onExtracted(result.profile);
      toast.success(`Información extraída${result.savedDocuments ? ` · ${result.savedDocuments} soportes guardados para revisión` : ""}. Revisa y guarda tu perfil.`);
      if (result.documentWarning) toast.warning(result.documentWarning);
      if (!result.savedDocuments && !data.file) toast.info("El texto llena tus datos; los documentos de identidad y títulos necesitan su archivo original.");
      setFile(null);
      setText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos importar la información.");
    } finally { setBusy(false); }
  }
  return <section className="space-y-3 border-b border-border pb-5">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-biosensor" /> Importar hoja de vida y soportes</h3>
    <Textarea aria-label="Texto de la hoja de vida" placeholder="Pega tu hoja de vida, experiencia y referencias…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={3} />
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept={PROFILE_FILE_ACCEPT} aria-label="Archivo para importar perfil" className="sr-only" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><FileUp className="mr-2 h-4 w-4" /> PDF, Word u otro archivo</Button>
      <Button variant="hero" disabled={busy || (!file && !text.trim())} onClick={() => void importProfile()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{busy ? "Leyendo documento…" : "Extraer y llenar"}</Button>
    </div>
    {file && <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 break-all">{file.name}</span><Button variant="ghost" size="icon" title="Quitar archivo" aria-label="Quitar archivo" disabled={busy} onClick={() => setFile(null)}><X className="h-4 w-4" /></Button></div>}
  </section>;
}