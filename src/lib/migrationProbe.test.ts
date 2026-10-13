import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildProbeSql,
  chunk,
  countFunctionArgs,
  expectedState,
  fileOps,
  filesFrom,
  findUnguardedRedefinitions,
  migrationVersion,
  sanitizeSql,
  splitStatements,
  statementOps,
  tableColumnNames,
  unquoteIdent,
  type ExpectedObject,
  type MigrationFile,
} from "./migrationProbe";

const file = (name: string, sql: string): MigrationFile => ({ name, sql });
const find = (state: ExpectedObject[], kind: string, name: string, table = "") =>
  state.find((o) => o.kind === kind && o.name === name && o.table === table);

describe("sanitizeSql", () => {
  it("quita comentarios de línea y de bloque (también anidados)", () => {
    const out = sanitizeSql(
      "select 1; -- create table x\n/* create table y /* z */ w */ select 2;",
    );
    expect(out).not.toMatch(/create table/i);
    expect(out).toContain("select 1;");
    expect(out).toContain("select 2;");
  });

  it("vacía las cadenas y los cuerpos entre dólares, pero deja los identificadores entre comillas dobles", () => {
    const out = sanitizeSql(
      `create policy "Mi política" on t using (a = 'create table falso; -- no') ; do $$ begin create table dentro(); end $$; select $fn$ create table otro $fn$;`,
    );
    expect(out).toContain('"Mi política"');
    expect(out).not.toMatch(/falso|dentro|otro/);
  });

  it("entiende las comillas simples escapadas y no confunde $1 con un cuerpo", () => {
    const out = sanitizeSql(`select 'it''s ; fine', $1; create table t(a int);`);
    expect(out).toContain("create table t(a int)");
    expect(out).toContain("$1");
  });

  it("una cadena sin cerrar no se cuelga", () => {
    expect(() => sanitizeSql("select 'abierta")).not.toThrow();
    expect(() => sanitizeSql("select $$ sin cerrar")).not.toThrow();
  });
});

describe("identificadores y listas", () => {
  it("unquoteIdent pliega a minúsculas solo lo que no tiene comillas", () => {
    expect(unquoteIdent("Foo")).toBe("foo");
    expect(unquoteIdent('"Foo Bar"')).toBe("Foo Bar");
    expect(unquoteIdent('"a""b"')).toBe('a"b');
  });

  it("countFunctionArgs cuenta las entradas e ignora OUT y comas dentro de paréntesis", () => {
    expect(countFunctionArgs("")).toBe(0);
    expect(countFunctionArgs("a uuid")).toBe(1);
    expect(countFunctionArgs("a uuid, b numeric(10,2) default 5, c text[]")).toBe(3);
    expect(countFunctionArgs("a int, out b int")).toBe(1);
  });

  it("tableColumnNames omite restricciones y respeta las comas anidadas", () => {
    expect(
      tableColumnNames(
        `id uuid primary key default gen_random_uuid(), "Nombre Largo" text not null, monto numeric(10,2), constraint ck check (monto > 0), unique (id, monto), like otra_tabla`,
      ),
    ).toEqual(["id", "Nombre Largo", "monto"]);
  });

  it("splitStatements separa por punto y coma y descarta vacíos", () => {
    expect(splitStatements("a; b ;; c ;")).toEqual(["a", "b", "c"]);
  });
});

