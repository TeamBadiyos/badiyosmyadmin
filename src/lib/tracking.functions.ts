import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TrackPoint = {
  lat: number;
  lng: number;
  label: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

export type TrackingSnapshot = {
  kind: "courier" | "booking";
  id: string;
  code: string;
  status: string;
  phase: "searching" | "to_pickup" | "to_drop" | "done" | "cancelled";
  phaseLabel: string;
  pickup: TrackPoint | null;
  drop: TrackPoint | null;
  agent: {
    id: string;
    name: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    updatedAt: string | null;
    isOnline: boolean;
  } | null;
  fetchedAt: string;
};

type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

async function requireStaff(context: Ctx) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return data.role as string;
}

function courierPhase(status: string): {
  phase: TrackingSnapshot["phase"];
  phaseLabel: string;
} {
  switch (status) {
    case "QUOTED":
    case "REQUESTED":
    case "PAID":
    case "SEARCHING":
      return { phase: "searching", phaseLabel: "Finding a nearby rider…" };
    case "DRIVER_ASSIGNED":
    case "ASSIGNED":
      return { phase: "to_pickup", phaseLabel: "Rider on the way to pick-up" };
    case "ARRIVED_PICKUP":
      return { phase: "to_pickup", phaseLabel: "Rider reached the pick-up point" };
    case "PICKED_UP":
    case "IN_TRANSIT":
      return { phase: "to_drop", phaseLabel: "Parcel collected — on the way to drop" };
    case "DELIVERED":
    case "COMPLETED":
      return { phase: "done", phaseLabel: "Delivered successfully" };
    case "CANCELLED":
    case "FAILED_DELIVERY":
      return { phase: "cancelled", phaseLabel: "Order closed" };
    default:
      return { phase: "searching", phaseLabel: status.replace(/_/g, " ") };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAgent(db: any, expertId: string | null) {
  if (!expertId) return null;
  const { data } = await db
    .from("experts")
    .select("id, name, phone, current_lat, current_lng, location_updated_at, is_online")
    .eq("id", expertId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    lat: data.current_lat != null ? Number(data.current_lat) : null,
    lng: data.current_lng != null ? Number(data.current_lng) : null,
    updatedAt: (data.location_updated_at as string | null) ?? null,
    isOnline: !!data.is_online,
  };
}

export const getCourierTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TrackingSnapshot> => {
    await requireStaff(context);
    const db = context.supabase;
    const { data: o, error } = await db
      .from("courier_orders")
      .select(
        "id, order_code, status, pickup_address, pickup_lat, pickup_lng, pickup_contact_name, pickup_contact_phone, drop_address, drop_lat, drop_lng, drop_contact_name, drop_contact_phone, assigned_expert_id",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!o) throw new Error("Order not found");

    const { phase, phaseLabel } = courierPhase(o.status as string);
    return {
      kind: "courier",
      id: o.id as string,
      code: o.order_code as string,
      status: o.status as string,
      phase,
      phaseLabel,
      pickup:
        o.pickup_lat != null && o.pickup_lng != null
          ? {
              lat: Number(o.pickup_lat),
              lng: Number(o.pickup_lng),
              label: "Pick-up",
              address: (o.pickup_address as string | null) ?? null,
              contactName: (o.pickup_contact_name as string | null) ?? null,
              contactPhone: (o.pickup_contact_phone as string | null) ?? null,
            }
          : null,
      drop:
        o.drop_lat != null && o.drop_lng != null
          ? {
              lat: Number(o.drop_lat),
              lng: Number(o.drop_lng),
              label: "Drop",
              address: (o.drop_address as string | null) ?? null,
              contactName: (o.drop_contact_name as string | null) ?? null,
              contactPhone: (o.drop_contact_phone as string | null) ?? null,
            }
          : null,
      agent: await loadAgent(db, (o.assigned_expert_id as string | null) ?? null),
      fetchedAt: new Date().toISOString(),
    };
  });

function bookingPhase(status: string): {
  phase: TrackingSnapshot["phase"];
  phaseLabel: string;
} {
  switch (status) {
    case "confirmed":
    case "accepted":
      return { phase: "searching", phaseLabel: "Finding a nearby expert…" };
    case "expert_assigned":
      return { phase: "to_drop", phaseLabel: "Expert on the way to the customer" };
    case "in_progress":
      return { phase: "to_drop", phaseLabel: "Expert is at the job" };
    case "completed":
      return { phase: "done", phaseLabel: "Job completed" };
    default:
      return { phase: "cancelled", phaseLabel: "Booking closed" };
  }
}

export const getBookingTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TrackingSnapshot> => {
    await requireStaff(context);
    const db = context.supabase;
    const { data: b, error } = await db
      .from("bookings")
      .select(
        "id, status, service_label, booking_lat, booking_lng, address_id, assigned_expert_id, user_id",
      )
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!b) throw new Error("Booking not found");

    let lat = b.booking_lat != null ? Number(b.booking_lat) : null;
    let lng = b.booking_lng != null ? Number(b.booking_lng) : null;
    let address: string | null = null;
    if (b.address_id) {
      const { data: addr } = await db
        .from("addresses")
        .select("full_address, latitude, longitude")
        .eq("id", b.address_id)
        .maybeSingle();
      if (addr) {
        address = (addr.full_address as string | null) ?? null;
        if (lat == null && addr.latitude != null) lat = Number(addr.latitude);
        if (lng == null && addr.longitude != null) lng = Number(addr.longitude);
      }
    }

    let contactName: string | null = null;
    let contactPhone: string | null = null;
    if (b.user_id) {
      const { data: u } = await db
        .from("users")
        .select("full_name, phone")
        .eq("id", b.user_id)
        .maybeSingle();
      contactName = (u?.full_name as string | null) ?? null;
      contactPhone = (u?.phone as string | null) ?? null;
    }

    const { phase, phaseLabel } = bookingPhase(b.status as string);
    return {
      kind: "booking",
      id: b.id as string,
      code: (b.service_label as string | null) ?? "Booking",
      status: b.status as string,
      phase,
      phaseLabel,
      pickup: null,
      drop:
        lat != null && lng != null
          ? {
              lat,
              lng,
              label: "Job location",
              address,
              contactName,
              contactPhone,
            }
          : null,
      agent: await loadAgent(db, (b.assigned_expert_id as string | null) ?? null),
      fetchedAt: new Date().toISOString(),
    };
  });

