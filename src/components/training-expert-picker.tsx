import { useState } from "react";

export function TrainingExpertPicker({ experts, value, onChange }: {
  experts: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  return <fieldset className="space-y-2">
    <legend className="text-[11px] font-bold uppercase text-muted-foreground">Broadcast to selected experts ({value.length})</legend>
    <input aria-label="Search training experts" placeholder="Search names" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-9 px-3 rounded-md border border-border bg-card text-[13px]" />
    <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border">
      {experts.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())).map((e) => <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer">
        <input type="checkbox" checked={value.includes(e.id)} onChange={(ev) => onChange(ev.target.checked ? [...value, e.id] : value.filter((id) => id !== e.id))} />{e.name}
      </label>)}
      {!experts.length && <p className="p-3 text-[13px] text-muted-foreground">No active training experts.</p>}
    </div>
  </fieldset>;
}