describe("statementOps", () => {
  it("CREATE TABLE da la tabla y sus columnas; otros esquemas y temporales se ignoran", () => {
    expect(
      statementOps(
        "create table if not exists public.pedidos (id uuid, total int, constraint pk primary key (id))",
      ),
    ).toEqual([
      { op: "create", kind: "table", name: "pedidos", table: "" },
      { op: "create", kind: "column", name: "id", table: "pedidos" },
      { op: "create", kind: "column", name: "total", table: "pedidos" },
    ]);
    expect(statementOps("create table hx_stage.x (a int)")).toEqual([]);
    expect(statementOps("create temp table tmp_x (a int)")).toEqual([]);
    expect(statementOps("create table copia as select 1")).toEqual([
      { op: "create", kind: "table", name: "copia", table: "" },
    ]);
  });

  it("CREATE FUNCTION recuerda el número de argumentos (distingue sobrecargas)", () => {
    expect(
      statementOps(
        "create or replace function public.f(a uuid, b integer default 3) returns void as $$$$ language sql",
      ),
    ).toEqual([{ op: "create", kind: "function", name: "f", table: "", arity: 2 }]);
    expect(statementOps("create function g() returns int as $$$$ language sql")).toEqual([
      { op: "create", kind: "function", name: "g", table: "", arity: 0 },
    ]);
  });

  it("políticas, disparadores e índices con o sin esquema y con comillas", () => {
    expect(
      statementOps('create policy "Ver propio" on public.perfiles for select using (true)'),
    ).toEqual([{ op: "create", kind: "policy", name: "Ver propio", table: "perfiles" }]);
    expect(
      statementOps(
        "create trigger trg_x before insert or update of a on public.perfiles for each row execute function f()",
      ),
    ).toEqual([{ op: "create", kind: "trigger", name: "trg_x", table: "perfiles" }]);
    expect(statementOps("create unique index if not exists ux_a on public.perfiles (a)")).toEqual([
      { op: "create", kind: "index", name: "ux_a", table: "perfiles" },
    ]);
    expect(statementOps("create policy p on auth.users using (true)")).toEqual([]);
  });

  it("ALTER TABLE: varias columnas, renombres y sentencias que no crean nada", () => {
    expect(
      statementOps(
        "alter table public.perfiles add column if not exists a text, add column b numeric(10,2), drop column if exists c, enable row level security",
      ),
    ).toEqual([
      { op: "create", kind: "column", name: "a", table: "perfiles" },
      { op: "create", kind: "column", name: "b", table: "perfiles" },
      { op: "drop", kind: "column", name: "c", table: "perfiles" },
    ]);
    expect(statementOps("alter table perfiles rename column a to b")).toEqual([
      { op: "drop", kind: "column", name: "a", table: "perfiles" },
      { op: "create", kind: "column", name: "b", table: "perfiles" },
    ]);
    expect(statementOps("alter table perfiles enable row level security")).toEqual([]);
    expect(statementOps("alter table perfiles rename to clientes")).toEqual([
      { op: "drop", kind: "table", name: "perfiles", table: "" },
      { op: "create", kind: "table", name: "clientes", table: "" },
    ]);
  });

  it("DROP de listas (tablas) y de funciones con sus firmas", () => {
    expect(statementOps("drop table if exists public.a, b cascade")).toEqual([
      { op: "drop", kind: "table", name: "a", table: "" },
      { op: "drop", kind: "table", name: "b", table: "" },
    ]);
    expect(statementOps("drop function if exists public.f(uuid, numeric(10,2)), g()")).toEqual([
      { op: "drop", kind: "function", name: "f", table: "", arity: 2 },
      { op: "drop", kind: "function", name: "g", table: "", arity: 0 },
    ]);
    expect(statementOps('drop policy if exists "Ver propio" on public.perfiles')).toEqual([
      { op: "drop", kind: "policy", name: "Ver propio", table: "perfiles" },
    ]);
    expect(statementOps("drop trigger if exists trg_x on perfiles")).toEqual([
      { op: "drop", kind: "trigger", name: "trg_x", table: "perfiles" },
    ]);
  });

  it("Realtime: las tablas que se agregan a la publicación", () => {
    expect(statementOps("alter publication supabase_realtime add table public.a, only b")).toEqual([
      { op: "create", kind: "realtime", name: "a", table: "a" },
      { op: "create", kind: "realtime", name: "b", table: "b" },
    ]);
  });

  it("lo que no entiende no genera nada (GRANT, COMMENT, INSERT, DO)", () => {
    for (const s of [
      "grant select on public.t to anon",
      "comment on table t is ''",
      "insert into t values (1)",
      "do $$$$",
    ]) {
      expect(statementOps(s)).toEqual([]);
    }
  });
});

