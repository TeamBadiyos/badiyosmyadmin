import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import {
  listCapacityMessages,
  saveCapacityMessage,
  type CapacityMessage,
} from "@/lib/capacity.functions";

function MessageRow({ row, onSaved }: { row: CapacityMessage; onSaved: () => void }) {
  const save = useServerFn(saveCapacityMessage);
  const [text, setText] = useState(row.message_text);
  const [busy, setBusy] = useState(false);

  type SavePayload = {
    id?: string;
    message_key?: string;
    message_text?: string;
    city?: string;
    is_active?: boolean;
    delete?: boolean;
  };

  async function run(payload: SavePayload, ok: string) {
    setBusy(true);
    try {
      await save({ data: payload });
      toast.success(ok);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const isDefault = row.message_key === "default";

  return (
    <div className="rounded-[16px] border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareText size={15} className="text-primary" />
        <span className="text-[14px] font-bold text-foreground">
          {isDefault ? "Default message" : row.message_key}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {row.city}
        </span>
        {row.is_active ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Off
          </span>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="mt-3 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run({ id: row.id, message_text: text }, "Message saved")}
          disabled={busy || text.trim() === row.message_text}
          className="rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
        >
          Save text
        </button>
        <button
          onClick={() =>
            run({ id: row.id, is_active: !row.is_active }, row.is_active ? "Deactivated" : "Activated")
          }
          disabled={busy}
          className="rounded-[10px] border border-border px-3.5 py-2 text-[12px] font-semibold text-foreground hover:bg-muted"
        >
          {row.is_active ? "Deactivate" : "Set active"}
        </button>
        {!isDefault && (
          <button
            onClick={() => {
              if (confirm(`Delete the "${row.message_key}" message?`))
                run({ id: row.id, delete: true }, "Message deleted");
            }}
            disabled={busy}
            className="flex items-center gap-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold text-destructive hover:bg-muted"
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function CapacityMessagesPage() {
  const queryClient = useQueryClient();
  const fetchMessages = useServerFn(listCapacityMessages);
  const save = useServerFn(saveCapacityMessage);

  const [newKey, setNewKey] = useState("");
  const [newCity, setNewCity] = useState("Latur");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["capacity", "messages"],
    queryFn: () => fetchMessages(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["capacity", "messages"] });

  async function addMessage() {
    if (!newKey.trim() || !newText.trim()) {
      toast.error("Name and message text are required");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          message_key: newKey.trim().toLowerCase().replace(/\s+/g, "_"),
          message_text: newText.trim(),
          city: newCity.trim() || "Latur",
        },
      });
      toast.success("Message added — toggle it active when you want it to show");
      setNewKey("");
      setNewText("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-[17px] font-bold text-foreground">Capacity Messages</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The message customers see when no experts are available in their zone. The default applies
          always; an active situational message (e.g. heavy rain) overrides it for its city.
        </p>
      </div>

      {(data ?? []).map((m) => (
        <MessageRow key={m.id} row={m} onSaved={refresh} />
      ))}

      <div className="rounded-[16px] border border-dashed border-border bg-card p-5">
        <h3 className="text-[14px] font-bold text-foreground">Add situational message</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder='Name, e.g. "heavy rain"'
            className="rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
          <input
            value={newCity}
            onChange={(e) => setNewCity(e.target.value)}
            placeholder="City"
            className="rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
        </div>
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={3}
          placeholder="Message shown to customers…"
          className="mt-3 w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground"
        />
        <button
          onClick={addMessage}
          disabled={busy}
          className="mt-3 flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
        >
          <Plus size={14} /> Add message
        </button>
      </div>
    </div>
  );
}
