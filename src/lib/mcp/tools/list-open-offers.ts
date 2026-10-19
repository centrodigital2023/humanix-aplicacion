import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_open_offers",
  title: "Ofertas abiertas",
  description: "Busca ofertas de trabajo en salud abiertas en Humanix, opcionalmente por ciudad.",
  inputSchema: {
    city: z.string().min(2).max(60).optional().describe("Ciudad, por ejemplo Bogotá."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (1-50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ city, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("No autenticado");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("job_offers")
      .select("id, title, city, modality, amount, specialty_required, is_urgent, start_date, created_at")
      .eq("status", "open")
      .eq("blocked", false)
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (city) q = q.ilike("city", `%${city.replace(/[%_,()]/g, "")}%`);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const rows = (data ?? []).map((o) => ({
      id: o.id,
      title: o.title,
      city: o.city,
      modality: String(o.modality),
      amount: Number(o.amount),
      specialty: o.specialty_required,
      urgent: o.is_urgent,
      start_date: o.start_date,
      url: `https://humanix.lat/oferta/${o.id}`,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { offers: rows },
    };
  },
});
