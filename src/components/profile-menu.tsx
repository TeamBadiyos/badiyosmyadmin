import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ProfileMenu({ name, initials, onLogout }: { name: string; initials: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (pw.length < 8) return toast.error("New password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const email = u.user?.email;
      if (!email) throw new Error("No email on this account");
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: cur });
      if (e1) throw new Error("Current password is wrong");
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password changed");
      setOpen(false); setCur(""); setPw(""); setPw2("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-3 rounded-full pr-2 hover:bg-muted" aria-label="Profile menu">
            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm shrink-0">{initials}</div>
            <span className="hidden sm:inline text-sm font-semibold text-foreground truncate max-w-[160px]">{name || "…"}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}><KeyRound size={16} className="mr-2" />Change password</DropdownMenuItem>
          <DropdownMenuItem onClick={onLogout}><LogOut size={16} className="mr-2" />Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change password</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
            <Input type="password" placeholder="New password (min 8)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Input type="password" placeholder="Confirm new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <Button className="w-full" disabled={busy || !cur || !pw} onClick={save}>{busy ? "Saving…" : "Save password"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
