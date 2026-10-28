import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export const pendingBookingsKey = (userId: string) => ["pending-bookings", userId] as const;

export function usePendingBookings(userId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: pendingBookingsKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_bookings")
        .select("id, scheduled_at, duration_hours, total_amount, payment_mode, created_at")
        .eq("professional_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  useRealtimeRefresh(
    `pending-bookings-${userId}`,
    [{ table: "service_bookings", filter: `professional_id=eq.${userId}` }],
    () => {
      void qc.invalidateQueries({ queryKey: pendingBookingsKey(userId) });
    },
    Boolean(userId),
  );
  return query;
}

/**
 * El profesional acepta una solicitud pendiente. Solo cambia si sigue «pendiente» (si otro la tomó o la cancelaron,
 * no hay filas y se devuelve false). Las reglas de la transición las impone la base (`guard_booking_integrity`).
 */
export async function acceptPendingBooking(bookingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("service_bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return Boolean(data?.length);
}
