// Estado esperado de la base de datos deducido de los archivos de `supabase/migrations/` y la «sonda» de solo lectura que lo compara
// con una base real (producción, un entorno nuevo o la réplica local).
//
// Para qué sirve: el repositorio tiene dos cadenas de migraciones (ver docs/MIGRACIONES.md) y producción no aplica sola la de
// `supabase/migrations/`. Esta herramienta responde, sin escribir nada, «¿lo que dicen los archivos es lo que hay en la base?».
//
// Qué entiende: sentencias de primer nivel `CREATE/DROP` de tablas, vistas, funciones, políticas, disparadores e índices, columnas
// (de `CREATE TABLE` y de `ALTER TABLE … ADD/DROP/RENAME COLUMN`) y `ALTER PUBLICATION supabase_realtime ADD TABLE`. Qué NO entiende
// (y por eso no sondea): el SQL dinámico y los bloques `DO $$ … $$` (condicionales), el cuerpo de las funciones y los privilegios.
// Solo mira el esquema `public`.
//
// Es lógica pura (sin red ni archivos): `scripts/migration-drift-probe.ts` la usa con los archivos reales.

export type ObjectKind =
  | "table"
  | "view"
  | "function"
  | "policy"
  | "trigger"
  | "index"
  | "column"
  | "realtime";

export interface SqlOp {
  op: "create" | "drop";
  kind: ObjectKind;
  name: string;
  /** Tabla a la que pertenece (políticas, disparadores, índices, columnas y publicación); vacío en tablas, vistas y funciones. */
  table: string;
  /** Solo funciones: número de argumentos de entrada (distingue sobrecargas). */
  arity?: number;
}

export interface ExpectedObject extends Omit<SqlOp, "op"> {
  /** ¿Debe existir? `false` = una migración posterior lo eliminó (y no lo volvió a crear). */
  exists: boolean;
  /** Versión (los 14 dígitos del nombre del archivo) de la última migración que lo creó o eliminó. */
  migration: string;
}

export interface MigrationFile {
  /** Nombre del archivo, p. ej. `20261013120000_institution_members.sql`. */
  name: string;
  sql: string;
}

// ─── Limpieza del texto ────────────────────────────────────────────────────────

/**
 * Quita comentarios, vacía las cadenas `'…'` y los cuerpos entre dólares (`$$ … $$`, `$fn$ … $fn$`) y deja los identificadores entre
 * comillas dobles. Así ninguna expresión regular confunde el contenido de un texto o de una función con una sentencia.
 */