describe("expectedState", () => {
  it("lo creado y luego eliminado queda como «no debe existir»; recrearlo lo devuelve", () => {
    const state = expectedState([
      file(
        "20260101000000_a.sql",
        'create policy "viejo" on public.t using (true); create function public.f(a int) returns int as $$ select 1 $$ language sql;',
      ),
      file("20260102000000_b.sql", 'drop policy "viejo" on public.t; drop function public.f(int);'),
      file(
        "20260103000000_c.sql",
        "create function public.f(a int) returns int as $$ select 2 $$ language sql;",
      ),
    ]);
    expect(find(state, "policy", "viejo", "t")).toMatchObject({
      exists: false,
      migration: "20260102000000",
    });
    expect(find(state, "function", "f")).toMatchObject({
      exists: true,
      migration: "20260103000000",
      arity: 1,
    });
  });

  it("una sobrecarga eliminada no afecta a la que sigue", () => {
    const state = expectedState([
      file(
        "20260101000000_a.sql",
        "create function public.f(a int) returns int as $$ select 1 $$ language sql; create function public.f(a int, b int) returns int as $$ select 1 $$ language sql;",
      ),
      file("20260102000000_b.sql", "drop function public.f(int);"),
    ]);
    const fs = state.filter((o) => o.kind === "function" && o.name === "f");
    expect(fs.find((o) => o.arity === 1)?.exists).toBe(false);
    expect(fs.find((o) => o.arity === 2)?.exists).toBe(true);
  });

  it("al eliminar una tabla se olvidan sus columnas, políticas, disparadores e índices", () => {
    const state = expectedState([
      file(
        "20260101000000_a.sql",
        "create table public.t (a int); create policy p on public.t using (true); create index ix on public.t (a); create trigger tg before insert on public.t for each row execute function f();",
      ),
      file("20260102000000_b.sql", "drop table public.t;"),
    ]);
    expect(state.filter((o) => o.kind !== "table")).toEqual([]);
    expect(find(state, "table", "t")?.exists).toBe(false);
  });

  it("las columnas agregadas después cuentan", () => {
    const state = expectedState([
      file("20260101000000_a.sql", "create table public.t (a int);"),
      file("20260102000000_b.sql", "alter table public.t add column if not exists b text;"),
    ]);
    expect(find(state, "column", "b", "t")).toMatchObject({
      exists: true,
      migration: "20260102000000",
    });
    expect(find(state, "column", "a", "t")).toMatchObject({
      exists: true,
      migration: "20260101000000",
    });
  });

  it("migrationVersion y filesFrom ordenan y filtran por versión", () => {
    expect(migrationVersion("20261013120000_institution_members.sql")).toBe("20261013120000");
    expect(migrationVersion("raro.sql")).toBe("raro.sql");
    const files = [
      file("20260301000000_b.sql", ""),
      file("20260101000000_a.sql", ""),
      file("20260201000000_c.sql", ""),
    ];
    expect(filesFrom(files, "20260201000000").map((f) => f.name)).toEqual([
      "20260201000000_c.sql",
      "20260301000000_b.sql",
    ]);
  });
});

