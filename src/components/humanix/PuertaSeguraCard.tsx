// Tarjeta "Puerta Segura": enviada por WhatsApp a la familia antes de que
// llegue el profesional. Muestra foto, verificación RETHUS, ETA y botón de emergencia.
// Se renderiza como preview en la web y como imagen compartible en WhatsApp.
import { Shield, MapPin, Clock, Phone, CheckCircle2 } from "lucide-react";

type ProfessionalSummary = {
  name: string;
  photoUrl?: string;
  specialty: string;
  rethusBadge: boolean;
  rethusCertified: boolean;
  rethusCertDate?: string; // "verificado hoy" | ISO date
  yearsExp: number;
  etaMinutes?: number;
  etaText?: string;
  whatsappNumber?: string; // support number
};

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="h-20 w-20 rounded-full object-cover ring-4 ring-ok/30"
      />
    );
  }
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-trust/15 ring-4 ring-trust/20 text-3xl font-bold text-trust">
      {initials}
    </div>
  );
}

export function PuertaSeguraCard({
  professional,
  patientName,
  serviceDate,
}: {
  professional: ProfessionalSummary;
  patientName?: string;
  serviceDate?: string;
}) {
  const wa = professional.whatsappNumber
    ? `https://wa.me/${professional.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola Humanix, necesito ayuda con el servicio de ${professional.name}`,
      )}`
    : null;

  return (
    <div className="mx-auto max-w-sm overflow-hidden rounded-[1.75rem] bg-card shadow-2xl shadow-trust/15 ring-1 ring-border">
      {/* top bar */}
      <div className="flex items-center gap-2 bg-trust px-5 py-3">
        <Shield size={16} className="text-trust-foreground shrink-0" />
        <span className="text-sm font-bold text-trust-foreground tracking-wide">
          Humanix · Puerta Segura™
        </span>
      </div>

      {/* body */}
      <div className="px-5 py-5 space-y-4">
        {patientName && (
          <p className="text-sm text-muted-foreground">
            Servicio para <strong className="text-foreground">{patientName}</strong>
            {serviceDate ? ` · ${serviceDate}` : ""}
          </p>
        )}

        {/* professional identity */}
        <div className="flex items-center gap-4">
          <Avatar name={professional.name} photoUrl={professional.photoUrl} />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight truncate">{professional.name}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{professional.specialty}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {professional.yearsExp} año{professional.yearsExp !== 1 ? "s" : ""} de experiencia
            </p>
          </div>
        </div>

        {/* verification badges */}
        <div className="space-y-2">
          <VerificationRow
            ok={professional.rethusBadge}
            label="Registro RETHUS activo"
            sub={
              professional.rethusCertDate
                ? `Consultado: ${professional.rethusCertDate}`
                : "Consulta en tiempo real"
            }
          />
          <VerificationRow
            ok={professional.rethusCertified}
            label="Antecedentes verificados"
            sub="Penales y laborales"
          />
        </div>

        {/* ETA */}
        {(professional.etaMinutes !== undefined || professional.etaText) && (
          <div className="flex items-center gap-3 rounded-2xl bg-ok/10 border border-ok/25 px-4 py-3">
            <Clock size={18} className="text-ok shrink-0" />
            <div>
              <p className="text-sm font-semibold text-ok">
                {professional.etaText ?? `Llega en aprox. ${professional.etaMinutes} minutos`}
              </p>
              <p className="text-xs text-muted-foreground">GPS en tiempo real activado</p>
            </div>
            <MapPin size={14} className="ml-auto text-ok shrink-0" />
          </div>
        )}

        {/* cta */}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-2xl bg-ok px-4 py-3 text-sm font-bold text-ok-foreground hover:bg-ok/90 transition active:scale-95"
          >
            <Phone size={15} />
            Contactar soporte Humanix
          </a>
        )}

        <p className="text-center text-[0.68rem] text-muted-foreground">
          Este profesional fue verificado por Humanix · humanix.lat
        </p>
      </div>
    </div>
  );
}

function VerificationRow({ ok, label, sub }: { ok: boolean; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <CheckCircle2
        size={18}
        className={`mt-0.5 shrink-0 ${ok ? "text-ok" : "text-muted-foreground/40"}`}
      />
      <div>
        <p
          className={`text-sm font-semibold ${ok ? "text-foreground" : "text-muted-foreground/60"}`}
        >
          {label}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
