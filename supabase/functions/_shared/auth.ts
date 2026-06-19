// Shared auth helper for edge functions.
// Validates the caller's Supabase JWT and returns the authenticated user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Allowlist of trusted origins for browser-side calls. Server-to-server callers
// (no Origin header) get the canonical site origin, which is harmless for them.
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?(humanix\.lat|lovable\.app|lovableproject\.com)$/i;
const DEFAULT_ORIGIN = "https://humanix.lat";

export function buildCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") ?? "";
  const allowed = origin && ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// Backwards-compatible export: callers that still use `corsHeaders` get the
// default safe origin. New code should call buildCorsHeaders(req) per-request.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": DEFAULT_ORIGIN,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type AuthResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; response: Response };

export async function requireUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Configuración de auth incompleta" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  return { ok: true, userId: data.user.id, token };
}
