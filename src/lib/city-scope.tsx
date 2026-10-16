import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CityOpt = { id: string; name: string; state: string; status: string; is_default: boolean };
type Ctx = {
  cities: CityOpt[];
  canAll: boolean;
  /** Selected city id, or "all". */
  cityId: string;
  city: CityOpt | null;
  setCityId: (id: string) => void;
};

const CityCtx = createContext<Ctx>({ cities: [], canAll: false, cityId: "all", city: null, setCityId: () => {} });
const KEY = "cc_city";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function CityProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ["staff", "my-cities"],
    queryFn: async () => {
      const { data, error } = await db.rpc("staff_my_cities");
      if (error) throw error;
      return data as { can_all: boolean; cities: CityOpt[] };
    },
    staleTime: 60_000,
  });
  const [cityId, setRaw] = useState<string>("");
  useEffect(() => {
    setRaw(localStorage.getItem(KEY) ?? "");
  }, []);
  const cities = q.data?.cities ?? [];
  const canAll = !!q.data?.can_all;
  const valid = cityId === "all" ? canAll : cities.some((c) => c.id === cityId);
  const effective = valid ? cityId : canAll ? "all" : cities[0]?.id ?? "all";
  const value = useMemo<Ctx>(
    () => ({
      cities,
      canAll,
      cityId: effective,
      city: cities.find((c) => c.id === effective) ?? null,
      setCityId: (id) => {
        localStorage.setItem(KEY, id);
        setRaw(id);
      },
    }),
    [cities, canAll, effective],
  );
  return <CityCtx.Provider value={value}>{children}</CityCtx.Provider>;
}

export const useCity = () => useContext(CityCtx);

export function CitySwitcher() {
  const { cities, canAll, cityId, setCityId } = useCity();
  if (!cities.length) return null;
  return (
    <select
      aria-label="City"
      value={cityId}
      onChange={(e) => setCityId(e.target.value)}
      className="h-9 max-w-[140px] rounded-md border border-input bg-background px-2 text-sm font-semibold text-foreground"
    >
      {canAll && <option value="all">All cities</option>}
      {cities.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.status !== "active" ? " (soon)" : ""}
        </option>
      ))}
    </select>
  );
}

/** Wrap pages that edit a city-wise setting: they need one city selected. */
export function RequireCity({ children }: { children: ReactNode }) {
  const { city } = useCity();
  if (!city)
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        This setting is different for each city. Pick one city in the top bar to view or change it.
      </div>
    );
  return <>{children}</>;
}
