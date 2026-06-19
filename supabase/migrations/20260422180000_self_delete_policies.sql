-- =============================================================
-- Self-delete policies
-- Permite al usuario eliminar su PROPIO perfil (familiar o profesional)
-- pero NUNCA el de otros. Staff conserva acceso total vía is_staff().
-- =============================================================

-- 1. family_profiles: delete self
DROP POLICY IF EXISTS "family_delete_self" ON public.family_profiles;
CREATE POLICY "family_delete_self" ON public.family_profiles
  FOR DELETE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 2. professional_profiles: delete self
DROP POLICY IF EXISTS "pro_delete_self" ON public.professional_profiles;
CREATE POLICY "pro_delete_self" ON public.professional_profiles
  FOR DELETE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 3. professional_documents: delete self (si no existía)
DROP POLICY IF EXISTS "pro_docs_delete_self" ON public.professional_documents;
CREATE POLICY "pro_docs_delete_self" ON public.professional_documents
  FOR DELETE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 4. family_documents: delete self (si no existía)
DROP POLICY IF EXISTS "fdocs_delete_owner_or_staff" ON public.family_documents;
CREATE POLICY "fdocs_delete_owner_or_staff" ON public.family_documents
  FOR DELETE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 5. user_roles: eliminar SOLO el propio rol 'family' o 'professional'.
-- Nunca permitir auto-asignar/eliminar roles de superadmin/evaluator/hr_staff.
DROP POLICY IF EXISTS "user_roles_delete_self_basic" ON public.user_roles;
CREATE POLICY "user_roles_delete_self_basic" ON public.user_roles
  FOR DELETE USING (
    (auth.uid() = user_id AND role IN ('family', 'professional', 'institution'))
    OR public.is_staff(auth.uid())
  );
