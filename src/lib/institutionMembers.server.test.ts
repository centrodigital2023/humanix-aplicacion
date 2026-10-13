import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGES,
  handleCreateMember,
  handleRemoveMember,
  handleResetPassword,
  handleUpdateMember,
  mapAuthCreateError,
  mapMembershipError,
  type Db,
  type MembersDeps,
} from "./institutionMembers.server";

// ── Base de datos y Supabase Auth en memoria (lo justo para comprobar el comportamiento, no solo las llamadas).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Err = { code?: string; status?: number; message?: string; hint?: string };

class FakeDb {
  tables: Record<string, Row[]> = { user_roles: [], institution_members: [], profiles: [] };
  plans: Record<string, string> = {};
  users = new Map<
    string,
    {
      id: string;
      email: string;
      password?: string;
      metadata: Row;
      ban?: string;
      confirmed?: boolean;
    }
  >();
  calls: string[] = [];
  /** Errores a inyectar: «insert:institution_members», «auth.createUser», «auth.deleteUser», «auth.updateUserById»… */
  failures: Record<string, Err> = {};
  seq = 0;

  from(table: string) {
    return new Query(this, table);
  }
  rpc = async (name: string, args: Row) => {
    this.calls.push(`rpc:${name}`);
    if (this.failures[`rpc:${name}`]) return { data: null, error: this.failures[`rpc:${name}`] };
    return {
      data: name === "plan_key_for" ? (this.plans[args.p_user] ?? "free") : null,
      error: null,
    };
  };
  auth = {
    admin: {
      createUser: async (attrs: Row) => {
        this.calls.push("auth.createUser");
        if (this.failures["auth.createUser"])
          return { data: { user: null }, error: this.failures["auth.createUser"] };
        if ([...this.users.values()].some((u) => u.email === attrs.email)) {
          return {
            data: { user: null },
            error: { code: "email_exists", status: 422, message: "exists" },
          };
        }
        const id = `auth-${++this.seq}`;
        this.users.set(id, {
          id,
          email: attrs.email,
          password: attrs.password,
          metadata: attrs.user_metadata ?? {},
          confirmed: attrs.email_confirm === true,
        });
        return { data: { user: { id } }, error: null };
      },
      updateUserById: async (id: string, attrs: Row) => {
        this.calls.push("auth.updateUserById");
        if (this.failures["auth.updateUserById"])
          return { data: { user: null }, error: this.failures["auth.updateUserById"] };
        const u = this.users.get(id);
        if (!u) return { data: { user: null }, error: { code: "user_not_found", status: 404 } };
        if (attrs.password !== undefined) u.password = attrs.password;
        if (attrs.ban_duration !== undefined) u.ban = attrs.ban_duration;
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.calls.push("auth.deleteUser");
        if (this.failures["auth.deleteUser"])
          return { data: { user: null }, error: this.failures["auth.deleteUser"] };
        if (!this.users.delete(id))
          return { data: { user: null }, error: { code: "user_not_found", status: 404 } };
        this.tables.institution_members = this.tables.institution_members.filter(
          (m) => m.member_user_id !== id,
        );
        this.tables.profiles = this.tables.profiles.filter((p) => p.user_id !== id);
        return { data: { user: null }, error: null };
      },
    },
  };
}

