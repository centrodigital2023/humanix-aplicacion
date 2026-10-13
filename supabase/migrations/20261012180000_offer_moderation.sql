-- ═══════════════════════════════════════════════════════════════════════════════
-- Moderación de ofertas en el servidor (decisión pedida el 2026-10-12)
--
-- Pedido: «la familia / el profesional no puede publicar ofertas groseras, artículos, o que no sean de salud o cuidado».
-- Hoy solo había una revisión en el navegador de teléfonos, correos y datos de pago (`checkOutgoingMessage`); quien llamara a la API
-- directamente publicaba lo que quisiera. Esta migración pone la regla DONDE NO SE PUEDE SALTAR: un disparador BEFORE en cada tabla
-- donde se escribe texto público.
--
--   • `hx_text_norm(text)`: minúsculas, sin tildes ni ñ (también en mayúsculas, sin depender de la configuración regional), letras
--     repetidas (3 o más) reducidas a una, signos fuera.
--   • `hx_offer_text_issue(text, require_care)`: devuelve NULL si el texto está bien o el motivo del rechazo:
--       'rude'     lenguaje ofensivo o sexual;
--       'sale'     venta, compra, alquiler o rifa de artículos (esto es un mercado de cuidado, no de cosas);
--       'offtopic' (solo si require_care) no menciona nada de salud o cuidado.
--     Las listas están aquí y espejadas en `src/lib/contentModeration.ts`; una prueba compara ambas.
--   • `hx_offer_guard()`: el disparador. Solo revisa lo que CAMBIA en cada fila, y además de lo anterior rechaza teléfonos, correos,
--     enlaces, direcciones y datos de pago en textos públicos ('contact': el contacto se desbloquea según el plan, los pagos solo en
--     la web). No se aplica al servidor (sin sesión): los trabajos del sistema y el superadmin por la función de moderación no se bloquean.
--
--   Dónde se aplica y con qué reglas:
--     family_needs (care_type, notes)                         → ofensivo, venta, ajeno a salud/cuidado, contacto
--     job_offers de FAMILIA (título, descripción, especialidad, zona) → ofensivo, venta, ajeno a salud/cuidado
--     job_offers de INSTITUCIÓN                               → ofensivo, venta (son IPS/EPS: el tema ya es salud)
--     availability_slots (note)                               → ofensivo, venta, contacto
--     professional_profiles (bio) y profiles (bio)            → ofensivo, venta, contacto
--
-- Límites: es un filtro de primera línea (lista de palabras), no un clasificador. No lee variaciones muy disfrazadas; para eso siguen
-- la revisión humana (`moderate_offer`) y los reportes. No toca el texto que ya estaba guardado.
--
-- Idempotente. Si una tabla no existe, no le pone el disparador.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_mod$
BEGIN
  -- ── 1) Texto normalizado ───────────────────────────────────────────────────
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_text_norm(p text)
    RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
      SELECT btrim(regexp_replace(
               regexp_replace(
                 lower(translate(COALESCE(p, ''), 'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ', 'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN')),
                 '([a-z])\1{2,}', '\1', 'g'),
               '[^a-z0-9]+', ' ', 'g'))
    $fn$
  $f$;

  -- ── 2) Qué problema tiene un texto ─────────────────────────────────────────
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_offer_text_issue(p_text text, p_require_care boolean DEFAULT false)
    RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
    DECLARE
      t text := public.hx_text_norm(p_text);
      -- Las listas van sobre el texto YA normalizado (sin tildes, una sola separación). Cámbialas junto con src/lib/contentModeration.ts.
      rude_terms constant text := 'puta|putas|puto|putos|hdp|gonorrea|gonorreas|mierda|mierdas|carajo|verga|pirobo|pirobos|piroba|cabron|cabrona|cabrones|chingar|chingada|chingado|joder|jodete|pendejo|pendeja|pendejos|pendejas|imbecil|imbeciles|estupido|estupida|estupidos|idiota|idiotas|zorra|zorras|maldito|maldita|malditos|desgraciado|desgraciada|bastardo|bastarda|lambon|mamagallo|maricon|maricones|escort|prepago|prepagos|porno|pornografia|onlyfans|erotico|erotica|eroticos|eroticas|sexuales|desnudo|desnuda|desnudos';
      rude_stems constant text := 'hijueput|hijoput|hijoeput|mamaverg|malparid';
      sale_terms constant text := 'vendo|vendemos|se vende|se venden|en venta|a la venta|venta de|ventas de|remato|rematamos|en remate|compro|compramos|se compra|se compran|permuto|distribuidor|distribuidora|mayorista|catalogo|mercancia|envio gratis|2x1|oferta imperdible|ofertas imperdibles|precio de fabrica|se arrienda|se arriendan|se alquila|se alquilan|arriendo|alquilo|alquiler de|dropshipping|multinivel|red de mercadeo|herbalife|tupperware|forex|bitcoin|criptomonedas|apuestas|rifa|casino|dinero facil|gana dinero';
      sale_context constant text := '(vend|compr|ofrezc|remat|venta|distribu|fabric)\w*( \w+){0,4} (articulo|articulos|producto|productos|mercancia)';
      care_stems constant text := 'enferm|cuid|medic|terap|fisio|kinesi|geriatr|paliativ|ancian|paciente|salud|clinic|hospital|urgenc|ventilad|sonda|curacion|inyect|glucos|glucomet|oxigen|tension|postoperat|rehabilit|psicolog|psiquiatr|nutric|pediatr|neonat|maternid|lactanc|fonoaudiolog|ocupacional|respirator|alzheimer|demenc|discapacit|parkinson|diabet|hipertens|acompan|movilizac|higiene|banar|dialisis|quimioterap|oncolog|cardiolog|neurolog|domiciliari|dependiente|postrad|ulcera|escara|cirug|herida|odontolog|panal|nebuliz|insulina';
      care_terms constant text := 'ips|eps|uci|ucin|epoc|acv|ecg|ekg|cpap|bipap|signos vitales|adulto mayor|adultos mayores|persona mayor|personas mayores|tercera edad|recien nacido|cama hospitalaria|silla de ruedas|trabajo social|presion arterial';
    BEGIN
      IF t = '' THEN
        RETURN NULL;
      END IF;
      IF t ~ ('\m(' || rude_terms || ')\M') OR t ~ ('\m(' || rude_stems || ')') THEN
        RETURN 'rude';
      END IF;
      IF t ~ ('\m(' || sale_terms || ')\M') OR t ~ ('\m' || sale_context || '\M') THEN
        RETURN 'sale';
      END IF;
      IF p_require_care AND NOT (t ~ ('\m(' || care_stems || ')') OR t ~ ('\m(' || care_terms || ')\M')) THEN
        RETURN 'offtopic';
      END IF;
      RETURN NULL;
    END
    $fn$
  $f$;

  -- ── 3) El disparador ───────────────────────────────────────────────────────
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_offer_guard()
    RETURNS trigger
    LANGUAGE plpgsql SET search_path = public AS $fn$
    DECLARE
      kind          text := TG_ARGV[0];
      j             jsonb := to_jsonb(NEW);
      o             jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      cols          text[];
      c             text;
      all_text      text := '';
      changed       boolean := false;
      require_care  boolean := false;
      check_contact boolean := false;
      issue         text;
    BEGIN
      -- Trabajos del sistema (sin sesión): no se bloquean.
      IF auth.uid() IS NULL THEN
        RETURN NEW;
      END IF;
      IF kind = 'family_need' THEN
        cols := ARRAY['care_type', 'notes'];
        require_care := true;
        check_contact := true;
      ELSIF kind = 'job_offer' THEN
        cols := ARRAY['title', 'description', 'specialty_required', 'service_area'];
        require_care := (j->>'poster_type') = 'family';
      ELSIF kind = 'availability' THEN
        cols := ARRAY['note'];
        check_contact := true;
      ELSIF kind = 'bio' THEN
        cols := ARRAY['bio'];
        check_contact := true;
      ELSE
        RETURN NEW;
      END IF;

      -- Solo lo que cambia: una fila antigua con texto que hoy no pasaría puede seguir actualizando otras columnas.
      FOREACH c IN ARRAY cols LOOP
        IF (j->>c) IS DISTINCT FROM (o->>c) THEN
          changed := true;
        END IF;
        all_text := all_text || ' ' || COALESCE(j->>c, '');
      END LOOP;
      IF NOT changed THEN
        RETURN NEW;
      END IF;

      issue := public.hx_offer_text_issue(all_text, require_care);
      IF issue IS NULL AND check_contact AND to_regprocedure('public.message_has_forbidden_content(text)') IS NOT NULL
         AND public.message_has_forbidden_content(all_text) THEN
        issue := 'contact';
      END IF;
      IF issue IS NOT NULL THEN
        RAISE EXCEPTION '%', CASE issue
          WHEN 'rude'     THEN 'Tu texto tiene lenguaje ofensivo. Escríbelo con respeto.'
          WHEN 'sale'     THEN 'En Humanix solo se publican ofertas de salud y cuidado: no se venden, compran ni arriendan artículos.'
          WHEN 'offtopic' THEN 'Tu oferta no parece de salud o cuidado. Cuéntanos qué cuidado necesitas (por ejemplo: enfermería, acompañamiento, curaciones, terapias).'
          ELSE                 'No incluyas teléfonos, correos, enlaces ni direcciones en el texto: el contacto se desbloquea según tu plan y los pagos se hacen solo en la página web.'
        END USING ERRCODE = '23514', HINT = 'offer_' || issue;
      END IF;
      RETURN NEW;
    END
    $fn$
  $f$;

  -- ── 4) Dónde se aplica ─────────────────────────────────────────────────────
  IF to_regclass('public.family_needs') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_family_needs_moderation ON public.family_needs';
    EXECUTE 'CREATE TRIGGER trg_family_needs_moderation BEFORE INSERT OR UPDATE OF care_type, notes ON public.family_needs
             FOR EACH ROW EXECUTE FUNCTION public.hx_offer_guard(''family_need'')';
  END IF;
  IF to_regclass('public.job_offers') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_job_offers_moderation ON public.job_offers';
    EXECUTE 'CREATE TRIGGER trg_job_offers_moderation BEFORE INSERT OR UPDATE OF title, description, specialty_required, service_area ON public.job_offers
             FOR EACH ROW EXECUTE FUNCTION public.hx_offer_guard(''job_offer'')';
  END IF;
  IF to_regclass('public.availability_slots') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_availability_slots_moderation ON public.availability_slots';
    EXECUTE 'CREATE TRIGGER trg_availability_slots_moderation BEFORE INSERT OR UPDATE OF note ON public.availability_slots
             FOR EACH ROW EXECUTE FUNCTION public.hx_offer_guard(''availability'')';
  END IF;
  IF to_regclass('public.professional_profiles') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_professional_profiles_moderation ON public.professional_profiles';
    EXECUTE 'CREATE TRIGGER trg_professional_profiles_moderation BEFORE INSERT OR UPDATE OF bio ON public.professional_profiles
             FOR EACH ROW EXECUTE FUNCTION public.hx_offer_guard(''bio'')';
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_profiles_moderation ON public.profiles';
    EXECUTE 'CREATE TRIGGER trg_profiles_moderation BEFORE INSERT OR UPDATE OF bio ON public.profiles
             FOR EACH ROW EXECUTE FUNCTION public.hx_offer_guard(''bio'')';
  END IF;

  -- Las funciones auxiliares se pueden llamar (son puras y no leen datos); el disparador, solo por el motor de triggers.
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_offer_guard() FROM PUBLIC, anon, authenticated';
END
$hx_mod$;
