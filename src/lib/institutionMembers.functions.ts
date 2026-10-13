// Personal de la institución: crear, editar/suspender, reiniciar contraseña y quitar.
//
// La regla del proyecto es no crear Edge Functions nuevas: la lógica de servidor vive en `createServerFn` y usa el service
// role únicamente aquí, en el servidor (crear cuentas de Supabase Auth y escribir `institution_members`, que ningún cliente
// puede escribir). La lógica está en `institutionMembers.server.ts` (inyectable y con pruebas). Todas exigen sesión; además
// el servidor comprueba que sea la CUENTA DE LA INSTITUCIÓN (el personal no tiene roles y nunca puede administrar al equipo).
//
// Leer al equipo y su actividad no necesita servidor: la institución lo lee directamente (RLS de `institution_members` y
// `institution_member_actions`).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Db, MemberResult, MembersDeps } from "./institutionMembers.server";

export type { MemberErrorCode, MemberResult, MemberView } from "./institutionMembers.server";

async function deps(): Promise<MembersDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { admin: supabaseAdmin as unknown as Db };
}

export const createInstitutionMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<MemberResult> => {
    const { handleCreateMember } = await import("./institutionMembers.server");
    return handleCreateMember(data, { userId: context.userId }, await deps());
  });

export const updateInstitutionMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<MemberResult> => {
    const { handleUpdateMember } = await import("./institutionMembers.server");
    return handleUpdateMember(data, { userId: context.userId }, await deps());
  });

export const resetInstitutionMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<MemberResult> => {
    const { handleResetPassword } = await import("./institutionMembers.server");
    return handleResetPassword(data, { userId: context.userId }, await deps());
  });

export const removeInstitutionMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<MemberResult> => {
    const { handleRemoveMember } = await import("./institutionMembers.server");
    return handleRemoveMember(data, { userId: context.userId }, await deps());
  });
