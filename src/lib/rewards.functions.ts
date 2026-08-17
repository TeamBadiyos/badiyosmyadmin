import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RewardTriggerType = {
  key: string;
  label: string;
  description: string | null;
  actor_types: string[];
  condition_schema: Array<{
    field: string;
    label: string;
    type: string;
    options?: string[];
    default?: string | number;
    optional?: boolean;
  }>;
  is_time_based: boolean;
  display_order: number;
};

export type RewardCondition = Record<string, string | number | boolean | null>;

export type RewardProgram = {
  id: string;
  name: string;
  actor_type: string;
  trigger_type: string;
  condition: RewardCondition;
  reward_type: string;
  reward_value: number;
  recurrence: string;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RewardProgramStat = {
  program_id: string;
  times_triggered: number;
  total_value: number;
  reversed_count: number;
  last_credited_at: string | null;
};

export type RewardLedgerRow = {
  id: string;
  program_id: string;
  program_name: string;
  actor_type: string;
  actor_id: string;
  actor_name: string | null;
  actor_phone: string | null;
  trigger_event_ref: string;
  reward_type: string;
  reward_value: number;
  status: string;
  credited_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  notes: string | null;
};

export const listRewardTriggerTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RewardTriggerType[]> => {
    const { data, error } = await (context.supabase as any)
      .from("reward_trigger_types")
      .select("*")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as RewardTriggerType[];
  });

export const listRewardPrograms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { actor_type?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<RewardProgram[]> => {
    let q = (context.supabase as any)
      .from("reward_programs")
      .select("*")
      .order("created_at", { ascending: false });
    if (data?.actor_type) q = q.eq("actor_type", data.actor_type);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      reward_value: Number(r.reward_value ?? 0),
      condition: r.condition ?? {},
    })) as RewardProgram[];
  });

export const upsertRewardProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string | null;
      name: string;
      actor_type: string;
      trigger_type: string;
      condition: RewardCondition;
      reward_type: string;
      reward_value: number;
      recurrence: string;
      valid_from?: string | null;
      valid_until?: string | null;
      is_active: boolean;
    }) => {
      if (!input.name?.trim()) throw new Error("Name is required");
      if (!input.trigger_type) throw new Error("Trigger type is required");
      if (!(input.reward_value >= 0)) throw new Error("Reward value must be non-negative");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase as any).rpc("staff_upsert_reward_program", {
      _id: data.id ?? null,
      _name: data.name.trim(),
      _actor_type: data.actor_type,
      _trigger_type: data.trigger_type,
      _condition: data.condition ?? {},
      _reward_type: data.reward_type,
      _reward_value: data.reward_value,
      _recurrence: data.recurrence,
      _valid_from: data.valid_from || null,
      _valid_until: data.valid_until || null,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setRewardProgramActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("staff_set_reward_program_active", {
      _id: data.id,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRewardProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("staff_delete_reward_program", {
      _id: data.id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getRewardProgramStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string | null; to?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<RewardProgramStat[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("staff_reward_program_stats", {
      _from: data?.from || null,
      _to: data?.to || null,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      program_id: r.program_id,
      times_triggered: Number(r.times_triggered ?? 0),
      total_value: Number(r.total_value ?? 0),
      reversed_count: Number(r.reversed_count ?? 0),
      last_credited_at: r.last_credited_at ?? null,
    }));
  });

export const searchRewardLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input:
        | {
            actor_type?: string | null;
            program_id?: string | null;
            search?: string | null;
            from?: string | null;
            to?: string | null;
          }
        | undefined,
    ) => input ?? {},
  )
  .handler(async ({ data, context }): Promise<RewardLedgerRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("staff_reward_ledger_search", {
      _actor_type: data?.actor_type || null,
      _program_id: data?.program_id || null,
      _search: data?.search || null,
      _from: data?.from || null,
      _to: data?.to || null,
      _limit: 200,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      reward_value: Number(r.reward_value ?? 0),
    })) as RewardLedgerRow[];
  });

export const reverseReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ledger_id: string; reason: string }) => {
    if (!input?.ledger_id) throw new Error("ledger_id required");
    if (!input.reason?.trim()) throw new Error("Reason required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("staff_reverse_reward", {
      _ledger_id: data.ledger_id,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runRewardPeriodJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { period_start?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<{ granted: number }> => {
    const { data: n, error } = await (context.supabase as any).rpc("staff_run_reward_period_jobs", {
      _period_start: data?.period_start || null,
    });
    if (error) throw new Error(error.message);
    return { granted: Number(n ?? 0) };
  });
