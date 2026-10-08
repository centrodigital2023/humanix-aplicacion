// PQRS: radicación pública, consulta de estado y borrador de respuesta con IA (solo staff).
//
// Reemplazan a las funciones de borde `pqrs-intake` y `pqrs-assistant`: la regla del proyecto es no
// crear Edge Functions nuevas, así que la lógica de servidor vive en `createServerFn` y usa el service
// role únicamente en el servidor. La lógica está en `pqrs.server.ts` (inyectable y con pruebas).
//   · submitPqrs / lookupPqrsStatus: públicas (formulario de /contacto). Defensas: validación estricta,
//     campo trampa, límites por IP y por contacto (solo hashes) y escritura únicamente con service role.
//   · draftPqrsReply: requiere sesión y rol de staff; la IA propone, una persona revisa y envía.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  DraftReplyResult,
  Db,
  PqrsDeps,
  PqrsStatusResult,
  SubmitPqrsResult,
} from "./pqrs.server";

export type {
  DraftReplyError,
  DraftReplyResult,
  PqrsStatusResult,
  SubmitPqrsResult,
} from "./pqrs.server";

async function deps(): Promise<PqrsDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    admin: supabaseAdmin as unknown as Db,
    header: (name) => getRequestHeader(name as never),
    salt: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ai: { apiKey: process.env.LOVABLE_API_KEY, model: process.env.PQRS_AI_MODEL },
  };
}

export const submitPqrs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }): Promise<SubmitPqrsResult> => {
    const { handleSubmit } = await import("./pqrs.server");
    return handleSubmit(data, await deps());
  });

export const lookupPqrsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }): Promise<PqrsStatusResult> => {
    const { handleStatus } = await import("./pqrs.server");
    return handleStatus(data, await deps());
  });

export const draftPqrsReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<DraftReplyResult> => {
    const { handleDraft } = await import("./pqrs.server");
    const d = await deps();
    return handleDraft(data, context.userId, { admin: d.admin, ai: d.ai });
  });