class Query implements PromiseLike<unknown> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: Array<[string, unknown]> = [];
  private payload: Row = {};
  private head = false;
  private count = false;
  private lim: number | undefined;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.head = !!opts?.head;
    this.count = opts?.count === "exact";
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push([k, v]);
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    return this.run("maybe");
  }
  single() {
    return this.run("single");
  }
  then<T1, T2>(
    res?: ((v: unknown) => T1 | PromiseLike<T1>) | null,
    rej?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return this.run("many").then(res, rej);
  }

  private async run(shape: "many" | "maybe" | "single") {
    const { db, table, op } = this;
    db.calls.push(`${op}:${table}`);
    const failure = db.failures[`${op}:${table}`];
    if (failure) return { data: null, error: failure, count: null };
    const rows = (db.tables[table] ??= []);
    const matches = () => rows.filter((r) => this.filters.every(([k, v]) => r[k] === v));
    // Como la API real: lo que se devuelve es una copia (instantánea), no la fila viva de la tabla.
    const pick = (live: Row[]) => {
      const list = live.map((r) => ({ ...r }));
      if (shape === "many")
        return { data: list, error: null, count: this.count ? list.length : null };
      if (shape === "maybe") return { data: list[0] ?? null, error: null, count: null };
      return list[0]
        ? { data: list[0], error: null, count: null }
        : { data: null, error: { code: "PGRST116" }, count: null };
    };
    if (op === "select") {
      const list = matches().slice(0, this.lim ?? Infinity);
      if (this.head) return { data: null, error: null, count: list.length };
      return pick(list);
    }
    if (op === "insert") {
      if (table === "institution_members") {
        if (rows.some((r) => r.username === this.payload.username))
          return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
        if (rows.filter((r) => r.institution_id === this.payload.institution_id).length >= 10) {
          return {
            data: null,
            error: { code: "23514", message: "hasta 10", hint: "member_limit" },
            count: null,
          };
        }
      }
      const row = { id: `row-${++db.seq}`, ...this.payload };
      rows.push(row);
      return pick([row]);
    }
    if (op === "update") {
      const list = matches();
      for (const r of list) Object.assign(r, this.payload);
      return pick(list);
    }
    if (op === "delete") {
      const gone = matches();
      db.tables[table] = rows.filter((r) => !gone.includes(r));
      return { data: null, error: null, count: gone.length };
    }
    // upsert: ignora duplicados por user_id
    if (!rows.some((r) => r.user_id === this.payload.user_id)) rows.push({ ...this.payload });
    return { data: null, error: null, count: null };
  }
}

const OWNER = "owner-1";
const OTHER = "owner-2";

let db: FakeDb;
const deps = (): MembersDeps => ({ admin: db as unknown as Db });
const ctx = { userId: OWNER };

const goodCreate = {
  displayName: "Marta Coordinadora",
  jobTitle: "Coordinadora de turnos",
  username: "marta.coord",
  password: "Turnos2026Norte",
  modules: ["ofertas"],
};

/** Una persona del equipo ya creada (cuenta de Auth + fila) para las pruebas de editar/reiniciar/quitar. */
function seedMember(institution: string, username: string, extra: Row = {}) {
  const authId = `auth-seed-${username}`;
  db.users.set(authId, {
    id: authId,
    email: `${username}@staff.humanix.lat`,
    password: "Original2026Pw",
    metadata: { signup_kind: "institution_staff" },
  });
  const row = {
    id: crypto.randomUUID(),
    institution_id: institution,
    member_user_id: authId,
    username,
    display_name: `Persona ${username}`,
    job_title: null,
    modules: ["ofertas"],
    status: "active",
    ...extra,
  };
  db.tables.institution_members.push(row);
  db.tables.profiles.push({ user_id: authId, full_name: row.display_name });
  return row;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = new FakeDb();
  db.tables.user_roles.push(
    { user_id: OWNER, role: "institution" },
    { user_id: OTHER, role: "institution" },
    { user_id: "fam-1", role: "family" },
  );
  db.plans[OWNER] = "institution_monthly";
  db.plans[OTHER] = "institution_monthly";
});

