import { type ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus, Wifi, WifiOff } from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";

export type VitalStatus = "normal" | "warning" | "critical" | "unknown";
export type VitalTrend = "up" | "down" | "stable";

export interface VitalDataPoint {
  value: number;
  recorded_at: string;
}

interface Props {
  icon: ReactNode;
  label: string;
  value: number | null;
  unit: string;
  status: VitalStatus;
  trend?: VitalTrend;
  history?: VitalDataPoint[];
  normalRange?: string;
  className?: string;
  online?: boolean;
  lastUpdated?: string;
  compact?: boolean;
  minRef?: number;
  maxRef?: number;
}

const STATUS_BORDER: Record<VitalStatus, string> = {
  normal: "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/5",
  warning: "border-amber-400/50 bg-amber-500/5 dark:bg-amber-500/5",
  critical: "border-red-500/50 bg-red-500/5 dark:bg-red-500/5",
  unknown: "border-border bg-muted/5",
};

const STATUS_BADGE: Record<VitalStatus, { label: string; cls: string }> = {
  normal: {
    label: "Normal",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  warning: {
    label: "Alerta",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  critical: {
    label: "Crítico",
    cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20 animate-pulse",
  },
  unknown: {
    label: "Sin datos",
    cls: "bg-muted/50 text-muted-foreground border-border",
  },
};

const STATUS_LINE: Record<VitalStatus, string> = {
  normal: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
  unknown: "#6b7280",
};

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

export function VitalSignsPanel({
  icon,
  label,
  value,
  unit,
  status,
  trend,
  history = [],
  normalRange,
  className,
  online = true,
  lastUpdated,
  compact = false,
  minRef,
  maxRef,
}: Props) {
  const badge = STATUS_BADGE[status];
  const lineColor = STATUS_LINE[status];
  const chartData = history.slice(-24).map((d, i) => ({ i, v: d.value }));
  const TrendIcon = trend ? TREND_ICON[trend] : null;

  const trendColor =
    status === "critical"
      ? "text-red-500"
      : trend === "up"
        ? "text-emerald-500"
        : trend === "down"
          ? "text-amber-500"
          : "text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300",
        compact ? "p-3" : "p-4",
        STATUS_BORDER[status],
        status === "critical" && "shadow-[0_0_12px_rgba(239,68,68,0.2)]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span className={compact ? "text-sm" : "text-base"}>{icon}</span>
          {label}
        </div>
        <div className="flex items-center gap-1.5">
          {online ? (
            <Wifi className="h-3 w-3 text-emerald-500" />
          ) : (
            <WifiOff className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border",
              badge.cls,
            )}
          >
            {badge.label}
          </span>
        </div>
      </div>

      {/* Value */}
      <div className="flex items-end gap-1.5 mb-2">
        <span
          className={cn(
            "font-bold font-display tabular-nums leading-none",
            compact ? "text-2xl" : "text-3xl",
          )}
        >
          {value !== null ? value.toLocaleString("es-CO", { maximumFractionDigits: 1 }) : "–"}
        </span>
        <span className="text-xs text-muted-foreground mb-0.5">{unit}</span>
        {TrendIcon && (
          <span className={cn("ml-auto mb-0.5", trendColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {/* Sparkline */}
      {!compact && chartData.length > 2 && (
        <div className="mt-1 -mx-1">
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={chartData}>
              {minRef !== undefined && (
                <ReferenceLine y={minRef} stroke={lineColor} strokeDasharray="3 2" strokeOpacity={0.5} />
              )}
              {maxRef !== undefined && (
                <ReferenceLine y={maxRef} stroke={lineColor} strokeDasharray="3 2" strokeOpacity={0.5} />
              )}
              <Line
                type="monotone"
                dataKey="v"
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="text-xs bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
                      {Number(payload[0].value).toLocaleString("es-CO", { maximumFractionDigits: 1 })}{" "}
                      {unit}
                    </div>
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footer */}
      {(normalRange || lastUpdated) && (
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
          {normalRange && <span>Rango: {normalRange}</span>}
          {lastUpdated && <span className="ml-auto">{lastUpdated}</span>}
        </div>
      )}
    </div>
  );
}
