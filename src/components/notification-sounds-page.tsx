import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, Play, Pause, Clock, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import {
  listNotificationSounds,
  saveNotificationSound,
  listPendingExtensions,
  type NotificationSound,
} from "@/lib/notification-sounds.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";

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
    <tr className="border-b border-border last:border-0">
      <td className="p-3 font-semibold text-foreground">{row.label}</td>
      <td className="p-3">
        <div className="flex flex-wrap gap-1.5">
          {(row.applies_to ?? []).map((a) => (
            <span key={a} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-primary">{a}</span>
          ))}
        </div>
      </td>
      <td className="p-3">
        <button type="button" onClick={togglePlay} disabled={!row.audio_url} aria-label="Play" className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border disabled:opacity-40">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </td>
      <td className="p-3">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${!row.is_active ? "bg-muted text-muted-foreground" : row.audio_url ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
          {!row.is_active ? "Disabled" : row.audio_url ? "Uploaded" : "Missing"}
        </span>
      </td>
      <td className="p-3 text-right">
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button disabled={busy} aria-label="More" className="h-8 w-8 rounded-[8px] hover:bg-muted inline-flex items-center justify-center"><MoreHorizontal size={16} /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload size={14} className="mr-2" />{row.audio_url ? "Replace" : "Upload"}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void toggleActive()}>{row.is_active ? "Disable" : "Enable"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </td>
    </tr>
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
      <p className="text-[13px] text-muted-foreground">Max 2 MB per file.</p>
      <div className="mt-3 rounded-[14px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/40">
            <th className="p-3">Sound</th><th className="p-3">Used in</th><th className="p-3">Play</th><th className="p-3">Status</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
        {isLoading ? (
          <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
        ) : error ? (
          <tr><td colSpan={5} className="p-6 text-center text-destructive">{error instanceof Error ? error.message : "Failed to load"}</td></tr>
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
          </tbody>
        </table>
      </div>

      <ExtensionRequests />
    </div>
  );
}