describe("crear", () => {
  it("crea la cuenta con correo sintético confirmado, la marca de personal y la pertenencia", async () => {
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({
      ok: true,
      member: {
        username: "marta.coord",
        displayName: "Marta Coordinadora",
        jobTitle: "Coordinadora de turnos",
        modules: ["ofertas"],
        status: "active",
      },
    });
    const user = [...db.users.values()][0];
    expect(user.email).toBe("marta.coord@staff.humanix.lat");
    expect(user.password).toBe("Turnos2026Norte");
    expect(user.confirmed).toBe(true); // ya confirmada: no se envía ningún correo a la dirección sintética
    expect(user.metadata).toEqual({
      signup_kind: "institution_staff",
      full_name: "Marta Coordinadora",
    });
    const row = db.tables.institution_members[0];
    expect(row).toMatchObject({
      institution_id: OWNER,
      member_user_id: user.id,
      username: "marta.coord",
      status: "active",
      created_by: OWNER,
    });
    expect(db.tables.profiles.some((p) => p.user_id === user.id)).toBe(true);
  });

  it("nunca devuelve la contraseña ni el correo sintético", async () => {
    const r = await handleCreateMember(goodCreate, ctx, deps());
    const text = JSON.stringify(r);
    expect(text).not.toContain("Turnos2026Norte");
    expect(text).not.toContain("staff.humanix.lat");
    expect(text).not.toContain("auth-");
  });

  it("normaliza el usuario (espacios y mayúsculas) y deja el cargo vacío como nulo", async () => {
    const r = await handleCreateMember(
      { ...goodCreate, username: "  Marta.Coord ", jobTitle: "" },
      ctx,
      deps(),
    );
    expect(r).toMatchObject({ ok: true, member: { username: "marta.coord", jobTitle: null } });
  });

  it("datos inválidos: mensajes por campo y no toca Auth", async () => {
    const r = await handleCreateMember(
      { displayName: "A", username: "ab", password: "corta", modules: [] },
      ctx,
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("invalid_input");
      expect(Object.keys(r.fields ?? {}).sort()).toEqual([
        "displayName",
        "modules",
        "password",
        "username",
      ]);
    }
    expect(db.calls.some((c) => c.startsWith("auth."))).toBe(false);
    const nada = await handleCreateMember(undefined, ctx, deps());
    expect(nada).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("solo la cuenta de la institución crea personal (una familia, el personal o nadie, no)", async () => {
    for (const userId of ["fam-1", "auth-unknown", ""]) {
      const r = await handleCreateMember(goodCreate, { userId }, deps());
      expect(r).toMatchObject({ ok: false, code: "not_institution" });
    }
    expect(db.calls.some((c) => c.startsWith("auth."))).toBe(false);
    expect(db.tables.institution_members).toHaveLength(0);
  });

  it("exige el plan IPS Mejorado para crear", async () => {
    for (const plan of ["free", "essential_monthly", "pro_monthly"]) {
      db.plans[OWNER] = plan;
      const r = await handleCreateMember(goodCreate, ctx, deps());
      expect(r).toMatchObject({ ok: false, code: "plan_required" });
    }
    expect(db.users.size).toBe(0);
  });

  it("respeta el tope de 10 personas sin crear la cuenta", async () => {
    for (let i = 0; i < 10; i++) seedMember(OWNER, `persona.${i}`);
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({ ok: false, code: "limit_reached", message: MESSAGES.limit_reached });
    expect(db.calls).not.toContain("auth.createUser");
    // el tope es por institución: la otra puede seguir agregando
    const otra = await handleCreateMember(goodCreate, { userId: OTHER }, deps());
    expect(otra.ok).toBe(true);
  });

  it("el usuario es único en toda la plataforma (antes de crear la cuenta)", async () => {
    seedMember(OTHER, "marta.coord");
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({
      ok: false,
      code: "username_taken",
      fields: { username: MESSAGES.username_taken },
    });
    expect(db.calls).not.toContain("auth.createUser");
  });

  it("si Auth dice que el correo ya existe: usuario ocupado", async () => {
    db.users.set("x", { id: "x", email: "marta.coord@staff.humanix.lat", metadata: {} });
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({ ok: false, code: "username_taken" });
    expect(db.tables.institution_members).toHaveLength(0);
  });

  it("errores de Auth con mensaje claro: contraseña débil, usuario rechazado y demasiados intentos", async () => {
    db.failures["auth.createUser"] = { code: "weak_password", status: 422 };
    expect(await handleCreateMember(goodCreate, ctx, deps())).toMatchObject({
      ok: false,
      code: "weak_password",
      fields: { password: MESSAGES.weak_password },
    });
    db.failures["auth.createUser"] = { code: "email_address_invalid", status: 400 };
    expect(await handleCreateMember(goodCreate, ctx, deps())).toMatchObject({
      ok: false,
      code: "account_rejected",
    });
    db.failures["auth.createUser"] = { code: "over_request_rate_limit", status: 429 };
    expect(await handleCreateMember(goodCreate, ctx, deps())).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    db.failures["auth.createUser"] = { status: 500, message: "boom" };
    expect(await handleCreateMember(goodCreate, ctx, deps())).toMatchObject({
      ok: false,
      code: "failed",
      message: MESSAGES.failed,
    });
  });

  it("si la pertenencia falla, la cuenta recién creada se borra (sin huérfanas)", async () => {
    db.failures["insert:institution_members"] = { code: "XX000", message: "caída" };
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(db.calls).toContain("auth.deleteUser");
    expect(db.users.size).toBe(0);
    expect(db.tables.institution_members).toHaveLength(0);
  });

  it("carrera con el tope: la base de datos rechaza la persona 11 y la cuenta recién creada se borra", async () => {
    // El conteo previo ve 9, pero otra petición llena el cupo justo antes del insert: lo impide la base de datos.
    for (let i = 0; i < 9; i++) seedMember(OWNER, `persona.${i}`);
    const original = db.from.bind(db);
    let calls = 0;
    db.from = ((table: string) => {
      if (table === "institution_members" && ++calls === 3) seedMember(OWNER, "colado"); // 1: conteo · 2: usuario libre · 3: insert
      return original(table);
    }) as typeof db.from;
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r).toMatchObject({ ok: false, code: "limit_reached" });
    expect(db.calls).toContain("auth.deleteUser");
    expect([...db.users.values()].some((u) => u.email.startsWith("marta"))).toBe(false);
    expect(db.tables.institution_members.some((m) => m.username === "marta.coord")).toBe(false);
  });

  it("un fallo al guardar el perfil no deshace lo demás", async () => {
    db.failures["upsert:profiles"] = { code: "XX000" };
    const r = await handleCreateMember(goodCreate, ctx, deps());
    expect(r.ok).toBe(true);
    expect(db.tables.institution_members).toHaveLength(1);
  });
});

describe("editar y suspender", () => {
  it("cambia nombre, cargo y módulos (solo de su equipo)", async () => {
    const m = seedMember(OWNER, "jorge");
    const r = await handleUpdateMember(
      {
        memberId: m.id,
        displayName: "Jorge Talento",
        jobTitle: "Selección",
        modules: ["talento", "ofertas"],
      },
      ctx,
      deps(),
    );
    expect(r).toMatchObject({
      ok: true,
      member: {
        displayName: "Jorge Talento",
        jobTitle: "Selección",
        modules: ["talento", "ofertas"],
      },
    });
    expect(db.tables.institution_members[0]).toMatchObject({
      display_name: "Jorge Talento",
      job_title: "Selección",
    });
    expect(db.calls).not.toContain("auth.updateUserById"); // sin cambio de estado no se toca Auth
  });

  it("vaciar el cargo lo deja nulo", async () => {
    const m = seedMember(OWNER, "jorge", { job_title: "Selección" });
    const r = await handleUpdateMember({ memberId: m.id, jobTitle: null }, ctx, deps());
    expect(r).toMatchObject({ ok: true, member: { jobTitle: null } });
    // un cargo en blanco (o solo espacios) también se guarda como nulo, no como texto vacío
    db.tables.institution_members[0].job_title = "Selección";
    const vacio = await handleUpdateMember({ memberId: m.id, jobTitle: "   " }, ctx, deps());
    expect(vacio).toMatchObject({ ok: true, member: { jobTitle: null } });
    expect(db.tables.institution_members[0].job_title).toBeNull();
  });

  it("suspender corta el acceso en la base de datos y bloquea el inicio de sesión; reactivar lo levanta", async () => {
    const m = seedMember(OWNER, "sara");
    const s = await handleUpdateMember({ memberId: m.id, status: "suspended" }, ctx, deps());
    expect(s).toMatchObject({ ok: true, member: { status: "suspended" } });
    expect(db.tables.institution_members[0].status).toBe("suspended");
    expect(db.users.get(m.member_user_id)?.ban).toBe("876000h");
    const a = await handleUpdateMember({ memberId: m.id, status: "active" }, ctx, deps());
    expect(a).toMatchObject({ ok: true, member: { status: "active" } });
    expect(db.users.get(m.member_user_id)?.ban).toBe("none");
  });

  it("repetir el mismo estado no vuelve a llamar a Auth", async () => {
    const m = seedMember(OWNER, "sara");
    await handleUpdateMember({ memberId: m.id, status: "active" }, ctx, deps());
    expect(db.calls).not.toContain("auth.updateUserById");
  });

  it("si no se pudo sincronizar el inicio de sesión, lo dice (el acceso a datos ya quedó cortado)", async () => {
    const m = seedMember(OWNER, "sara");
    db.failures["auth.updateUserById"] = { code: "unexpected_failure", status: 500 };
    const r = await handleUpdateMember({ memberId: m.id, status: "suspended" }, ctx, deps());
    expect(r).toMatchObject({ ok: false, code: "failed" });
    if (!r.ok) expect(r.message).toMatch(/Se guardó el cambio/);
    expect(db.tables.institution_members[0].status).toBe("suspended");
  });

  it("no toca a las personas de otra institución", async () => {
    const ajena = seedMember(OTHER, "luis");
    const r = await handleUpdateMember(
      { memberId: ajena.id, status: "suspended", displayName: "Hackeado" },
      ctx,
      deps(),
    );
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(db.tables.institution_members[0]).toMatchObject({
      status: "active",
      display_name: "Persona luis",
    });
    expect(db.calls).not.toContain("update:institution_members");
    expect(db.calls).not.toContain("auth.updateUserById");
  });

  it("solo la institución edita: el personal y las familias no", async () => {
    const m = seedMember(OWNER, "jorge");
    for (const userId of [m.member_user_id, "fam-1"]) {
      const r = await handleUpdateMember(
        { memberId: m.id, status: "suspended" },
        { userId },
        deps(),
      );
      expect(r).toMatchObject({ ok: false, code: "not_institution" });
    }
    expect(db.tables.institution_members[0].status).toBe("active");
  });

  it("aunque el plan haya vencido, siempre se puede suspender o cambiar", async () => {
    const m = seedMember(OWNER, "jorge");
    db.plans[OWNER] = "free";
    expect(
      await handleUpdateMember({ memberId: m.id, status: "suspended" }, ctx, deps()),
    ).toMatchObject({ ok: true });
  });

  it("valida la entrada: sin cambios, módulos vacíos o desconocidos, id inválido", async () => {
    const m = seedMember(OWNER, "jorge");
    for (const bad of [
      { memberId: m.id },
      { memberId: m.id, modules: [] },
      { memberId: m.id, modules: ["pagos"] },
      { memberId: "no-id", status: "active" },
      { memberId: m.id, status: "otro" },
    ]) {
      expect(await handleUpdateMember(bad, ctx, deps())).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
    }
  });

  it("persona inexistente", async () => {
    expect(
      await handleUpdateMember(
        { memberId: "11111111-1111-4111-8111-111111111111", status: "suspended" },
        ctx,
        deps(),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("reiniciar contraseña", () => {
  it("cambia la contraseña de la persona del equipo", async () => {
    const m = seedMember(OWNER, "jorge");
    const r = await handleResetPassword(
      { memberId: m.id, password: "Nueva2026Clave" },
      ctx,
      deps(),
    );
    expect(r.ok).toBe(true);
    expect(db.users.get(m.member_user_id)?.password).toBe("Nueva2026Clave");
    expect(JSON.stringify(r)).not.toContain("Nueva2026Clave");
  });

  it("aplica la política contra el usuario de esa persona", async () => {
    const m = seedMember(OWNER, "jorge");
    const r = await handleResetPassword(
      { memberId: m.id, password: "jorge2026Clave" },
      ctx,
      deps(),
    );
    expect(r).toMatchObject({
      ok: false,
      code: "invalid_input",
      fields: { password: expect.stringMatching(/usuario/) },
    });
    expect(db.users.get(m.member_user_id)?.password).toBe("Original2026Pw");
    const corta = await handleResetPassword({ memberId: m.id, password: "abc1" }, ctx, deps());
    expect(corta).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("no reinicia contraseñas de otra institución ni de quien no sea del equipo", async () => {
    const ajena = seedMember(OTHER, "luis");
    expect(
      await handleResetPassword({ memberId: ajena.id, password: "Nueva2026Clave" }, ctx, deps()),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(db.users.get(ajena.member_user_id)?.password).toBe("Original2026Pw");
    const propia = seedMember(OWNER, "jorge");
    expect(
      await handleResetPassword(
        { memberId: propia.id, password: "Nueva2026Clave" },
        { userId: propia.member_user_id },
        deps(),
      ),
    ).toMatchObject({ ok: false, code: "not_institution" });
  });

  it("traduce los errores de Auth", async () => {
    const m = seedMember(OWNER, "jorge");
    db.failures["auth.updateUserById"] = { code: "same_password", status: 422 };
    expect(
      await handleResetPassword({ memberId: m.id, password: "Nueva2026Clave" }, ctx, deps()),
    ).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Elige una contraseña distinta de la actual.",
    });
    db.failures["auth.updateUserById"] = { code: "weak_password", status: 422 };
    expect(
      await handleResetPassword({ memberId: m.id, password: "Nueva2026Clave" }, ctx, deps()),
    ).toMatchObject({ ok: false, code: "weak_password" });
    db.failures["auth.updateUserById"] = { code: "unexpected_failure", status: 500 };
    expect(
      await handleResetPassword({ memberId: m.id, password: "Nueva2026Clave" }, ctx, deps()),
    ).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("quitar", () => {
  it("borra la cuenta y, en cascada, la pertenencia y el perfil", async () => {
    const m = seedMember(OWNER, "jorge");
    const otra = seedMember(OWNER, "ana");
    const r = await handleRemoveMember({ memberId: m.id }, ctx, deps());
    expect(r).toEqual({ ok: true });
    expect(db.users.has(m.member_user_id)).toBe(false);
    expect(db.tables.institution_members.map((x) => x.username)).toEqual(["ana"]);
    expect(db.tables.profiles.map((p) => p.user_id)).toEqual([otra.member_user_id]);
  });

  it("no quita a las personas de otra institución", async () => {
    const ajena = seedMember(OTHER, "luis");
    expect(await handleRemoveMember({ memberId: ajena.id }, ctx, deps())).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(db.users.has(ajena.member_user_id)).toBe(true);
    expect(db.calls).not.toContain("auth.deleteUser");
  });

  it("solo la institución quita personal", async () => {
    const m = seedMember(OWNER, "jorge");
    expect(
      await handleRemoveMember({ memberId: m.id }, { userId: m.member_user_id }, deps()),
    ).toMatchObject({ ok: false, code: "not_institution" });
    expect(await handleRemoveMember({ memberId: m.id }, { userId: "fam-1" }, deps())).toMatchObject(
      { ok: false, code: "not_institution" },
    );
    expect(db.tables.institution_members).toHaveLength(1);
  });

  it("si la cuenta ya no existía en Auth, limpia solo la fila", async () => {
    const m = seedMember(OWNER, "jorge");
    db.users.delete(m.member_user_id);
    expect(await handleRemoveMember({ memberId: m.id }, ctx, deps())).toEqual({ ok: true });
    expect(db.tables.institution_members).toHaveLength(0);
  });

  it("si Auth falla, no dice que se quitó", async () => {
    const m = seedMember(OWNER, "jorge");
    db.failures["auth.deleteUser"] = { code: "unexpected_failure", status: 500 };
    expect(await handleRemoveMember({ memberId: m.id }, ctx, deps())).toMatchObject({
      ok: false,
      code: "failed",
    });
    expect(db.tables.institution_members).toHaveLength(1);
  });

  it("valida el id", async () => {
    expect(await handleRemoveMember({ memberId: "x" }, ctx, deps())).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(await handleRemoveMember(null, ctx, deps())).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });
});

describe("traducción de errores", () => {
  it("Auth al crear la cuenta", () => {
    expect(mapAuthCreateError({ code: "email_exists" })).toBe("username_taken");
    expect(mapAuthCreateError({ code: "user_already_exists" })).toBe("username_taken");
    expect(mapAuthCreateError({ message: "User already registered" })).toBe("username_taken");
    expect(mapAuthCreateError({ code: "weak_password" })).toBe("weak_password");
    expect(mapAuthCreateError({ status: 429 })).toBe("rate_limited");
    expect(mapAuthCreateError({ code: "email_address_not_authorized" })).toBe("account_rejected");
    expect(mapAuthCreateError({ code: "validation_failed" })).toBe("account_rejected");
    expect(mapAuthCreateError({ status: 500 })).toBe("failed");
    expect(mapAuthCreateError({})).toBe("failed");
  });

  it("la base de datos al registrar la pertenencia", () => {
    expect(mapMembershipError({ hint: "member_limit" })).toBe("limit_reached");
    expect(mapMembershipError({ code: "23505" })).toBe("username_taken");
    expect(mapMembershipError({ message: "Solo una institución puede tener personal" })).toBe(
      "not_institution",
    );
    expect(mapMembershipError({ code: "XX000" })).toBe("failed");
  });
});
