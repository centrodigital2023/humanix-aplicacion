import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_notifications",
  title: "Mis notificaciones",
  description: "Lista las notificaciones más recientes de la cuenta de Humanix que inició sesión.",
  inputSchema: {
    unread_only: z.boolean().optional().describe("Solo notificaciones sin leer."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (1-50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ unread_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("No autenticado");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("notifications")
      .select("id, title, body, type, link, created_at, read_at")
      .eq("user_id", ctx.getUserId()!)
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (unread_only) q = q.is("read_at", null);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const rows = (data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      link: n.link,
      created_at: n.created_at,
      read: n.read_at !== null,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { notifications: rows },
    };
  },
});