describe("buildProbeSql", () => {
  const items: ExpectedObject[] = [
    { kind: "table", name: "t", table: "", exists: true, migration: "20260101000000" },
    { kind: "function", name: "f", table: "", arity: 2, exists: true, migration: "20260101000000" },
    { kind: "policy", name: "O'Brien", table: "t", exists: false, migration: "20260102000000" },
  ];

  it("es un único SELECT de solo lectura, con los valores escapados y el número de argumentos", () => {
    const sql = buildProbeSql(items);
    expect(sql.trim().startsWith("select")).toBe(true);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b\s/i);
    expect(sql).toContain("('20260101000000','table','t','',null,true)");
    expect(sql).toContain("('20260101000000','function','f','',2,true)");
    expect(sql).toContain("'O''Brien'");
    expect(sql).toContain("p.pronargs = e.a::int");
    expect(sql.match(/;/g)).toHaveLength(1);
  });

  it("chunk parte en trozos del tamaño pedido", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("findUnguardedRedefinitions", () => {
  const names = ["accept_application", "decline_application"];
  it("avisa de quien vuelve a crear una función delegada sin la marca", () => {
    const files = [
      file(
        "20261013120000_staff.sql",
        "create or replace function public.accept_application(a uuid) returns void as $$ select 1 $$ language sql;",
      ),
      file(
        "20261014100000_malo.sql",
        "create or replace function public.accept_application(a uuid) returns void as $$ select auth.uid() $$ language sql;",
      ),
      file(
        "20261014110000_bueno.sql",
        "create or replace function public.decline_application(a uuid) returns void as $$ select hx_acting_institution(auth.uid(), 'ofertas') $$ language sql;",
      ),
      file(
        "20261014120000_otra.sql",
        "create function public.otra_cosa() returns int as $$ select 1 $$ language sql;",
      ),
    ];
    expect(
      findUnguardedRedefinitions(files, names, "hx_acting_institution", "20261013120000"),
    ).toEqual([{ migration: "20261014100000", fn: "accept_application" }]);
  });

  it("la migración que parcha (y las anteriores) no cuentan", () => {
    const files = [
      file(
        "20261013120000_staff.sql",
        "create function public.accept_application(a uuid) returns void as $$ select 1 $$ language sql;",
      ),
    ];
    expect(
      findUnguardedRedefinitions(files, names, "hx_acting_institution", "20261013120000"),
    ).toEqual([]);
  });

  it("la marca en un comentario no cuenta", () => {
    const files = [
      file(
        "20261014100000_x.sql",
        "-- hx_acting_institution\ncreate function public.accept_application(a uuid) returns void as $$ select 1 $$ language sql;",
      ),
    ];
    expect(
      findUnguardedRedefinitions(files, names, "hx_acting_institution", "20261013120000"),
    ).toHaveLength(1);
  });
});

// ─── Los archivos reales del repositorio ───────────────────────────────────────

const MIGRATIONS_DIR = new URL("../../supabase/migrations/", import.meta.url);
const real: MigrationFile[] = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS_DIR), "utf8") }));