/* --------------------------- Road route (Routes API) --------------------------- */

export type RoadRoute = {
  polyline: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

type LatLng = { lat: number; lng: number };

// Google removed the legacy Directions API for new projects, so the browser
// DirectionsService returns REQUEST_DENIED and the map falls back to a straight
// line. We call the current Routes API server-side instead and hand the encoded
// polyline to the map.
export const getRoadRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stops: LatLng[] }) => {
    const stops = Array.isArray(input?.stops) ? input.stops : [];
    if (stops.length < 2) throw new Error("At least two stops required");
    if (stops.length > 5) throw new Error("Too many stops");
    for (const s of stops) {
      if (typeof s?.lat !== "number" || typeof s?.lng !== "number") {
        throw new Error("Invalid stop");
      }
    }
    return { stops };
  })
  .handler(async ({ data, context }): Promise<RoadRoute> => {
    await requireStaff(context);
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("Google Maps key not configured.");

    const point = (p: LatLng) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    });
    const stops = data.stops;
    const body = {
      origin: point(stops[0]),
      destination: point(stops[stops.length - 1]),
      intermediates: stops.slice(1, -1).map(point),
      travelMode: "TWO_WHEELER",
      polylineQuality: "HIGH_QUALITY",
    };

    // The project key is referrer-restricted, so a server call must present an
    // allowed referrer. Try the known site referrers in turn.
    const referrers = [
      "https://badiyosmyadmin.lovable.app",
      "https://www.badiyos.com",
      "https://badiyos.com",
    ];
    let res: Response | null = null;
    let lastBody = "";
    for (const referer of referrers) {
      res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          Referer: referer,
          Origin: referer,
          "X-Goog-FieldMask":
            "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      lastBody = await res.text();
      if (res.status !== 403) break;
    }
    if (!res || !res.ok) {
      throw new Error(`Route lookup failed [${res?.status ?? 0}]: ${lastBody}`);
    }
    const json = (await res.json()) as {
      routes?: Array<{
        polyline?: { encodedPolyline?: string };
        distanceMeters?: number;
        duration?: string;
      }>;
    };
    const r = json.routes?.[0];
    return {
      polyline: r?.polyline?.encodedPolyline ?? null,
      distanceMeters: r?.distanceMeters ?? null,
      durationSeconds: r?.duration ? Number(String(r.duration).replace("s", "")) : null,
    };
  });
