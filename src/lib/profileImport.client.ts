import { fileKind } from "./profileExtraction";

export const PROFILE_FILE_ACCEPT = ".pdf,.docx,.txt,.md,.rtf,.csv,.json,image/png,image/jpeg,image/webp";

export async function prepareProfileImport(text: string, source?: File | null) {
  let content = text.trim();
  let file: { name: string; kind: "pdf" | "image"; mime: string; base64: string } | undefined;
  if (source) {
    if (source.size === 0) throw new Error("El archivo está vacío.");
    if (source.size > 10 * 1024 * 1024) throw new Error("El archivo supera los 10 MB.");
    const kind = fileKind(source.name, source.type);
    if (!kind) throw new Error("Usa PDF, Word .docx, imagen, TXT, MD, RTF, CSV o JSON. Para Word .doc, guárdalo como .docx o PDF.");
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      const parsed = await mammoth.extractRawText({ arrayBuffer: await source.arrayBuffer() });
      content = [content, parsed.value].filter(Boolean).join("\n");
    } else if (kind === "text") {
      let extracted = await source.text();
      if (source.name.toLowerCase().endsWith(".rtf")) {
        extracted = extracted.replace(/\\'([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\(?:par|line)\b/g, "\n").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
      }
      content = [content, extracted].filter(Boolean).join("\n");
    } else {
      const bytes = new Uint8Array(await source.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const mime = kind === "pdf" ? "application/pdf" : source.type || (source.name.toLowerCase().endsWith(".png") ? "image/png" : source.name.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg");
      file = { name: source.name, kind, mime, base64: btoa(binary) };
    }
  }
  if (!content && !file) throw new Error("Pega información o selecciona un archivo legible.");
  if (content.length > 60_000) throw new Error("El texto supera los 60.000 caracteres. Divide el documento para no perder información.");
  return { text: content || undefined, file };
}