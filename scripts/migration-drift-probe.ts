// Sonda de deriva: compara lo que dicen los archivos de `supabase/migrations/` con la base de datos real, SIN escribir nada.
//
//   bun run scripts/migration-drift-probe.ts                 # resumen de lo que se espera (no toca ninguna base)
//   bun run scripts/migration-drift-probe.ts --sql           # imprime los SELECT de solo lectura para ejecutarlos en la base
//   bun run scripts/migration-drift-probe.ts --from 20260601000000 --to 20261007000000 --chunk 150 --sql   # solo un tramo
//   bun run scripts/migration-drift-probe.ts --to 20261007000000 --kinds table,function,view,trigger,realtime --sql   # solo el «esqueleto»
//
// Cada SELECT devuelve una fila JSON `{ revisados, faltan, detalle }`. `faltan: 0` = esa parte coincide. Ver docs/MIGRACIONES.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProbeSql,
  chunk,
  expectedState,
  filesFrom,
  type ExpectedObject,
  type MigrationFile,
} from "../src/lib/migrationProbe";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dir = join(import.meta.dir, "..", "supabase", "migrations");
const all: MigrationFile[] = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));

const from = value("from", "20261007000000");
const to = value("to", "99999999999999"); // exclusivo: sirve para revisar un tramo de la cadena
const size = Math.max(10, Number(value("chunk", "150")) || 150);
// El estado se calcula con TODAS las migraciones (para que un DROP posterior se tenga en cuenta) y se sondea desde `from`.
const kinds = value("kinds", "") ? value("kinds", "").split(",") : null; // p. ej. table,function,view,trigger,realtime
const expected: ExpectedObject[] = expectedState(all).filter(
  (o) => o.migration >= from && o.migration < to && (!kinds || kinds.includes(o.kind)),
);

const byKind = new Map<string, number>();
for (const o of expected)
  byKind.set(
    `${o.kind}${o.exists ? "" : " (eliminado)"}`,
    (byKind.get(`${o.kind}${o.exists ? "" : " (eliminado)"}`) ?? 0) + 1,
  );

if (!flag("sql")) {
  console.log(
    `Migraciones desde ${from}: ${filesFrom(all, from).length} archivos → ${expected.length} objetos esperados`,
  );
  for (const [k, n] of [...byKind].sort()) console.log(`  ${k.padEnd(22)} ${n}`);
  console.log("\nUsa --sql para imprimir los SELECT de solo lectura.");
} else {
  const parts = chunk(expected, size);
  parts.forEach((part, i) => {
    console.log(`-- ==== sonda ${i + 1}/${parts.length} (${part.length} objetos) ====`);
    console.log(buildProbeSql(part));
    console.log("");
  });
}
