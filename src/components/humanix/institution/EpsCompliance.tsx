// Cumplimiento operativo del portal EPS/IPS: los indicadores reales de calidad y cumplimiento de los servicios de la
// institución (lógica en `lib/instQuality`, plan IPS Mejorado) y dónde leer cómo se tratan los datos personales.
//
// Antes mostraba porcentajes fijos (87 %, 74 %, 92 %…) y una lista de sellos («HIPAA Ready», «GDPR Ready», «MFA
// habilitado», «Encriptación TLS 1.3») que la aplicación no puede comprobar. Aquí solo hay cifras calculadas con los
// servicios, el parte y los contratos de la institución, y enlaces a las páginas legales de Humanix.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PremiumPreview } from "@/components/humanix/premium/PremiumPreview";
import { useInstBookings, useInstQuality } from "@/hooks/use-inst-intel";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { proNames } from "@/lib/instData";
import { DAY_MS, msOf, plural, resolvePeriod } from "@/lib/intelShared";
import { PLAN_CATALOG } from "@/lib/plans";
import { QualityCard } from "./QualityCard";

export function EpsCompliance({ userId }: { userId: string }) {
  const now = useNow();
  const plan = usePlan(userId);
  const allowed = plan.can("inst_quality_compliance");
  const period = useMemo(() => resolvePeriod("30d", now), [now]);

  const bookingsQ = useInstBookings(userId);
  const quality = useInstQuality(userId, period, allowed);
  const names = useMemo(() => proNames(quality.data.pros), [quality.data.pros]);
  const done30 = (bookingsQ.data ?? []).filter(
    (b) => b.status === "completed" && msOf(b.scheduled_at) >= now - 30 * DAY_MS,
  ).length;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-ok" aria-hidden="true" />
        Cumplimiento operativo
      </p>

      {plan.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : allowed ? (
        <QualityCard
          report={quality.report}
          names={names}
          loading={quality.loading}
          error={quality.error}
        />
      ) : (
        <PremiumPreview
          min="institution_monthly"
          ctaNote={`${PLAN_CATALOG.institution_monthly.priceLabel}${PLAN_CATALOG.institution_monthly.priceNote}, sin permanencia.`}
          icon={<ShieldCheck className="h-4 w-4 text-ok" aria-hidden="true" />}
          title="Calidad y cumplimiento"
          description="Seis indicadores de lo que ya ocurrió en tus servicios, cada uno con su meta y de dónde sale el número."
          bullets={[
            "Turnos cumplidos, llegadas puntuales y horas registradas frente a las contratadas",
            "Servicios con parte del turno y con contrato firmado",
            "Horas atendidas por personal con RETHUS verificado, y la lista de servicios por revisar",
          ]}
          teaser={
            done30 > 0
              ? `Tus ${plural(done30, "servicio terminado", "servicios terminados")} de los últimos 30 días ya se pueden medir con estos indicadores.`
              : null
          }
        />
      )}

      <Card className="space-y-2 p-4">
        <p className="text-sm font-semibold">Datos personales y de salud</p>
        <p className="text-sm text-muted-foreground">
          Aquí está cómo Humanix trata los datos personales y de salud, y los derechos de las
          personas sobre ellos:
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li>
            <Link
              to="/habeas-data"
              className="font-medium text-trust underline-offset-2 hover:underline"
            >
              Habeas Data
            </Link>
          </li>
          <li>
            <Link
              to="/privacidad"
              className="font-medium text-trust underline-offset-2 hover:underline"
            >
              Política de privacidad
            </Link>
          </li>
          <li>
            <Link
              to="/cumplimiento"
              className="font-medium text-trust underline-offset-2 hover:underline"
            >
              Cumplimiento normativo
            </Link>
          </li>
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Este portal te muestra lo que Humanix registra de tus servicios; no certifica por sí solo
          el cumplimiento normativo de tu institución.
        </p>
      </Card>
    </div>
  );
}