describe("cadena supabase/migrations (archivos reales)", () => {
  it("desde octubre cada archivo lleva versión de 14 dígitos y nombre en minúsculas; en toda la cadena las versiones no se repiten", () => {
    // Los archivos antiguos (abril–junio) los generó Lovable con un UUID o con fecha corta: la regla es para lo que escribimos hoy.
    const authored = real.filter((f) => f.name >= "20261007000000");
    expect(authored.length).toBeGreaterThan(30);
    expect(
      authored.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f.name)).map((f) => f.name),
    ).toEqual([]);
    const versions = real.map((f) => f.name.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("el estado esperado reconoce lo que se sabe que hay (y lo que se sabe que ya no)", () => {
    const state = expectedState(real);
    expect(find(state, "table", "institution_members")).toMatchObject({
      exists: true,
      migration: "20261013120000",
    });
    expect(find(state, "function", "my_staff_context")).toMatchObject({ exists: true, arity: 0 });
    expect(find(state, "function", "hx_acting_institution")).toMatchObject({
      exists: true,
      arity: 2,
    });
    expect(find(state, "column", "last_seen_at", "institution_members")).toMatchObject({
      exists: true,
    });
    // La segunda migración del personal elimina esta política (el personal no debe leer el perfil de la institución).
    expect(find(state, "policy", "inst_member_select", "institution_profiles")).toMatchObject({
      exists: false,
      migration: "20261013130000",
    });
  });

  it("desde octubre hay cientos de objetos que sondear, y cada uno proviene de una migración real", () => {
    const state = expectedState(real).filter((o) => o.migration >= "20261007000000");
    expect(state.length).toBeGreaterThan(400);
    const versions = new Set(real.map((f) => migrationVersion(f.name)));
    expect(state.every((o) => versions.has(o.migration))).toBe(true);
    expect(buildProbeSql(state).length).toBeGreaterThan(10_000);
  });

  it("ningún archivo que ya existe se queda sin ninguna operación entendible de más de un tipo (el analizador sigue vivo)", () => {
    const kinds = new Set(real.flatMap((f) => fileOps(f.sql).map((o) => o.kind)));
    for (const k of ["table", "column", "function", "policy", "trigger", "index"])
      expect(kinds.has(k as never)).toBe(true);
  });

  it("GUARDA: nadie vuelve a crear las seis funciones delegadas al personal sin pasar por hx_acting_institution", () => {
    const delegated = [
      "publish_institution_offer",
      "accept_application",
      "decline_application",
      "counter_application",
      "institution_application_inbox",
      "invite_team_to_offer",
    ];
    // La migración 20261013120000 las parcha EN LA BASE (reemplaza `auth.uid()` por `hx_acting_institution(auth.uid(), módulo)`).
    // Si una migración posterior hace `CREATE OR REPLACE` con el cuerpo viejo, el personal pierde el acceso sin que nadie lo note.
    expect(
      findUnguardedRedefinitions(real, delegated, "hx_acting_institution", "20261013120000"),
    ).toEqual([]);
  });

  it("GUARDA: las seis funciones delegadas existen y la migración que las parcha las nombra todas", () => {
    const patch = real.find((f) => f.name.startsWith("20261013120000_"))!;
    for (const fn of [
      "publish_institution_offer",
      "accept_application",
      "decline_application",
      "counter_application",
      "institution_application_inbox",
      "invite_team_to_offer",
    ]) {
      expect(patch.sql).toContain(fn);
    }
  });
});

// ─── La cadena de Drizzle (la que Lovable lleva y registra en producción) ──────

const DRIZZLE_DIR = new URL("../../drizzle/migrations/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe("cadena drizzle/migrations (la que registra producción)", () => {
  it("el diario, los .sql y las instantáneas van de la mano, sin huecos", () => {
    const sqlFiles = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(sqlFiles);
    for (const e of journal.entries) {
      expect(e.tag.startsWith(String(e.idx).padStart(4, "0") + "_")).toBe(true);
      expect(() =>
        readFileSync(new URL(`meta/${String(e.idx).padStart(4, "0")}_snapshot.json`, DRIZZLE_DIR)),
      ).not.toThrow();
    }
  });

  it("las fechas del diario (`when`) crecen estrictamente: es lo que usa el ejecutor para saber qué falta", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    }
  });

  it("el registro de producción guarda sha256 del archivo y el `when` del diario (se verificó contra producción el 2026-10-13)", () => {
    // Producción (`drizzle.__drizzle_migrations`): hash = sha256(contenido del .sql), created_at = `when`. Estos son los 16 primeros
    // caracteres del hash de las últimas filas registradas allí; si alguien edita un archivo ya aplicado, esta prueba lo delata.
    const prod: Record<string, string> = {
      "0013_enable_pg_cron": "13d3f8ab5931c91d",
      "0014_fix_function_search_path": "bb1a944aa890f280",
    };
    for (const [tag, hash16] of Object.entries(prod)) {
      const sql = readFileSync(new URL(`${tag}.sql`, DRIZZLE_DIR));
      expect(createHash("sha256").update(sql).digest("hex").slice(0, 16)).toBe(hash16);
    }
    expect(journal.entries.at(-1)?.when).toBeGreaterThanOrEqual(1791681088676);
  });
});
