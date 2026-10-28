import { describe, expect, it } from "vitest";
import {
  classifyUser,
  countByKind,
  filterUsers,
  primaryRole,
  toAdminUser,
  type AdminUserRow,
} from "./adminUsers";

const row = (over: Partial<AdminUserRow> = {}): AdminUserRow => ({
  user_id: "u1",
  email: "a@b.co",
  full_name: "Ana",
  avatar_url: null,
  phone: null,
  city: null,
  created_at: "2026-10-28T00:00:00Z",
  last_sign_in_at: null,
  email_confirmed: true,
  has_profile: true,
  roles: ["family"],
  signup_role: null,
  is_institution_staff: false,
  staff_institution: null,
  pro_specialty: null,
  pro_published: null,
  pro_verified: null,
  pro_blocked: null,
  pro_verification: null,
  institution_name: null,
  institution_type: null,
  institution_verified: null,
  pending_documents: 0,
  ...over,
});

describe("adminUsers", () => {
  it("elige el rol de más arriba cuando hay varios", () => {
    expect(primaryRole(["family", "superadmin"])).toBe("superadmin");
    expect(primaryRole(["professional", "family"])).toBe("professional");
    expect(primaryRole([])).toBeNull();
  });

  it("clasifica por rol y, sin rol, por lo que eligió al registrarse", () => {
    expect(classifyUser(row({ roles: ["institution"] }))).toBe("institution");
    expect(classifyUser(row({ roles: ["evaluator"] }))).toBe("team");
    expect(classifyUser(row({ roles: [], is_institution_staff: true }))).toBe("institution_staff");
    expect(classifyUser(row({ roles: [], signup_role: "professional" }))).toBe("professional");
    expect(classifyUser(row({ roles: [] }))).toBe("family");
  });

  it("marca como incompletas las cuentas sin perfil o sin rol, pero no al personal de una EPS/IPS", () => {
    expect(toAdminUser(row({ has_profile: false })).incomplete).toBe(true);
    expect(toAdminUser(row({ roles: [] })).status.label).toBe("Sin rol");
    expect(toAdminUser(row({ roles: [], is_institution_staff: true })).incomplete).toBe(false);
  });

  it("muestra el estado de profesionales e instituciones", () => {
    const pro = toAdminUser(
      row({
        roles: ["professional"],
        pro_published: true,
        pro_verified: true,
        pending_documents: 2,
      }),
    );
    expect(pro.status).toEqual({ label: "2 doc. por revisar", tone: "warn" });
    const ips = toAdminUser(
      row({ roles: ["institution"], institution_name: "Hogar", institution_verified: true }),
    );
    expect(ips.status.label).toBe("Verificada");
  });

  it("cuenta por tipo y filtra por tipo y búsqueda sin tildes", () => {
    const users = [
      row({ user_id: "1", roles: ["family"], full_name: "María Paz" }),
      row({ user_id: "2", roles: ["professional"], pro_published: true, city: "Buesaco" }),
      row({ user_id: "3", roles: ["institution"], institution_name: "Hogar Belén" }),
      row({ user_id: "4", roles: [], has_profile: false }),
    ].map(toAdminUser);
    const c = countByKind(users);
    expect(c).toMatchObject({ all: 4, family: 2, professional: 1, institution: 1, incomplete: 1 });
    expect(filterUsers(users, "all", "maria").map((u) => u.user_id)).toEqual(["1"]);
    expect(filterUsers(users, "institution", "belen").map((u) => u.user_id)).toEqual(["3"]);
    expect(filterUsers(users, "incomplete", "").map((u) => u.user_id)).toEqual(["4"]);
  });
});
