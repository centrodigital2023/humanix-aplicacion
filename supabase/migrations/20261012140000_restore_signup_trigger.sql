-- ═══════════════════════════════════════════════════════════════════════════════
-- Registro de usuarios: restablece el disparador que crea el perfil y asigna el rol
--
-- Qué pasaba. La función `public.handle_new_user()` (crea la fila de `profiles`, asigna el rol elegido al registrarse y crea el
-- perfil de familia, profesional o institución) existe en producción, pero **el disparador `on_auth_user_created` sobre
-- `auth.users` no existe** (revisado el 2026-10-12: en `auth.users` solo había los disparadores internos de claves foráneas).
-- Efecto: toda cuenta creada desde el 5 de octubre quedó sin perfil y sin rol. La pantalla lo disimula (si `user_roles` está
-- vacío usa el rol de los metadatos), pero lo que decide la base no: las vistas de los mapas se construyen desde `user_roles`
-- (esas cuentas no aparecían), y reglas como `apps_insert_pro` exigen `has_role(…, 'professional')` (esos profesionales no
-- podían postularse).
--
-- Qué hace. Solo vuelve a crear el disparador. No toca cuentas existentes: lo que se haga con ellas (rellenarlas o borrarlas) es
-- decisión aparte. Es idempotente y falla si falta la función, en vez de dejar un registro a medias.
--
-- Nota: `handle_new_user()` no tiene EXECUTE para PUBLIC, anon ni authenticated (20260622163527). Eso no impide que el disparador
-- funcione: PostgreSQL comprueba el permiso de EXECUTE sobre la función de un disparador al crearlo, no cada vez que se dispara.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.handle_new_user(): no se puede crear el disparador de registro';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Falta auth.users';
  END IF;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
END $$;
