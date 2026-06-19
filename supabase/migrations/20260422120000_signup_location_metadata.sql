-- Capture device geolocation taken at signup and persist it into the
-- appropriate profile tables so the "Ubicación principal de servicio"
-- is ready from the moment the account is created.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role public.app_role;
  v_meta_role TEXT;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_address TEXT;
BEGIN
  -- Parse optional geo metadata provided by the signup form (device GPS).
  BEGIN
    v_lat := NULLIF(NEW.raw_user_meta_data->>'lat', '')::DOUBLE PRECISION;
  EXCEPTION WHEN OTHERS THEN v_lat := NULL;
  END;
  BEGIN
    v_lng := NULLIF(NEW.raw_user_meta_data->>'lng', '')::DOUBLE PRECISION;
  EXCEPTION WHEN OTHERS THEN v_lng := NULL;
  END;
  v_address := NULLIF(NEW.raw_user_meta_data->>'address', '');

  INSERT INTO public.profiles (user_id, full_name, email, phone, city)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'city'
  );

  v_meta_role := NEW.raw_user_meta_data->>'role';
  IF v_meta_role IN ('professional','family','institution') THEN
    v_role := v_meta_role::public.app_role;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
      ON CONFLICT DO NOTHING;

    IF v_role = 'professional' THEN
      INSERT INTO public.professional_profiles (user_id, lat, lng, home_city)
      VALUES (NEW.id, v_lat, v_lng, NEW.raw_user_meta_data->>'city')
        ON CONFLICT (user_id) DO UPDATE
          SET lat = COALESCE(EXCLUDED.lat, public.professional_profiles.lat),
              lng = COALESCE(EXCLUDED.lng, public.professional_profiles.lng),
              home_city = COALESCE(EXCLUDED.home_city, public.professional_profiles.home_city);
    ELSIF v_role = 'institution' THEN
      INSERT INTO public.institution_profiles (user_id, institution_name, city, address)
      VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'institution_name','Institución'),
        NEW.raw_user_meta_data->>'city',
        v_address
      )
        ON CONFLICT (user_id) DO UPDATE
          SET city = COALESCE(EXCLUDED.city, public.institution_profiles.city),
              address = COALESCE(EXCLUDED.address, public.institution_profiles.address);
    ELSIF v_role = 'family' THEN
      INSERT INTO public.family_profiles (user_id, default_lat, default_lng, default_address)
      VALUES (NEW.id, v_lat, v_lng, v_address)
        ON CONFLICT (user_id) DO UPDATE
          SET default_lat = COALESCE(EXCLUDED.default_lat, public.family_profiles.default_lat),
              default_lng = COALESCE(EXCLUDED.default_lng, public.family_profiles.default_lng),
              default_address = COALESCE(EXCLUDED.default_address, public.family_profiles.default_address);
    END IF;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'family')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.family_profiles (user_id, default_lat, default_lng, default_address)
    VALUES (NEW.id, v_lat, v_lng, v_address)
      ON CONFLICT (user_id) DO UPDATE
        SET default_lat = COALESCE(EXCLUDED.default_lat, public.family_profiles.default_lat),
            default_lng = COALESCE(EXCLUDED.default_lng, public.family_profiles.default_lng),
            default_address = COALESCE(EXCLUDED.default_address, public.family_profiles.default_address);
  END IF;

  RETURN NEW;
END;
$function$;
