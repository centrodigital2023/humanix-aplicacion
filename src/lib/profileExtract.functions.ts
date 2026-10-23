// Extrae el perfil profesional completo (datos, experiencia y referencias) de texto, PDF o imagen con IA.
// Solo para usuarios con sesión; el resultado se normaliza en `profileExtraction.ts` y el panel lo rellena (editable).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeExtraction, type ExtractedProfile } from "./profileExtraction";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const input = z
  .object({
    text: z.string().max(60_000).optional(),
    file: z
      .object({
        name: z.string().max(200),
        kind: z.enum(["pdf", "image"]),
        mime: z.string().max(80),
        base64: z.string().max(14_000_000),
      })
      .optional(),
  })
  .refine((d) => (d.text && d.text.trim()) || d.file, "empty");

const PROMPT = `Eres un asistente que lee hojas de vida de profesionales de la salud en Colombia.
Extrae TODA la información disponible y responde SOLO con un objeto JSON con estas claves (omite las que no aparezcan, nunca inventes):
full_name, specialty (p. ej. "Enfermería", "Auxiliar de enfermería", "Fisioterapia"), sub_specialties (array),
years_experience (número), rethus_number, certifications (array), languages (array), service_cities (array de ciudades de Colombia),
bio (2-3 frases en primera persona, cálidas y precisas, en español), hourly_rate, shift_rate, monthly_rate (COP, números),
work_experience: array de {role, employer, city, start ("YYYY" o "YYYY-MM"), end ("YYYY", "YYYY-MM" o "Actual"), description},
references: array de {ref_type ("work" para referencias laborales/profesionales, "family" para familiares o personales), full_name, phone, relation}.`;

export type ExtractResult =
  | { ok: true; profile: ExtractedProfile }
  | { ok: false; error: "empty" | "not_configured" | "ai_busy" | "no_credits" | "ai_error" };

export const extractProfessionalProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<ExtractResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false, error: "not_configured" };

    const content: unknown[] = [{ type: "text", text: PROMPT }];
    if (data.text?.trim()) content.push({ type: "text", text: `Contenido:\n${data.text.trim()}` });
    if (data.file?.kind === "pdf") {
      content.push({
        type: "file",
        file: { filename: data.file.name, file_data: `data:application/pdf;base64,${data.file.base64}` },
      });
    } else if (data.file?.kind === "image") {
      const mime = /^image\/(png|jpeg|webp)$/.test(data.file.mime) ? data.file.mime : "image/jpeg";
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data.file.base64}` } });
    }

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        Authorization: `Bearer ${key}`,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    }).catch(() => null);

    if (!res || !res.ok || !res.body) {
      const status = res?.status ?? 0;
      console.error("extractProfessionalProfile:", status, res ? await res.text().catch(() => "") : "network");
      if (status === 429) return { ok: false, error: "ai_busy" };
      if (status === 402) return { ok: false, error: "no_credits" };
      return { ok: false, error: "ai_error" };
    }

    // Lee el stream SSE y junta el texto.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          text += j.choices?.[0]?.delta?.content ?? "";
        } catch {
          /* fragmento incompleto */
        }
      }
    }
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try {
      return { ok: true, profile: normalizeExtraction(JSON.parse(json)) };
    } catch {
      console.error("extractProfessionalProfile: respuesta no JSON");
      return { ok: false, error: "ai_error" };
    }
  });
