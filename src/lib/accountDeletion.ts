// Reglas para eliminar la propia cuenta: las mismas que aplica la Edge Function `delete-account`.
// Viven en `supabase/functions/_shared/accountDeletion.ts` porque las Edge Functions no pueden importar desde `src/`.
export * from "../../supabase/functions/_shared/accountDeletion";
