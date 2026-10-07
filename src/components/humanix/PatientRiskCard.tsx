/**
 * PatientRiskCard — Motor de riesgo clínico con IA
 * Módulo 6: Humanix AI · Análisis de tendencias · Score de riesgo
 */
import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeRisk, type VitalReading } from "@/lib/patientRisk";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import ReactMarkdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

interface RiskFactor {
  name: string;
  weight: number;        // 0-100
  value: string | number;
  description?: string;
  direction?: "increase" | "decrease" | "neutral";
}

interface RiskScore {
  id: string;
  patient_id: string;
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  ai_summary: string;
  recommendations: Array<{ priority: string; action: string; rationale?: string }>;
  trend: "improving" | "stable" | "worsening";
  previous_score?: number;
  calculated_at: string;
}

// ─── Risk level config ─────────────────────────────────────────────────────────

const RISK_CONFIG: Record<RiskLevel, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  textColor: string;
}> = {
  low: {
    label: "Riesgo Bajo",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    textColor: "text-emerald-700 dark:text-emerald-300",
    icon: <ShieldCheck className="h-5 w-5 text-emerald-500" />,
  },
  medium: {
    label: "Riesgo Moderado",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    textColor: "text-amber-700 dark:text-amber-300",
    icon: <ShieldAlert className="h-5 w-5 text-amber-500" />,
  },
  high: {
    label: "Riesgo Alto",
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    textColor: "text-orange-700 dark:text-orange-300",
    icon: <ShieldAlert className="h-5 w-5 text-orange-500" />,
  },
  critical: {
    label: "Riesgo Crítico",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/40",
    textColor: "text-red-700 dark:text-red-300",
    icon: <ShieldX className="h-5 w-5 text-red-500" />,
  },
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent:  "bg-red-500/10 text-red-600 dark:text-red-400",
  high:    "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  medium:  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low:     "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

// ─── Score gauge ──────────────────────────────────────────────────────────────

function ScoreGauge({ score, level }: { score: number; level: RiskLevel }) {
  const cfg = RISK_CONFIG[level];
  const rotation = -135 + (score / 100) * 270;

  const arcColor =
    level === "low"
      ? "#10b981"
      : level === "medium"
        ? "#f59e0b"
        : level === "high"
          ? "#f97316"
          : "#ef4444";

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-20 overflow-hidden">
        <svg viewBox="0 0 100 60" className="w-full h-full">
          {/* Background arc */}
          <path
            d="M 10 55 A 40 40 0 1 1 90 55"
            fill="none"
            stroke="currentColor"
            className="text-muted/30"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Score arc */}
          <path
            d="M 10 55 A 40 40 0 1 1 90 55"
            fill="none"
            stroke={arcColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 188} 188`}
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
          {/* Needle */}
          <g transform={`rotate(${rotation}, 50, 55)`}>
            <line x1="50" y1="55" x2="50" y2="20" stroke={arcColor} strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="50" cy="55" r="3" fill={arcColor} />
          </g>
          {/* Score text */}
          <text x="50" y="52" textAnchor="middle" fontSize="14" fontWeight="bold" fill={arcColor}>
            {Math.round(score)}
          </text>
        </svg>
      </div>
      <div className="flex items-center gap-1.5 -mt-1">
        {cfg.icon}
        <span className={cn("text-xs font-bold", cfg.color)}>{cfg.label}</span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  patientId: string;
  patientName?: string;
  compact?: boolean;
}

export function PatientRiskCard({ patientId, patientName, compact = false }: Props) {
  const [riskData, setRiskData] = useState<RiskScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showFactors, setShowFactors] = useState(!compact);
  const [showRecommendations, setShowRecommendations] = useState(!compact);

  const loadLatestScore = useCallback(async () => {
    if (!patientId) return;
    try {
      const { data, error } = await sb
        .from("patient_risk_scores")
        .select("*")
        .eq("patient_id", patientId)
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) setRiskData(data as RiskScore);
    } catch (err) {
      console.warn("[PatientRiskCard] loadLatestScore:", err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadLatestScore();
  }, [loadLatestScore]);

  const generateRiskScore = async () => {
    setGenerating(true);
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: readings, error: rErr } = await sb
        .from("vital_signs")
        .select("type, value, recorded_at")
        .eq("patient_id", patientId)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false })
        .limit(500);
      if (rErr) throw rErr;

      const previousScore = riskData?.score ?? null;
      const result = computeRisk((readings ?? []) as VitalReading[], previousScore);
      if (!result) {
        toast.info("Sin mediciones de los últimos 7 días para calcular el riesgo.");
        return;
      }

      const { data, error } = await sb
        .from("patient_risk_scores")
        .insert({
          patient_id: patientId,
          score: result.score,
          level: result.level,
          factors: result.factors,
          ai_summary: result.summary,
          recommendations: result.recommendations,
          trend: result.trend,
          previous_score: previousScore,
          calculated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      if (data) setRiskData(data as RiskScore);
    } catch (err) {
      console.error("[PatientRiskCard] generateRiskScore:", err);
      toast.error("No se pudo calcular el riesgo. Inténtalo de nuevo.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!riskData) {
    return (
      <Card className="p-6 border-dashed text-center space-y-3">
        <div className="h-10 w-10 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Sin alertas calculadas</p>
          <p className="text-xs text-muted-foreground mt-1">
            Calcula alertas con reglas sobre las mediciones de los últimos 7 días. Es una ayuda de seguimiento, no un diagnóstico.
          </p>
        </div>
        <Button size="sm" onClick={generateRiskScore} disabled={generating} className="gap-1">
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Calcular alertas
        </Button>
      </Card>
    );
  }

  const cfg = RISK_CONFIG[riskData.level];
  const scoreDelta = riskData.previous_score !== undefined && riskData.previous_score !== null
    ? riskData.score - riskData.previous_score
    : null;

  return (
    <Card className={cn("border overflow-hidden", cfg.borderColor)}>
      {/* Header */}
      <div className={cn("p-4 border-b border-border/50", cfg.bgColor)}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Alertas por signos vitales
              {patientName && ` · ${patientName}`}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <ScoreGauge score={riskData.score} level={riskData.level} />
              <div className="space-y-1">
                {/* Trend */}
                {riskData.trend && (
                  <div className="flex items-center gap-1 text-xs">
                    {riskData.trend === "improving" ? (
                      <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
                    ) : riskData.trend === "worsening" ? (
                      <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground capitalize">
                      {riskData.trend === "improving"
                        ? "Mejorando"
                        : riskData.trend === "worsening"
                          ? "Empeorando"
                          : "Estable"}
                    </span>
                  </div>
                )}
                {scoreDelta !== null && (
                  <p className={cn("text-xs font-medium", scoreDelta < 0 ? "text-emerald-500" : scoreDelta > 0 ? "text-red-500" : "text-muted-foreground")}>
                    {scoreDelta > 0 ? "+" : ""}{scoreDelta.toFixed(0)} pts vs. anterior
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(riskData.calculated_at), { locale: es, addSuffix: true })}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={generateRiskScore}
              disabled={generating}
              className="h-7 text-xs gap-1"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Actualizar
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* AI Summary */}
        {riskData.ai_summary && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              Resumen Clínico IA
            </p>
            <div className="text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-xl p-3 prose prose-sm max-w-none prose-p:my-0">
              <ReactMarkdown>{riskData.ai_summary}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Risk factors */}
        {riskData.factors && riskData.factors.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowFactors(!showFactors)}
              className="w-full flex items-center justify-between text-xs font-semibold"
            >
              <span className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                Factores de riesgo ({riskData.factors.length})
              </span>
              {showFactors ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {showFactors && (
              <div className="space-y-2">
                {riskData.factors.map((factor, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium flex items-center gap-1">
                        {factor.direction === "increase" && (
                          <TrendingUp className="h-3 w-3 text-red-400" />
                        )}
                        {factor.direction === "decrease" && (
                          <TrendingDown className="h-3 w-3 text-amber-400" />
                        )}
                        {(!factor.direction || factor.direction === "neutral") && (
                          <Minus className="h-3 w-3 text-muted-foreground" />
                        )}
                        {factor.name}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{factor.value}</span>
                    </div>
                    <Progress
                      value={factor.weight}
                      className="h-1.5"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recommendations */}
        {riskData.recommendations && riskData.recommendations.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowRecommendations(!showRecommendations)}
              className="w-full flex items-center justify-between text-xs font-semibold"
            >
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Recomendaciones ({riskData.recommendations.length})
              </span>
              {showRecommendations ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {showRecommendations && (
              <div className="space-y-2">
                {riskData.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-xl bg-muted/30 border border-border/50">
                    <span
                      className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5",
                        PRIORITY_BADGE[rec.priority] ?? PRIORITY_BADGE.low,
                      )}
                    >
                      {rec.priority.toUpperCase()}
                    </span>
                    <div>
                      <p className="text-xs font-medium">{rec.action}</p>
                      {rec.rationale && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{rec.rationale}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
