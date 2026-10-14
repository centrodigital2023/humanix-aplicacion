# Propuesta: tablero de tareas del círculo familiar («quién hace qué»)

> **Borrador SIN PROBAR.** No está en `supabase/migrations/` a propósito: en esta sesión no había PostgreSQL para ensayarlo.
> Antes de usarlo: copiarlo a `supabase/migrations/<AAAAMMDDHHMMSS>_care_circle_tasks.sql`, probarlo en la réplica
> (`supabase/e2e/*/run.sh`), hacer el simulacro en producción (`docs/MIGRACIONES.md` §3) y recién entonces escribir la interfaz.
> La interfaz **no** está conectada; no hay código que dependa de esta tabla.

## Qué resuelve

Quién llevó a la cita, quién compra lo que falta, quién cubre la noche del sábado. Hoy el círculo (`care_circle_members`) solo
permite ver los servicios del titular; no hay forma de repartir el cuidado ni de evitar que una sola persona cargue con todo.

## Decisiones

- Participan el titular y los miembros con `status = 'accepted'` (la misma relación que ya usa `bookings_select_circle`).
- El título es texto corto y libre; la interfaz debe avisar **«no escribas datos clínicos aquí»** (Ley 1581 de 2012).
- Nadie puede cambiar a quién pertenece la tarea ni quién la creó; una tarea asignada solo puede asignarse a alguien del círculo.
- Sin recordatorios ni insistencia: una tarea sin hacer no genera avisos ni «tareas atrasadas» en rojo.
- Sin pagos ni dinero en ningún campo.

## SQL propuesto

```sql
-- Participante del círculo: titular o miembro aceptado.
CREATE OR REPLACE FUNCTION public.is_circle_participant(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    auth.uid() = p_owner OR EXISTS (
      SELECT 1 FROM public.care_circle_members m
      WHERE m.owner_id = p_owner AND m.member_id = auth.uid() AND m.status = 'accepted'
    )
  );
$$;
REVOKE ALL ON FUNCTION public.is_circle_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_circle_participant(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.care_circle_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  due_on      date,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_care_circle_tasks_owner ON public.care_circle_tasks (owner_id, done_at);

ALTER TABLE public.care_circle_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_circle_tasks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.care_circle_tasks TO authenticated;

DROP POLICY IF EXISTS cct_select ON public.care_circle_tasks;
CREATE POLICY cct_select ON public.care_circle_tasks
  FOR SELECT TO authenticated USING (public.is_circle_participant(owner_id));

DROP POLICY IF EXISTS cct_insert ON public.care_circle_tasks;
CREATE POLICY cct_insert ON public.care_circle_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_circle_participant(owner_id)
    AND (assignee_id IS NULL OR public.is_circle_participant(owner_id))
  );

DROP POLICY IF EXISTS cct_update ON public.care_circle_tasks;
CREATE POLICY cct_update ON public.care_circle_tasks
  FOR UPDATE TO authenticated
  USING (public.is_circle_participant(owner_id))
  WITH CHECK (public.is_circle_participant(owner_id));

DROP POLICY IF EXISTS cct_delete ON public.care_circle_tasks;
CREATE POLICY cct_delete ON public.care_circle_tasks
  FOR DELETE TO authenticated USING (auth.uid() = owner_id OR auth.uid() = created_by);

-- Ni el titular ni quien la creó se pueden cambiar con un UPDATE.
CREATE OR REPLACE FUNCTION public.care_circle_tasks_keep_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.owner_id := OLD.owner_id;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cct_keep_owner ON public.care_circle_tasks;
CREATE TRIGGER trg_cct_keep_owner BEFORE UPDATE ON public.care_circle_tasks
  FOR EACH ROW EXECUTE FUNCTION public.care_circle_tasks_keep_owner();
```

## Pendientes conocidos del borrador

1. **Falta validar que `assignee_id` sea del círculo del titular** (la política de inserción lo repite sobre el titular, no sobre el asignado). Resolverlo con una función `is_circle_participant_of(owner, user)` o un trigger, y probarlo con un mutante.
2. Probar en la réplica: un extraño no ve nada; un miembro `invited` o `declined` no ve nada; un miembro aceptado no cambia `owner_id` ni `created_by`.
3. Decidir si el titular puede quitar a un miembro y qué pasa con sus tareas asignadas (hoy `assignee_id` queda en `NULL` solo si se borra el usuario, no al salir del círculo).
4. Interfaz (cuando exista la tabla): lista corta en la tarjeta de la ruta, «Me encargo yo» en un toque, sin contadores de atraso ni comparaciones entre personas.
5. Tiempo real con Supabase Realtime, no sondeo (`AGENTS.md`).
