import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, Play, Pause, Volume2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listNotificationSounds,
  saveNotificationSound,
  listPendingExtensions,
  type NotificationSound,
} from "@/lib/notification-sounds.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const BUCKET = "notification-sounds";
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".mp3,.wav,.ogg,.m4a,.aac,audio/*";

async function uploadAudio(file: File, eventKey: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
  const path = `${eventKey}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
}

function SoundRow({
  row,
  canEdit,
  onSaved,
}: {
  row: NotificationSound;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const save = useServerFn(saveNotificationSound);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("Audio must be 2MB or smaller");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadAudio(file, row.event_key);
      await save({ data: { id: row.id, audio_url: path } });
      toast.success(`Uploaded audio for ${row.label}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function togglePlay() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!row.audio_url) return;
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.audio_url, 300);
      if (error || !data) throw new Error(error?.message ?? "Could not load audio");
      const el = new Audio(data.signedUrl);
      audioRef.current = el;
      el.onended = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Playback failed");
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await save({ data: { id: row.id, is_active: !row.is_active } });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Volume2 size={15} className="text-muted-foreground" />
          <span className="text-[14px] font-semibold text-foreground">{row.label}</span>
          {!row.is_active && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(row.applies_to ?? []).map((a) => (
            <span
              key={a}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-primary"
            >
              {a}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">{row.event_key}</span>
        </div>
        <p className="mt-1 truncate text-[12px] text-muted-foreground">
          {row.audio_url ? row.audio_url : "No audio uploaded yet"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!row.audio_url}
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[13px] font-semibold text-foreground disabled:opacity-40"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "Stop" : "Preview"}
        </button>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Upload size={14} />
              {busy ? "Working…" : row.audio_url ? "Replace" : "Upload"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleActive()}
              className="h-9 rounded-[8px] border border-border px-3 text-[13px] font-semibold text-muted-foreground disabled:opacity-50"
            >
              {row.is_active ? "Disable" : "Enable"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ExtensionRequests() {
  const fetchExtensions = useServerFn(listPendingExtensions);
  const { data, isLoading } = useQuery({
    queryKey: ["extension-requests", "pending"],
    queryFn: () => fetchExtensions(),
    refetchInterval: 30_000,
  });

  return (
    <section className="mt-8">
      <h2 className="text-[16px] font-bold text-foreground">Pending Extension Requests</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Visibility only — approvals happen in the Partner app.
      </p>
      <div className="mt-4 space-y-2">
        {isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-[13px] text-muted-foreground">No pending extension requests.</p>
        ) : (
          data!.map((x) => (
            <div
              key={x.id}
              className="flex items-center justify-between rounded-[12px] border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-foreground">
                  {x.booking?.service_label ?? "Booking"} · +{x.extra_minutes} min
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  #{x.booking_id.slice(0, 8)} · ₹{Number(x.price).toLocaleString("en-IN")} ·{" "}
                  {x.booking?.status ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Clock size={13} />
                {new Date(x.created_at).toLocaleString("en-IN")}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function NotificationSoundsPage({ role }: { role: StaffRole | null }) {
  const queryClient = useQueryClient();
  const fetchSounds = useServerFn(listNotificationSounds);
  const canEdit = role === "super_admin" || role === "ops_manager";

  const { data, isLoading, error } = useQuery({
    queryKey: ["notification-sounds"],
    queryFn: () => fetchSounds(),
  });

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <h1 className="text-[22px] font-bold text-foreground">Notification Sounds</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Custom alert audio played across the Partner and Customer apps. Max 2MB per file.
      </p>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-destructive">
            {error instanceof Error ? error.message : "Failed to load"}
          </p>
        ) : (
          (data ?? []).map((row) => (
            <SoundRow
              key={row.id}
              row={row}
              canEdit={canEdit}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["notification-sounds"] })}
            />
          ))
        )}
      </div>

      <ExtensionRequests />
    </div>
  );
}
