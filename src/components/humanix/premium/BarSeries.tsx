// Barras de una serie (por día o por semana) con descripción completa para lector de pantalla y tabla oculta. Las usan
// los resúmenes del portal de la institución; el color es de los tokens del tema, no un valor suelto.
import { plural } from "@/lib/intelShared";
import { cn } from "@/lib/utils";

export interface BarPoint {
  key: string | number;
  /** «14 oct». */
  label: string;
  value: number;
}

const COLOR = {
  trust: "bg-trust",
  ok: "bg-ok",
  sos: "bg-sos",
  warn: "bg-warn",
  copper: "bg-copper",
} as const;

export function BarSeries({
  title,
  points,
  unit,
  emptyText,
  colorClass = "trust",
  firstColumn = "Día",
  className,
}: {
  /** «Servicios terminados por día». */
  title: string;
  points: BarPoint[];
  /** Cómo se llama lo que se cuenta, en singular y plural: «servicio», «servicios». */
  unit: [one: string, many: string];
  emptyText: string;
  colorClass?: keyof typeof COLOR;
  /** Encabezado de la primera columna de la tabla oculta: «Día» o «Semana desde». */
  firstColumn?: string;
  className?: string;
}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  const peak = points.reduce<BarPoint | null>((a, p) => (p.value > (a?.value ?? 0) ? p : a), null);
  const middle = points[Math.floor((points.length - 1) / 2)];

  return (
    <section aria-label={title} className={cn("space-y-2", className)}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div
            className="grid h-24 items-end gap-px"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`${title}: ${plural(total, unit[0], unit[1])} en total; el máximo fue ${peak?.label} con ${peak?.value}.`}
          >
            {points.map((p) => (
              <div key={p.key} className="flex h-full flex-col justify-end" aria-hidden="true">
                {p.value > 0 && (
                  <div
                    className={cn("w-full rounded-t-sm", COLOR[colorClass])}
                    style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
                  />
                )}
              </div>
            ))}
          </div>
          <div
            className="flex justify-between text-[10px] text-muted-foreground"
            aria-hidden="true"
          >
            <span>{points[0].label}</span>
            <span>{middle.label}</span>
            <span>{points[points.length - 1].label}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {plural(total, unit[0], unit[1])} en total · máximo: {peak?.label} ({peak?.value}).
          </p>
          {/* La tabla va dentro de un div «sr-only»: sola, una tabla no se recorta y ensancha la página en pantallas angostas. */}
          <div className="sr-only">
            <table>
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th>{firstColumn}</th>
                  <th>{unit[1]}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td>{p.value}</td>
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
