import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_STAFF_PER_INSTITUTION,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  RESERVED_FOR_OWNER,
  STAFF_EMAIL_DOMAIN,
  STAFF_MODULES,
  STAFF_MODULE_KEYS,
  USERNAME_PATTERN,
  createMemberSchema,
  describeMemberAction,
  generatePassword,
  hasModule,
  isStaffEmail,
  isStaffModule,
  memberInitials,
  moduleLabel,
  normalizeModules,
  normalizeUsername,
  passwordError,
  remainingStaffSlots,
  removeMemberSchema,
  resetPasswordSchema,
  staffEmail,
  summarizeModules,
  updateMemberSchema,
  usernameError,
} from "./institutionMembers";

const ID = "11111111-1111-4111-8111-111111111111";

/** Generador pseudoaleatorio determinista (LCG) para probar generatePassword sin azar. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

describe("módulos", () => {
  it("el catálogo coincide con lo que acepta la base de datos (ofertas, talento, pacientes y monitoreo)", () => {
    expect([...STAFF_MODULE_KEYS]).toEqual(["ofertas", "talento", "pacientes", "monitoreo"]);
    expect(STAFF_MODULES.map((m) => m.key)).toEqual([
      "ofertas",
      "talento",
      "pacientes",
      "monitoreo",
    ]);
    for (const m of STAFF_MODULES) {
      expect(m.label.length).toBeGreaterThan(3);
      expect(m.description.length).toBeGreaterThan(20);
    }
  });

  it("los módulos son los mismos que `hx_staff_modules()` en la migración (si cambia uno, cambia el otro)", () => {
    const sql = readFileSync(
      require("node:path").resolve(process.cwd(), "supabase/migrations/20261014100000_institution_care_core.sql"),
      "utf8",
    );
    const fn = /FUNCTION public\.hx_staff_modules\(\)[\s\S]*?ARRAY\[([^\]]*)\]/.exec(sql);
    expect(fn).not.toBeNull();
    const inDb = [...fn![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inDb).toEqual([...STAFF_MODULE_KEYS]);
  });

  it("lo reservado a la cuenta de la institución se explica con motivo (los módulos clínicos ya se pueden delegar)", () => {
    const labels = RESERVED_FOR_OWNER.map((r) => r.label).join("|");
    expect(labels).toMatch(/contratos/i);
    expect(labels).toMatch(/pagos/i);
    expect(labels).toMatch(/equipo/i);
    expect(labels).not.toMatch(/pacientes|monitoreo/i);
    for (const r of RESERVED_FOR_OWNER) expect(r.reason.length).toBeGreaterThan(20);
  });

  it("dar acceso a datos sensibles se avisa en la descripción del módulo", () => {
    const patients = STAFF_MODULES.find((m) => m.key === "pacientes")!;
    expect(patients.description).toMatch(/Ley 1581/);
    expect(patients.description).toMatch(/autorización/);
  });

  it("normaliza: descarta lo desconocido, quita repetidos y respeta el orden del catálogo", () => {
    expect(
      normalizeModules(["monitoreo", "talento", "ofertas", "talento", "pagos", 3, null]),
    ).toEqual(["ofertas", "talento", "monitoreo"]);
    expect(normalizeModules(null)).toEqual([]);
    expect(normalizeModules([])).toEqual([]);
    expect(isStaffModule("ofertas")).toBe(true);
    expect(isStaffModule("pagos")).toBe(false);
    expect(isStaffModule(undefined)).toBe(false);
  });

  it("hasModule y los textos", () => {
    expect(hasModule(["ofertas"], "ofertas")).toBe(true);
    expect(hasModule(["ofertas"], "talento")).toBe(false);
    expect(hasModule(undefined, "ofertas")).toBe(false);
    expect(moduleLabel("ofertas")).toBe("Ofertas y postulaciones");
    expect(moduleLabel("raro")).toBe("raro");
    expect(summarizeModules(["talento", "ofertas"])).toBe(
      "Ofertas y postulaciones · Red de profesionales",
    );
    expect(summarizeModules([])).toBe("Sin módulos");
  });
});

describe("usuario", () => {
  it("normaliza espacios y mayúsculas", () => {
    expect(normalizeUsername("  Marta.Coord ")).toBe("marta.coord");
    expect(normalizeUsername(undefined as unknown as string)).toBe("");
  });

  it("acepta usuarios válidos (la misma regla de la base de datos)", () => {
    for (const u of [
      "marta.coord",
      "jorge_talento",
      "abc",
      "a1b2c3",
      "turno-noche",
      "x".repeat(30),
    ]) {
      expect(USERNAME_PATTERN.test(u)).toBe(true);
      expect(usernameError(u)).toBeNull();
    }
  });

  it("rechaza lo inválido con un mensaje", () => {
    expect(usernameError("")).toMatch(/Escribe un usuario/);
    expect(usernameError("ab")).toMatch(/3 a 30/);
    expect(usernameError("x".repeat(31))).toMatch(/3 a 30/);
    expect(usernameError("Marta")).toMatch(/3 a 30/); // sin normalizar
    expect(usernameError("ana perez")).toMatch(/3 a 30/);
    expect(usernameError("ana@correo.com")).toMatch(/3 a 30/);
    expect(usernameError("camilo.ríos")).toMatch(/3 a 30/);
    expect(usernameError(".marta")).toMatch(/3 a 30/);
    expect(usernameError("marta.")).toMatch(/terminar/);
    expect(usernameError("marta..coord")).toMatch(/dos signos/);
    expect(usernameError("marta-_coord")).toMatch(/dos signos/);
  });

  it("reserva palabras que confunden", () => {
    for (const u of ["admin", "superadmin", "soporte", "humanix", "staff", "root"]) {
      expect(usernameError(u)).toMatch(/reservado/);
    }
    expect(usernameError("admin2")).toBeNull();
  });

  it("el correo sintético usa el dominio sin buzón y se reconoce", () => {
    expect(staffEmail("Marta.Coord")).toBe(`marta.coord@${STAFF_EMAIL_DOMAIN}`);
    expect(STAFF_EMAIL_DOMAIN).toBe("staff.humanix.lat");
    expect(isStaffEmail("marta.coord@staff.humanix.lat")).toBe(true);
    expect(isStaffEmail("MARTA@STAFF.HUMANIX.LAT")).toBe(true);
    expect(isStaffEmail("ana@humanix.lat")).toBe(false);
    expect(isStaffEmail("ana@gmail.com")).toBe(false);
    expect(isStaffEmail(null)).toBe(false);
  });
});

describe("contraseña", () => {
  it("acepta una contraseña razonable", () => {
    expect(passwordError("Turnos2026Norte", "marta.coord")).toBeNull();
    expect(passwordError("claveSegura77x")).toBeNull();
  });

  it("rechaza corta, larga, con espacios, sin mezcla o repetitiva", () => {
    expect(passwordError("Corta1a")).toMatch(new RegExp(`${PASSWORD_MIN} caracteres`));
    expect(passwordError("a1".repeat(40))).toMatch(new RegExp(`${PASSWORD_MAX_BYTES} bytes`));
    expect(passwordError("ñ1".repeat(30))).toMatch(/bytes/); // 60 caracteres pero > 72 bytes
    expect(passwordError("Mi clave 12345x")).toMatch(/espacios/);
    expect(passwordError("soloLetrasLargas")).toMatch(/letras y números/);
    expect(passwordError("12345678901234")).toMatch(/letras y números/);
    expect(passwordError("aaaaaaaaaa11")).toMatch(/repetitiva/);
  });

  it("no puede contener el usuario ni ser una de las comunes", () => {
    expect(passwordError("Marta.Coord2026", "marta.coord")).toMatch(/usuario/);
    expect(passwordError("xxMARTA.coordxx9", "marta.coord")).toMatch(/usuario/);
    expect(passwordError("Password12345", "")).toMatch(/común/);
    expect(passwordError("Contraseña2026x", "")).toMatch(/común/);
    expect(passwordError("Humanix20262026", "")).toMatch(/común/);
    // un usuario muy corto no se usa para descartar (evita falsos positivos)
    expect(passwordError("Turnos2026Norte", "ab")).toBeNull();
  });

  it("generatePassword siempre cumple la política y mezcla letras y números", () => {
    const rand = seeded(7);
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(14, rand, "marta.coord");
      expect(pw).toHaveLength(14);
      expect(passwordError(pw, "marta.coord")).toBeNull();
      expect(pw).toMatch(/[A-Za-z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).not.toMatch(/[01OIl]/); // sin caracteres ambiguos
    }
  });

  it("generatePassword respeta el largo (acotado) y es distinta cada vez con el generador seguro", () => {
    expect(generatePassword(8)).toHaveLength(PASSWORD_MIN);
    expect(generatePassword(100)).toHaveLength(32);
    const set = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(set.size).toBe(50);
  });

  it("falla de forma explícita si el generador no da variedad", () => {
    expect(() => generatePassword(14, () => 0)).toThrow(/contraseña segura/);
  });
});

describe("esquemas", () => {
  const base = {
    displayName: "Marta Coordinadora",
    jobTitle: "Coordinadora de turnos",
    username: "marta.coord",
    password: "Turnos2026Norte",
    modules: ["ofertas"],
  };

  it("crear: acepta un caso válido", () => {
    const r = createMemberSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("crear: acepta usuario con mayúsculas (se normaliza al enviar) y cargo opcional", () => {
    expect(
      createMemberSchema.safeParse({ ...base, username: " Marta.Coord ", jobTitle: undefined })
        .success,
    ).toBe(true);
  });

  it("crear: mensajes por campo", () => {
    const bad = createMemberSchema.safeParse({
      displayName: "A",
      username: "ab",
      password: "corta",
      modules: [],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const byPath = Object.fromEntries(
        bad.error.issues.map((i) => [String(i.path[0]), i.message]),
      );
      expect(byPath.displayName).toMatch(/al menos 2/);
      expect(byPath.username).toMatch(/3 a 30/);
      expect(byPath.password).toMatch(/al menos 10/);
      expect(byPath.modules).toMatch(/al menos un módulo/);
    }
  });

  it("crear: módulos fuera del catálogo y nombres con caracteres peligrosos se rechazan", () => {
    expect(createMemberSchema.safeParse({ ...base, modules: ["pagos"] }).success).toBe(false);
    expect(
      createMemberSchema.safeParse({ ...base, modules: ["ofertas", "contratos"] }).success,
    ).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, displayName: "Marta <script>" }).success).toBe(
      false,
    );
    expect(createMemberSchema.safeParse({ ...base, jobTitle: "x".repeat(81) }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, password: "marta.coord123" }).success).toBe(
      false,
    );
  });

  it("editar: exige algo que cambiar y un id válido", () => {
    expect(updateMemberSchema.safeParse({ memberId: ID }).success).toBe(false);
    expect(
      updateMemberSchema.safeParse({ memberId: "no-es-id", status: "suspended" }).success,
    ).toBe(false);
    expect(updateMemberSchema.safeParse({ memberId: ID, status: "suspended" }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ memberId: ID, modules: ["talento"] }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ memberId: ID, modules: [] }).success).toBe(false);
    expect(updateMemberSchema.safeParse({ memberId: ID, jobTitle: null }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ memberId: ID, status: "bloqueada" }).success).toBe(false);
  });

  it("reiniciar contraseña y quitar: forma mínima", () => {
    expect(
      resetPasswordSchema.safeParse({ memberId: ID, password: "Nueva2026Clave" }).success,
    ).toBe(true);
    expect(resetPasswordSchema.safeParse({ memberId: ID }).success).toBe(false);
    expect(removeMemberSchema.safeParse({ memberId: ID }).success).toBe(true);
    expect(removeMemberSchema.safeParse({ memberId: "x" }).success).toBe(false);
  });
});

describe("textos", () => {
  it("describe lo que hizo la persona", () => {
    expect(describeMemberAction("offer_published")).toBe("Publicó un turno");
    expect(describeMemberAction("application_accepted")).toBe("Aceptó una postulación");
    expect(describeMemberAction("application_rejected")).toBe("Rechazó una postulación");
    expect(describeMemberAction("application_countered")).toBe("Envió una contraoferta");
    expect(describeMemberAction("algo_nuevo")).toBe("Realizó una acción");
  });

  it("iniciales y cupos", () => {
    expect(memberInitials("Marta Coordinadora")).toBe("MC");
    expect(memberInitials("  jorge  ")).toBe("J");
    expect(memberInitials("Ana María Duarte Pérez")).toBe("AP");
    expect(memberInitials("")).toBe("?");
    expect(MAX_STAFF_PER_INSTITUTION).toBe(10);
    expect(remainingStaffSlots(0)).toBe(10);
    expect(remainingStaffSlots(4)).toBe(6);
    expect(remainingStaffSlots(10)).toBe(0);
    expect(remainingStaffSlots(15)).toBe(0);
    expect(remainingStaffSlots(-3)).toBe(10);
  });
});
