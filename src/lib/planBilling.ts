// Una sola fuente para la lógica de cobro y vigencia de planes: la misma que usan las Edge Functions de pago.
// Vive en `supabase/functions/_shared/planBilling.ts` porque las Edge Functions no pueden importar desde `src/`.
export * from "../../supabase/functions/_shared/planBilling";
