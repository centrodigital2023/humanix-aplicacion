/**
 * ENHANCED INSTITUTION OPERATIONS DASHBOARD
 * 
 * Métricas operativas en tiempo real:
 * - Ofertas activas y cubiertas
 * - Aplicantes pendientes
 * - Rendimiento de contratación
 * - Tasa de conversión
 * - Utilización de profesionales
 * - Costo promedio por oferta
 */

import { useEffect, useState } from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Zap,
  Target,
  Clock,
  Users,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type OperationalMetrics = {
  total_offers: number;
  active_offers: number;
  filled_offers: number;
  total_applicants: number;
  pending_applicants: number;
  total_spent: number;
  average_cost_per_hire: number;
  conversion_rate: number;
  avg_time_to_hire_days: number;
  professional_utilization_rate: number;
};

export function EnhancedInstitutionOperations({
  userId,
}: {
  userId: string;
}) {
  const [metrics, setMetrics] = useState<OperationalMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Obtener todas las ofertas
        const { data: offerData } = await supabase
          .from("job_offers")
          .select("id, status, amount, created_at")
          .eq("posted_by", userId);

        const offers = offerData ?? [];
        const totalOffers = offers.length;
        const activeOffers = offers.filter((o) => o.status === "open").length;
        const filledOffers = offers.filter((o) => o.status === "filled").length;
        const totalSpent = offers.reduce((sum, o) => sum + (o.amount || 0), 0);

        // Obtener aplicaciones
        const offerIds = offers.map((o) => o.id);
        let applicationsData: any[] = [];
        if (offerIds.length > 0) {
          const { data } = await supabase
            .from("applications")
            .select("id, status, created_at")
            .in("job_offer_id", offerIds);
          applicationsData = data ?? [];
        }

        const totalApplicants = applicationsData.length;
        const pendingApplicants = applicationsData.filter(
          (a) => a.status === "pending"
        ).length;

        // Calcular métricas
        const averageCostPerHire = filledOffers > 0 ? totalSpent / filledOffers : 0;
        const conversionRate = totalApplicants > 0 ? (filledOffers / totalApplicants) * 100 : 0;

        // Calcular tiempo promedio para contratar
        let totalDays = 0;
        let filledCount = 0;
        offers.forEach((o) => {
          if (o.status === "filled") {
            const createdDate = new Date(o.created_at);
            const daysElapsed = Math.floor(
              (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            totalDays += daysElapsed;
            filledCount++;
          }
        });
        const avgTimeToHire = filledCount > 0 ? Math.round(totalDays / filledCount) : 0;

        // Tasa de utilización (ofertas cubiertas / ofertas totales)
        const utilizationRate = totalOffers > 0 ? (filledOffers / totalOffers) * 100 : 0;

        if (active) {
          setMetrics({
            total_offers: totalOffers,
            active_offers: activeOffers,
            filled_offers: filledOffers,
            total_applicants: totalApplicants,
            pending_applicants: pendingApplicants,
            total_spent: totalSpent,
            average_cost_per_hire: averageCostPerHire,
            conversion_rate: conversionRate,
            avg_time_to_hire_days: avgTimeToHire,
            professional_utilization_rate: utilizationRate,
          });
        }
      } catch (e) {
        console.error("[operations dashboard] load failed", e);
        if (active) toast.error("Error cargando métricas operativas");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  if (loading || !metrics) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando
        métricas…
      </Card>
    );
  }

  const metricCards = [
    {
      label: "Ofertas activas",
      value: metrics.active_offers,
      total: metrics.total_offers,
      icon: Zap,
      color: "emerald",
      trend: metrics.active_offers > 0 ? "up" : "down",
    },
    {
      label: "Cubiertas",
      value: metrics.filled_offers,
      total: metrics.total_offers,
      icon: CheckCircle2,
      color: "blue",
      trend: metrics.filled_offers > 0 ? "up" : "down",
    },
    {
      label: "Aplicantes pendientes",
      value: metrics.pending_applicants,
      total: metrics.total_applicants,
      icon: Users,
      color: "fuchsia",
      trend: metrics.pending_applicants > 0 ? "up" : "down",
    },
    {
      label: "Tasa de conversión",
      value: `${metrics.conversion_rate.toFixed(1)}%`,
      icon: Target,
      color: "amber",
      benchmark: "50%+",
    },
    {
      label: "Costo promedio/contratación",
      value: `$${(metrics.average_cost_per_hire / 1000).toFixed(0)}K`,
      icon: DollarSign,
      color: "copper",
    },
    {
      label: "Tiempo promedio contratación",
      value: `${metrics.avg_time_to_hire_days} días`,
      icon: Clock,
      color: "bio",
      benchmark: "<7 días",
    },
    {
      label: "Utilización profesionales",
      value: `${metrics.professional_utilization_rate.toFixed(1)}%`,
      icon: TrendingUp,
      color: "purple",
    },
    {
      label: "Gasto total",
      value: `$${(metrics.total_spent / 1000000).toFixed(1)}M`,
      icon: DollarSign,
      color: "green",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold mb-3">
          📊 Métricas operativas en tiempo real
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          const bgColors: Record<string, string> = {
            emerald: "from-emerald-50 to-transparent border-emerald-200/50",
            blue: "from-blue-50 to-transparent border-blue-200/50",
            fuchsia: "from-fuchsia-50 to-transparent border-fuchsia-200/50",
            amber: "from-amber-50 to-transparent border-amber-200/50",
            copper: "from-copper/10 to-transparent border-copper/20",
            bio: "from-bio/10 to-transparent border-bio/20",
            purple: "from-purple-50 to-transparent border-purple-200/50",
            green: "from-green-50 to-transparent border-green-200/50",
          };

          const textColors: Record<string, string> = {
            emerald: "text-emerald-600",
            blue: "text-blue-600",
            fuchsia: "text-fuchsia-600",
            amber: "text-amber-600",
            copper: "text-copper",
            bio: "text-bio",
            purple: "text-purple-600",
            green: "text-green-600",
          };

          return (
            <Card
              key={idx}
              className={`p-3 bg-gradient-to-br ${bgColors[card.color] || bgColors.emerald}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">
                    {card.label}
                  </p>
                  <div className="flex items-baseline gap-1">
                    <p className={`text-2xl font-bold ${textColors[card.color] || textColors.emerald}`}>
                      {card.value}
                    </p>
                    {card.total && (
                      <p className="text-xs text-muted-foreground">
                        /{card.total}
                      </p>
                    )}
                  </div>
                  {card.benchmark && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Meta: {card.benchmark}
                    </p>
                  )}
                </div>
                <Icon className={`h-5 w-5 ${textColors[card.color] || textColors.emerald} opacity-30 shrink-0`} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Insights */}
      <Card className="p-4 bg-gradient-to-r from-blue-50/50 to-purple-50/50 border-blue-200/30">
        <div className="space-y-2">
          <p className="font-semibold text-sm text-foreground">
            💡 Insights operacionales
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {metrics.filled_offers === metrics.total_offers && metrics.total_offers > 0 && (
              <li>✅ Todas tus ofertas están cubiertas - ¡excelente desempeño!</li>
            )}
            {metrics.conversion_rate > 50 && (
              <li>🎯 Conversión alta: captas a buenos candidatos</li>
            )}
            {metrics.avg_time_to_hire_days < 7 && metrics.avg_time_to_hire_days > 0 && (
              <li>⚡ Tiempo de contratación muy eficiente</li>
            )}
            {metrics.active_offers === 0 && (
              <li>📝 Publica más ofertas para aumentar el flujo de candidatos</li>
            )}
            {metrics.pending_applicants > 10 && (
              <li>🔔 Tienes muchas aplicaciones pendientes de revisar</li>
            )}
          </ul>
        </div>
      </Card>
    </div>
  );
}
