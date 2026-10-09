// Contrato inteligente: firma con aceptación explícita, identidad validada y segundo factor reciente.
//
// La regla del proyecto es no crear Edge Functions nuevas: la lógica de servidor vive en `createServerFn`
// y usa el service role únicamente aquí, en el servidor (`record_contract_signature` solo lo puede ejecutar
// el service role, así que ningún cliente puede registrar firmas por su cuenta). La lógica está en
// `contracts.server.ts` (inyectable y con pruebas).
//
// El segundo factor es el código de un solo uso que Supabase Auth envía al correo de la cuenta
// (`signInWithOtp` + `verifyOtp` en el navegador): el token resultante lleva su huella (`amr`) y aquí se
// exige que sea reciente.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContractDeps, Db, SignResult } from "./contracts.server";

export type { SignErrorCode, SignResult } from "./contracts.server";

export const signSmartContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<SignResult> => {
    const { handleSign } = await import("./contracts.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps: ContractDeps = {
      admin: supabaseAdmin as unknown as Db,
      header: (name) => getRequestHeader(name as never),
      salt: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    return handleSign(data, { userId: context.userId, claims: context.claims }, deps);
  });
