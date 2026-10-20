import { describe, expect, it } from "vitest";
import { friendlyAuthError, friendlyError, isHumanMessage } from "./friendlyError";

describe("friendlyError — nunca texto técnico para las personas", () => {
  it("errores de la base sin habilitar", () => {
    expect(friendlyError({ code: "PGRST205", message: "Could not find the table 'public.x'" })).toMatch(
      /aún no está disponible/,
    );
    expect(friendlyError({ code: "42P01", message: 'relation "health_compliance" does not exist' })).toMatch(
      /aún no está disponible/,
    );
    expect(friendlyError(new Error("Bucket not found"))).toMatch(/aún no está disponible/);
  });

  it("permisos, sesión y duplicados", () => {
    expect(friendlyError({ code: "42501", message: "new row violates row-level security policy" })).toMatch(
      /No tienes permiso/,
    );
    expect(friendlyError({ message: "JWT expired", code: "PGRST301" })).toMatch(/sesión se cerró/);
    expect(friendlyError({ status: 401, message: "x" })).toMatch(/sesión se cerró/);
    expect(friendlyError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "Esto ya estaba registrado.",
    );
  });

  it("red y servidor ocupado", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/no hay conexión/);
    expect(friendlyError(new Error("Failed to send a request to the Edge Function"))).toMatch(/no hay conexión/);
    expect(friendlyError({ status: 429, message: "Too Many Requests" })).toMatch(/mucha actividad/);
  });

  it("archivos", () => {
    expect(friendlyError({ status: 413, message: "Payload too large" })).toMatch(/muy grande/);
    expect(friendlyError(new Error("mime type image/gif is not supported"))).toMatch(/tipo de archivo/);
  });

  it("formatos y relaciones", () => {
    expect(friendlyError({ code: "22P02", message: 'invalid input syntax for type uuid: "x"' })).toMatch(/formato/);
    expect(friendlyError({ code: "23503", message: "violates foreign key constraint" })).toMatch(/Recarga/);
  });

  it("los mensajes escritos para personas pasan tal cual", () => {
    expect(friendlyError({ code: "23P01", message: "El profesional ya tiene un servicio en ese horario" })).toBe(
      "El profesional ya tiene un servicio en ese horario",
    );
    expect(friendlyError({ code: "P0001", message: "No puedes contratarte a ti mismo" })).toBe(
      "No puedes contratarte a ti mismo",
    );
    expect(friendlyError("¡Ya te postulaste a esta oferta!")).toBe("¡Ya te postulaste a esta oferta!");
  });

  it("lo técnico o en inglés usa el texto de respaldo", () => {
    expect(friendlyError(new Error("Edge Function returned a non-2xx status code"), "No se pudo enviar.")).toBe(
      "No se pudo enviar.",
    );
    expect(friendlyError(new Error("Cannot read properties of undefined (reading 'id')"), "Ups")).toBe("Ups");
    expect(friendlyError(new Error("Something failed"), "No se pudo guardar.")).toBe("No se pudo guardar.");
    expect(friendlyError(null)).toMatch(/Inténtalo de nuevo/);
    expect(friendlyError(undefined, "X")).toBe("X");
  });
});

describe("isHumanMessage", () => {
  it("corto, en español y sin señales técnicas", () => {
    expect(isHumanMessage("Publicación bloqueada: debes usar publish_profile() tras la validación IA.")).toBe(false);
    expect(isHumanMessage("Transición de estado no permitida: pending -> completed")).toBe(false);
    expect(isHumanMessage("Este turno ya fue tomado por otra persona.")).toBe(true);
    expect(isHumanMessage("error")).toBe(false);
    expect(isHumanMessage("x".repeat(300))).toBe(false);
  });
});

describe("friendlyAuthError — entrar y registrarse en español", () => {
  it("traduce los mensajes de Supabase Auth", () => {
    expect(friendlyAuthError(new Error("Invalid login credentials"))).toMatch(/no coinciden/);
    expect(friendlyAuthError(new Error("User already registered"))).toMatch(/Ya existe una cuenta/);
    expect(friendlyAuthError(new Error("Email not confirmed"))).toMatch(/Confirma tu correo/);
    expect(friendlyAuthError(new Error("Password should be at least 6 characters."))).toBe(
      "La contraseña debe tener al menos 6 caracteres.",
    );
    expect(friendlyAuthError(new Error("Password is known to be weak and easy to guess"))).toMatch(/fácil de adivinar/);
    expect(friendlyAuthError(new Error("Token has expired or is invalid"))).toMatch(/código venció/);
    expect(friendlyAuthError(new Error("For security purposes, you can only request this after 42 seconds."))).toMatch(
      /Espera unos segundos/,
    );
    expect(friendlyAuthError(new Error("Unable to validate email address: invalid format"))).toMatch(/no parece válido/);
  });
  it("lo demás cae a friendlyError", () => {
    expect(friendlyAuthError(new TypeError("Failed to fetch"))).toMatch(/no hay conexión/);
    expect(friendlyAuthError(new Error("weird"), "Algo salió mal")).toBe("Algo salió mal");
  });
});
