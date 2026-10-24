CREATE OR REPLACE FUNCTION public.notify_direct_booking_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.professional_id, 'booking_requested', 'Nueva solicitud de servicio',
      'Una familia solicita tu servicio. Revisa el horario y responde a la solicitud.', '/servicio/' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_direct_booking_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_direct_booking_request() TO service_role;
CREATE TRIGGER trg_notify_direct_booking_request AFTER INSERT ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_direct_booking_request();