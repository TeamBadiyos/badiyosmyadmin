import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import {
  getBookingTracking,
  getCourierTracking,
  type TrackingSnapshot,
} from "@/lib/tracking.functions";

/** A GPS fix older than this means the partner's phone stopped broadcasting. */
export const STALE_GPS_MS = 120_000;

export function isStale(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > STALE_GPS_MS;
}

/**
 * Shared live tracking snapshot for a booking / courier order.
 *
 * Both the map and the share-location box read the SAME query cache entry, so
 * they can never drift apart. On top of a slow safety poll we subscribe to
 * Postgres changes so a new GPS fix is painted the instant it is written.
 */
export function useLiveTracking(kind: "booking" | "courier", id: string) {
  const qc = useQueryClient();
  const fetchCourier = useServerFn(getCourierTracking);
  const fetchBooking = useServerFn(getBookingTracking);

  const queryKey = useMemo(() => ["tracking", kind, id] as const, [kind, id]);

  const query = useQuery<TrackingSnapshot>({
    queryKey,
    queryFn: () =>
      kind === "courier"
        ? fetchCourier({ data: { orderId: id } })
        : fetchBooking({ data: { bookingId: id } }),
    // Safety net only — realtime below does the real work.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const agentId = query.data?.agent?.id ?? null;

  // Live GPS: patch the cached snapshot directly from the realtime payload so
  // the marker and the share links move with zero round-trip.
  useEffect(() => {
    if (!agentId) return;
    const channel = supabase
      .channel(`track-expert-${agentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "experts",
          filter: `id=eq.${agentId}`,
        },
        (payload) => {
          const row = payload.new as {
            current_lat: number | null;
            current_lng: number | null;
            location_updated_at: string | null;
            is_online: boolean | null;
            name: string | null;
            phone: string | null;
          };
          qc.setQueryData<TrackingSnapshot>(queryKey, (prev) => {
            if (!prev?.agent) return prev;
            return {
              ...prev,
              agent: {
                ...prev.agent,
                name: row.name ?? prev.agent.name,
                phone: row.phone ?? prev.agent.phone,
                lat: row.current_lat != null ? Number(row.current_lat) : prev.agent.lat,
                lng: row.current_lng != null ? Number(row.current_lng) : prev.agent.lng,
                updatedAt: row.location_updated_at ?? prev.agent.updatedAt,
                isOnline: row.is_online ?? prev.agent.isOnline,
              },
              fetchedAt: new Date().toISOString(),
            };
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [agentId, qc, queryKey]);

  // Status / assignment changes on the order itself — refetch the full snapshot.
  useEffect(() => {
    const table = kind === "courier" ? "courier_orders" : "bookings";
    const channel = supabase
      .channel(`track-${kind}-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table, filter: `id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [kind, id, qc, queryKey]);

  return query;
}
