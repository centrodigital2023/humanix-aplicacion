// Genera contrato de prestación de servicios y envía OTPs de firma.
// El PDF se genera como HTML+texto y se almacena en Supabase Storage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

const WA_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

function randomOtp() {
  // Cryptographically secure 6-digit OTP
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (100000 + (buf[0] % 900000)).toString();
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendWa(phone: string, body: string) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  const clean = phone.replace(/\D/g, "");
  const to = clean.startsWith("57") ? clean : `57${clean}`;
  await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
}

function generateContractText(opts: {
  familyName: string; familyDoc: string;
  proName: string; proRethus: string;
  serviceDesc: string; startDate: string; endDate?: string;
  sessions?: number; valuePerSession?: number; totalValue?: number;
}): string {
  const date = new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" });
  return `
CONTRATO DE PRESTACIÓN DE SERVICIOS DE SALUD

Fecha: ${date}

PARTES:

CONTRATANTE: ${opts.familyName}
Cédula/Documento: ${opts.familyDoc}

CONTRATISTA: ${opts.proName}
Tarjeta Profesional RETHUS: ${opts.proRethus}

OBJETO DEL CONTRATO:
El CONTRATISTA se compromete a prestar los siguientes servicios de salud:
${opts.serviceDesc}

VIGENCIA:
${opts.startDate}${opts.endDate ? ` al ${opts.endDate}` : ""}
${opts.sessions ? `Número de sesiones: ${opts.sessions}` : ""}

VALOR:
${opts.valuePerSession ? `Por sesión: COP ${opts.valuePerSession.toLocaleString("es-CO")}` : ""}
${opts.totalValue ? `Total acordado: COP ${opts.totalValue.toLocaleString("es-CO")}` : ""}

NATURALEZA DEL CONTRATO:
Este contrato es de naturaleza civil — prestación de servicios independientes (Art. 2063 C.C.).
El CONTRATISTA actúa como profesional autónomo, sin que exista vínculo laboral ni
subordinación respecto al CONTRATANTE (Art. 23 C.S.T.). El CONTRATISTA tiene libertad de
horarios, métodos y herramientas, y cuenta con tarjeta profesional RETHUS vigente.

OBLIGACIONES DEL CONTRATISTA:
1. Prestar el servicio con idoneidad y diligencia profesional.
2. Informar a la familia sobre el estado del paciente.
3. Registrar eventos en la bitácora digital de Humanix.
4. Mantener la confidencialidad de la información del paciente (Ley 1581/2012).

OBLIGACIONES DEL CONTRATANTE:
1. Pagar el valor acordado al finalizar cada sesión (Nequi/PSE/efectivo).
2. Suministrar un entorno seguro para la prestación del servicio.
3. Notificar con anticipación cualquier cancelación.

FIRMA DIGITAL:
Las partes firman digitalmente este contrato mediante código OTP enviado por WhatsApp,
con plena validez legal en Colombia conforme a la Ley 527/1999 (Comercio Electrónico).

Generado por humanix.lat · ${date}
`.trim();
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener datos de la reserva + perfiles
    const { data: booking, error: bErr } = await supabase
      .from("service_bookings")
      .select("id, client_id, professional_id, service_address, scheduled_at, total_amount, hourly_rate, notes")
      .eq("id", booking_id)
      .single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "booking not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar que el caller es parte del contrato o staff
    const isParty =
      auth.userId === booking.client_id || auth.userId === booking.professional_id;
    if (!isParty) {
      const { data: staff } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.userId)
        .in("role", ["superadmin", "hr_staff"])
        .maybeSingle();
      if (!staff) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const [{ data: famProfile }, { data: proProfile }, { data: proDetails }] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("user_id", booking.client_id).single(),
      supabase.from("profiles").select("full_name, phone").eq("user_id", booking.professional_id).single(),
      supabase.from("professional_profiles")
        .select("rethus_number, document_number")
        .eq("user_id", booking.professional_id)
        .maybeSingle(),
    ]);

    const contractText = generateContractText({
      familyName:    famProfile?.full_name ?? "Contratante",
      familyDoc:     "---",
      proName:       proProfile?.full_name ?? "Profesional",
      proRethus:     proDetails?.rethus_number ?? "---",
      serviceDesc:   booking.notes ?? "Servicios de salud domiciliaria",
      startDate:     new Date(booking.scheduled_at).toLocaleDateString("es-CO"),
      valuePerSession: booking.hourly_rate,
      totalValue:    booking.total_amount,
    });

    // Guardar contrato en Storage (como texto plano — PDF requeriría pdf-lib en Deno)
    const fileName = `contracts/${booking_id}-${Date.now()}.txt`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(fileName, new TextEncoder().encode(contractText), {
        contentType: "text/plain; charset=utf-8",
        upsert: true,
      });
    if (upErr) console.error("[generate-contract] upload error:", upErr.message);

    const { data: { publicUrl } } = supabase.storage
      .from("documents")
      .getPublicUrl(fileName);

    // Generar OTPs y almacenar como MD5 hash
    const famOtp  = randomOtp();
    const proOtp  = randomOtp();

    // Hash seguro con SHA-256 + salt por contrato.
    const otpSalt = crypto.randomUUID();
    const famOtpHash = await sha256Hex(famOtp + otpSalt);
    const proOtpHash = await sha256Hex(proOtp + otpSalt);

    const { data: contract, error: cErr } = await supabase
      .from("service_contracts")
      .insert({
        booking_id,
        family_id:           booking.client_id,
        professional_id:     booking.professional_id,
        service_description: booking.notes ?? "Servicios de salud domiciliaria",
        start_date:          new Date(booking.scheduled_at).toISOString().slice(0, 10),
        total_value:         booking.total_amount,
        value_per_session:   booking.hourly_rate,
        contract_text:       contractText,
        pdf_url:             publicUrl,
        family_otp_hash:       famOtpHash,
        professional_otp_hash: proOtpHash,
      })
      .select("id")
      .single();

    if (cErr || !contract) throw cErr ?? new Error("insert failed");

    // Enviar OTPs por WhatsApp
    await Promise.all([
      sendWa(
        famProfile?.phone ?? "",
        `Humanix: Tu contrato está listo. Código de firma: *${famOtp}*. Vigente 10 minutos.\n\nVer contrato: ${publicUrl}`,
      ),
      sendWa(
        proProfile?.phone ?? "",
        `Humanix: Nuevo contrato de servicio. Código de firma: *${proOtp}*. Vigente 10 minutos.\n\nVer contrato: ${publicUrl}`,
      ),
    ]);

    return new Response(
      JSON.stringify({ contract_id: contract.id, pdf_url: publicUrl, contract_generated: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[generate-contract]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
