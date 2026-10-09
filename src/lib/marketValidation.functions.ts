// Formulario de validación de mercado: envío, código de verificación y canje del mes gratis del plan Esencial.
//
// Reemplazan a las funciones de borde `send-validation-otp` y `verify-validation-otp`: la regla del proyecto es no
// crear Edge Functions nuevas, así que la lógica de servidor vive en `createServerFn` y usa el service role
// únicamente en el servidor. La lógica está en `marketValidation.server.ts` (inyectable y con pruebas).
//   · submitMarketValidation / sendValidationOtp / verifyValidationOtp: públicas (la persona aún no tiene
//     cuenta). Defensas: validación estricta, campo trampa, límites por IP y por contacto (solo huellas) y
//     escritura únicamente con service role.
//   · redeemMarketBenefit: requiere sesión; activa 1 mes del plan Esencial con `redeem_validation_benefit`.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Db,
  MarketDeps,
  RedeemResult,
  SendOtpResult,
  SubmitResult,
  VerifyOtpResult,
} from "./marketValidation.server";

export type {
  BenefitState,
  RedeemError,
  RedeemResult,
  SendOtpResult,
  SubmitResult,
  VerifyOtpResult,
} from "./marketValidation.server";

async function deps(): Promise<MarketDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    admin: supabaseAdmin as unknown as Db,
    header: (name) => getRequestHeader(name as never),
    salt: process.env.SUPABASE_SERVICE_ROLE_KEY,
    otp: {
      whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN,
      whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      whatsappTemplate: process.env.WHATSAPP_OTP_TEMPLATE,
      resendKey: process.env.RESEND_API_KEY,
    },
  };
}

export const submitMarketValidation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }): Promise<SubmitResult> => {
    const { handleSubmit } = await import("./marketValidation.server");
    return handleSubmit(data, await deps());
  });

export const sendValidationOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }): Promise<SendOtpResult> => {
    const { handleSendOtp } = await import("./marketValidation.server");
    return handleSendOtp(data, await deps());
  });

export const verifyValidationOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }): Promise<VerifyOtpResult> => {
    const { handleVerifyOtp } = await import("./marketValidation.server");
    return handleVerifyOtp(data, await deps());
  });

export const redeemMarketBenefit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<RedeemResult> => {
    const { handleRedeem } = await import("./marketValidation.server");
    const d = await deps();
    return handleRedeem(data, context.userId, { admin: d.admin });
  });
