// Barras por mes (lo hecho y lo acordado) con descripción completa para lector de pantalla y tabla oculta. La usan el
// presupuesto de la familia, los ingresos del profesional y los costos de la institución.
import { hoursEs } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export interface MonthBar {
  key: string;
  label: string;
  settled: number;
  committed: number;
  hours: number;
  isCurrent: boolean;
}

export function MonthBars({
  months,
  title,
  settledLabel,
  committedLabel,
  emptyText,
  colorClass = "trust",
}: {
  months: MonthBar[];
  /** «Gasto por mes», «Ingresos por mes»… */
  title: string;
  /** «Gastado», «Ganado»… */
  settledLabel: string;
  committedLabel: string;
  emptyText: string;
  colorClass?: "trust" | "ok" | "copper";
}) {
  const max = Math.max(0, ...months.map((m) => m.settled + m.committed));
  const solid = { trust: "bg-trust", ok: "bg-ok", copper: "bg-copper" }[colorClass];
  const soft = { trust: "bg-trust/40", ok: "bg-ok/40", copper: "bg-copper/40" }[colorClass];
  const cols = months.length;

  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-sm font-semibold">Últimos {cols} meses</h4>
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div
            className="grid h-28 items-end gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`${title}: ${months
              .map(
                (m) =>
                  `${m.label} ${formatCOP(m.settled)} ${settledLabel.toLowerCase()} y ${formatCOP(m.committed)} ${committedLabel.toLowerCase()}`,
              )
              .join("; ")}`}
          >
            {months.map((m) => (
              <div
                key={m.key}
                className="flex h-full flex-col justify-end gap-px"
                aria-hidden="true"
              >
                <div
                  className={cn("w-full rounded-t", soft)}
                  style={{ height: `${(m.committed / max) * 100}%` }}
                />
                <div
                  className={cn("w-full", solid, m.committed === 0 && "rounded-t")}
                  style={{ height: `${(m.settled / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div
            className="grid gap-2 text-center text-[10px] text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {months.map((m) => (
              <span key={m.key} className={cn(m.isCurrent && "font-bold text-foreground")}>
                {m.label.split(" ")[0]}
              </span>
            ))}
          </div>
          <p className="flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", solid)} aria-hidden="true" /> {settledLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", soft)} aria-hidden="true" />{" "}
              {committedLabel}
            </span>
          </p>
          {/* La tabla va dentro de un div «sr-only»: sola, una tabla no se recorta y ensancha la página en pantallas angostas. */}
          <div className="sr-only">
            <table>
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>{settledLabel}</th>
                  <th>{committedLabel}</th>
                  <th>Horas</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td>{formatCOP(m.settled)}</td>
                    <td>{formatCOP(m.committed)}</td>
                    <td>{hoursEs(m.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