export function sanitizeSql(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end !== -1) {
          out += "$$$$";
          i = end + tag.length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Sentencias de primer nivel (separadas por `;`) del SQL ya limpio. */
export function splitStatements(clean: string): string[] {
  return clean
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Identificadores ───────────────────────────────────────────────────────────

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`(?:(${IDENT})\s*\.\s*)?(${IDENT})`;

/** `"Mi Nombre"` → `Mi Nombre`; sin comillas se pliega a minúsculas (como hace PostgreSQL). */
export function unquoteIdent(id: string): string {
  const t = id.trim();
  return t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t.toLowerCase();
}

/** Devuelve el nombre si el objeto está en `public` (o sin esquema); `null` si es de otro esquema. */
function publicName(schema: string | undefined, name: string): string | null {
  const s = schema ? unquoteIdent(schema) : "public";
  return s === "public" ? unquoteIdent(name) : null;
}

const re = (pattern: string) => new RegExp(pattern, "i");

// ─── Argumentos y columnas ─────────────────────────────────────────────────────

/** Divide por comas de primer nivel (no las que están dentro de paréntesis). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Contenido del primer par de paréntesis balanceados a partir de `from` (o `null`). */
function balanced(text: string, from: number): { inner: string; end: number } | null {
  const open = text.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Cuántos argumentos de ENTRADA declara una lista de argumentos de función (descarta los `OUT`/`TABLE`). */
export function countFunctionArgs(argList: string): number {
  return splitTopLevel(argList).filter((a) => !/^out\s/i.test(a)).length;
}

const CONSTRAINT_START = /^(constraint|primary|foreign|unique|check|like|exclude)\b/i;

/** Nombres de las columnas declaradas en el cuerpo de un `CREATE TABLE`. */
export function tableColumnNames(body: string): string[] {
  const names: string[] = [];
  for (const item of splitTopLevel(body)) {
    if (CONSTRAINT_START.test(item)) continue;
    const m = new RegExp(`^(${IDENT})\\s`).exec(item + " ");
    if (m) names.push(unquoteIdent(m[1]));
  }
  return names;
}

// ─── Operaciones de una sentencia ──────────────────────────────────────────────

function op(
  kind: ObjectKind,
  action: "create" | "drop",
  name: string,
  table = "",
  arity?: number,
): SqlOp {
  return arity === undefined
    ? { op: action, kind, name, table }
    : { op: action, kind, name, table, arity };
}

/** Qué crea o elimina una sentencia (ya limpia). Lo que no entiende no genera operaciones. */
export function statementOps(stmt: string): SqlOp[] {
  const ops: SqlOp[] = [];
  let m: RegExpExecArray | null;

  // CREATE TABLE
  if (
    (m = re(
      String.raw`^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}`,
    ).exec(stmt))
  ) {
    if (/^create\s+(?:global\s+|local\s+)?(?:temp|temporary)\b/i.test(stmt)) return ops;
    const table = publicName(m[1], m[2]);
    if (table) {
      ops.push(op("table", "create", table));
      const body = /^\s*(?:partition\s+of\b|as\b)/i.test(stmt.slice(m[0].length))
        ? null
        : balanced(stmt, m[0].length);
      if (body)
        for (const c of tableColumnNames(body.inner)) ops.push(op("column", "create", c, table));
    }
    return ops;
  }

  // CREATE VIEW
  if (
    (m = re(
      String.raw`^create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(?:recursive\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QNAME}`,
    ).exec(stmt))
  ) {
    const name = publicName(m[1], m[2]);
    if (name && !/^create\s+(?:or\s+replace\s+)?temp/i.test(stmt))
      ops.push(op("view", "create", name));
    return ops;
  }

  // CREATE FUNCTION / PROCEDURE
  if (
    (m = re(String.raw`^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${QNAME}\s*\(`).exec(
      stmt,
    ))
  ) {
    const name = publicName(m[1], m[2]);
    const args = balanced(stmt, m[0].length - 1);
    if (name && args) ops.push(op("function", "create", name, "", countFunctionArgs(args.inner)));
    return ops;
  }

  // CREATE POLICY
  if ((m = re(String.raw`^create\s+policy\s+(${IDENT})\s+on\s+${QNAME}`).exec(stmt))) {
    const table = publicName(m[2], m[3]);
    if (table) ops.push(op("policy", "create", unquoteIdent(m[1]), table));
    return ops;
  }

  // CREATE TRIGGER
  if (
    (m = re(
      String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s+(?:before|after|instead\s+of)\s+[\s\S]*?\bon\s+${QNAME}`,
    ).exec(stmt))
  ) {
    const table = publicName(m[2], m[3]);
    if (table) ops.push(op("trigger", "create", unquoteIdent(m[1]), table));
    return ops;
  }

  // CREATE INDEX
  if (
    (m = re(
      String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+on\s+(?:only\s+)?${QNAME}`,
    ).exec(stmt))
  ) {
    const table = publicName(m[2], m[3]);
    if (table) ops.push(op("index", "create", unquoteIdent(m[1]), table));
    return ops;
  }

  // ALTER PUBLICATION supabase_realtime ADD TABLE a, b
  if (
    (m = re(
      String.raw`^alter\s+publication\s+supabase_realtime\s+add\s+table\s+(?:only\s+)?([\s\S]+)$`,
    ).exec(stmt))
  ) {
    for (const item of splitTopLevel(m[1])) {
      // `ONLY` puede ir en cada tabla de la lista.
      const q = new RegExp(`^(?:only\\s+)?${QNAME}`, "i").exec(item);
      const table = q ? publicName(q[1], q[2]) : null;
      if (table) ops.push(op("realtime", "create", table, table));
    }
    return ops;
  }

  // ALTER TABLE … ADD/DROP/RENAME COLUMN · RENAME TO
  if (
    (m = re(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s+([\s\S]+)$`).exec(
      stmt,
    ))
  ) {
    const table = publicName(m[1], m[2]);
    if (!table) return ops;
    const rest = m[3];
    const rename = re(String.raw`^rename\s+to\s+(${IDENT})\s*$`).exec(rest);
    if (rename) {
      ops.push(op("table", "drop", table), op("table", "create", unquoteIdent(rename[1])));
      return ops;
    }
    const renameCol = re(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})\s*$`).exec(
      rest,
    );
    if (renameCol) {
      ops.push(
        op("column", "drop", unquoteIdent(renameCol[1]), table),
        op("column", "create", unquoteIdent(renameCol[2]), table),
      );
      return ops;
    }
    for (const item of splitTopLevel(rest)) {
      const add = re(String.raw`^add\s+column\s+(?:if\s+not\s+exists\s+)?(${IDENT})`).exec(item);
      if (add) ops.push(op("column", "create", unquoteIdent(add[1]), table));
      const drop = re(String.raw`^drop\s+column\s+(?:if\s+exists\s+)?(${IDENT})`).exec(item);
      if (drop) ops.push(op("column", "drop", unquoteIdent(drop[1]), table));
    }
    return ops;
  }

  // DROP TABLE / VIEW / INDEX (listas separadas por comas)
  if (
    (m = re(
      String.raw`^drop\s+(table|view|materialized\s+view|index)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([\s\S]+)$`,
    ).exec(stmt))
  ) {
    const kind: ObjectKind = /index/i.test(m[1]) ? "index" : /table/i.test(m[1]) ? "table" : "view";
    for (const item of splitTopLevel(m[2].replace(/\s+(cascade|restrict)\s*$/i, ""))) {
      const q = new RegExp(`^${QNAME}`, "i").exec(item);
      const name = q ? publicName(q[1], q[2]) : null;
      if (name) ops.push(op(kind, "drop", name));
    }
    return ops;
  }

  // DROP FUNCTION f(args), g(args)
  if (
    (m = re(String.raw`^drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?([\s\S]+)$`).exec(stmt))
  ) {
    let rest = m[1].replace(/\s+(cascade|restrict)\s*$/i, "");
    while (rest.trim()) {
      const q = new RegExp(`^\\s*${QNAME}\\s*`, "i").exec(rest);
      if (!q) break;
      const name = publicName(q[1], q[2]);
      let consumed = q[0].length;
      let arity: number | undefined;
      if (rest[consumed] === "(") {
        const args = balanced(rest, consumed);
        if (!args) break;
        arity = countFunctionArgs(args.inner);
        consumed = args.end;
      }
      if (name && arity !== undefined) ops.push(op("function", "drop", name, "", arity));
      rest = rest.slice(consumed).replace(/^\s*,/, "");
    }
    return ops;
  }

  // DROP POLICY / TRIGGER
  if (
    (m = re(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QNAME}`).exec(stmt))
  ) {
    const table = publicName(m[2], m[3]);
    if (table) ops.push(op("policy", "drop", unquoteIdent(m[1]), table));
    return ops;
  }
  if (
    (m = re(String.raw`^drop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QNAME}`).exec(stmt))
  ) {
    const table = publicName(m[2], m[3]);
    if (table) ops.push(op("trigger", "drop", unquoteIdent(m[1]), table));
    return ops;
  }

  return ops;
}

/** Operaciones, en orden, de un archivo de migración. */
export function fileOps(sql: string): SqlOp[] {
  return splitStatements(sanitizeSql(sql)).flatMap(statementOps);
}

// ─── Estado final esperado ─────────────────────────────────────────────────────

const keyOf = (o: Pick<SqlOp, "kind" | "name" | "table" | "arity">) =>
  `${o.kind}|${o.table}|${o.name}|${o.kind === "function" ? o.arity : ""}`;

/** Versión (14 dígitos) del nombre del archivo; el nombre completo si no la tiene. */
export function migrationVersion(fileName: string): string {
  return /^(\d{14})/.exec(fileName)?.[1] ?? fileName;
}

/**
 * Pliega las migraciones (en el orden dado) y devuelve lo que debe haber al final. Lo que se creó y luego se eliminó queda con
 * `exists: false`; al eliminar una tabla se olvida lo que dependía de ella (columnas, políticas, disparadores, índices).
 */
export function expectedState(files: MigrationFile[]): ExpectedObject[] {
  const state = new Map<string, ExpectedObject>();
  for (const file of files) {
    const migration = migrationVersion(file.name);
    for (const o of fileOps(file.sql)) {
      if (o.op === "drop" && o.kind === "table") {
        for (const [k, v] of state) {
          if (
            v.table === o.name &&
            v.kind !== "table" &&
            v.kind !== "function" &&
            v.kind !== "view"
          )
            state.delete(k);
        }
      }
      const { op: action, ...rest } = o;
      state.set(keyOf(o), { ...rest, exists: action === "create", migration });
    }
  }
  return [...state.values()];
}

/** Versiones (ordenadas) de los archivos que alcanzan o superan `from` (14 dígitos). */
export function filesFrom(files: MigrationFile[], from: string): MigrationFile[] {
  return [...files]
    .filter((f) => migrationVersion(f.name) >= from)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Sonda (SQL de solo lectura) ───────────────────────────────────────────────

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Un único `SELECT` de solo lectura que devuelve una fila JSON `{ revisados, faltan, detalle }`. `detalle` lista lo que no coincide
 * con lo esperado (falta lo que debería existir, o existe lo que debería haberse eliminado).
 */
export function buildProbeSql(items: ExpectedObject[]): string {
  const rows = items
    .map(
      (i) =>
        `(${lit(i.migration)},${lit(i.kind)},${lit(i.name)},${lit(i.table)},${i.arity ?? "null"},${i.exists})`,
    )
    .join(",\n");
  return `select jsonb_build_object(
  'revisados', count(*),
  'faltan', count(*) filter (where c.hay is distinct from c.espera),
  'detalle', coalesce(jsonb_agg(jsonb_build_object('migracion', c.m, 'tipo', c.k, 'nombre', c.n, 'tabla', c.t, 'espera', c.espera, 'hay', c.hay) order by c.m, c.k, c.n) filter (where c.hay is distinct from c.espera), '[]'::jsonb)
) as resultado
from (
  select e.m, e.k, e.n, e.t, e.espera,
    case e.k
      when 'table' then to_regclass(format('public.%I', e.n)) is not null
      when 'view' then to_regclass(format('public.%I', e.n)) is not null
      when 'index' then to_regclass(format('public.%I', e.n)) is not null
      when 'function' then exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = e.n and p.pronargs = e.a::int)
      when 'policy' then exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = e.t and x.policyname = e.n)
      when 'trigger' then exists (select 1 from pg_trigger g join pg_class r on r.oid = g.tgrelid join pg_namespace s on s.oid = r.relnamespace where not g.tgisinternal and g.tgname = e.n and r.relname = e.t and s.nspname = 'public')
      when 'column' then exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = e.t and x.column_name = e.n)
      when 'realtime' then exists (select 1 from pg_publication_tables x where x.pubname = 'supabase_realtime' and x.schemaname = 'public' and x.tablename = e.n)
    end as hay
  from (values
${rows}
  ) as e(m, k, n, t, a, espera)
) c;`;
}

/** Parte la lista en trozos de `size` elementos (los pedidos de SQL muy largos se rechazan en algunos clientes). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─── Guarda: funciones delegadas ───────────────────────────────────────────────

export interface UnguardedRedefinition {
  migration: string;
  fn: string;
}

/**
 * Migraciones posteriores a `afterVersion` que vuelven a crear alguna de las funciones `names` SIN mencionar `marker`.
 * Sirve para que nadie re-cree (con `CREATE OR REPLACE`) una de las seis funciones que la migración del personal parchó con
 * `hx_acting_institution`: al hacerlo se perdería, sin avisar, la delegación al personal.
 */
export function findUnguardedRedefinitions(
  files: MigrationFile[],
  names: readonly string[],
  marker: string,
  afterVersion: string,
): UnguardedRedefinition[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const found: UnguardedRedefinition[] = [];
  for (const file of files) {
    const version = migrationVersion(file.name);
    if (version <= afterVersion) continue;
    const mentionsMarker = sanitizeSqlKeepingBodies(file.sql)
      .toLowerCase()
      .includes(marker.toLowerCase());
    for (const o of fileOps(file.sql)) {
      if (o.op === "create" && o.kind === "function" && wanted.has(o.name) && !mentionsMarker) {
        found.push({ migration: version, fn: o.name });
      }
    }
  }
  return found;
}

/** Quita solo los comentarios (el cuerpo de las funciones SÍ cuenta para buscar la marca). */
function sanitizeSqlKeepingBodies(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}
