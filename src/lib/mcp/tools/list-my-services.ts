import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_services",
  title: "Mis servicios",
  description:
    "Lista los servicios de cuidado de la cuenta que inició sesión (como familia o como profesional), con fecha, estado y valor.",
  inputSchema: {
    upcoming_only: z.boolean().optional().describe("Solo servicios programados desde hoy."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (1-50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ upcoming_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("No autenticado");
    const uid = ctx.getUserId()!;
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("service_bookings")
      .select("id, status, scheduled_at, duration_hours, hourly_rate, total_amount, client_id, professional_id")
      .or(`client_id.eq.${uid},professional_id.eq.${uid}`)
      .order("scheduled_at", { ascending: !!upcoming_only })
      .limit(limit ?? 20);
    if (upcoming_only) q = q.gte("scheduled_at", new Date().toISOString());
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const rows = (data ?? []).map((b) => ({
      id: b.id,
      status: b.status,
      scheduled_at: b.scheduled_at,
      duration_hours: Number(b.duration_hours),
      hourly_rate: Number(b.hourly_rate),
      total_amount: Number(b.total_amount),
      my_role: b.client_id === uid ? "familia" : "profesional",
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { services: rows },
    };
  },
});
