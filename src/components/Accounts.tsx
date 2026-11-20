import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { passwordIssues, useMe } from "@/lib/auth";
import { createAccount, listUsers, setRole } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type R = "patient" | "praticien" | "admin" | "super_admin";
export function Comptes() {
    const { data: me } = useMe();

  const currentUserId = me?.user.id;
  const isSuperAdmin = me?.roles.includes("super_admin") ?? false;
  const qc = useQueryClient();
  const list = useServerFn(listUsers);
  const create = useServerFn(createAccount);
  const changeRole = useServerFn(setRole);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => list() });
  const catalog = useQuery({
    queryKey: ["catalog-admin"],
    queryFn: async () => {
      const [c, p] = await Promise.all([supabase.from("cliniques").select("*"), supabase.from("praticiens").select("*").is("user_id", null)]);
      return { cliniques: c.data ?? [], libres: p.data ?? [] };
    },
  });
  const [f, setF] = useState({ email: "", password: "", full_name: "", role: "praticien" as R, praticien_id: "new", specialite: "", clinique: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issues = passwordIssues(f.password);
    if (issues.length) return toast.error("Mot de passe : " + issues.join(", "));
    try {
      await create({
        data: {
          email: f.email, password: f.password, full_name: f.full_name, role: f.role,
          praticien_id: f.praticien_id !== "new" ? f.praticien_id : undefined,
          specialite: f.specialite || undefined,
          cliniques: f.clinique ? [f.clinique] : undefined,
        },
      });
      toast.success("Compte crÃ©Ã©. L'utilisateur devra configurer la double authentification Ã  sa premiÃ¨re connexion.");
      setF({ ...f, email: "", password: "", full_name: "" });
      qc.invalidateQueries();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6 shadow-soft lg:col-span-2">
        <h2 className="text-2xl">CrÃ©er un compte</h2>
        <div className="space-y-2"><Label>Nom complet</Label><Input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>E-mail</Label><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mot de passe provisoire</Label><Input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <div className="space-y-2">
          <Label>RÃ´le</Label>
          <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v as typeof f.role })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="praticien">Praticien</SelectItem><SelectItem value="admin">Administrateur</SelectItem><SelectItem value="super_admin">Super administrateur</SelectItem><SelectItem value="patient">Patient</SelectItem></SelectContent>
          </Select>
        </div>
        {f.role === "praticien" && (
          <>
            <div className="space-y-2">
              <Label>Fiche praticien</Label>
              <Select value={f.praticien_id} onValueChange={(v) => setF({ ...f, praticien_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Nouvelle fiche</SelectItem>
                  {(catalog.data?.libres ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.nom} ({p.specialite})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {f.praticien_id === "new" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>SpÃ©cialitÃ©</Label>
                  <Select value={f.specialite} onValueChange={(v) => setF({ ...f, specialite: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                    <SelectContent>{["MÃ©decine gÃ©nÃ©rale", "Cardiologie", "PÃ©diatrie"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Clinique</Label>
                  <Select value={f.clinique} onValueChange={(v) => setF({ ...f, clinique: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                    <SelectContent>{(catalog.data?.cliniques ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </>
        )}
        <Button className="w-full">CrÃ©er</Button>
      </form>
      <div className="lg:col-span-3">
        <h2 className="mb-4 text-2xl">Utilisateurs</h2>
        <Table>
          <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>E-mail</TableHead><TableHead>RÃ´le</TableHead></TableRow></TableHeader>
          <TableBody>
            {(users.data ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.name || "â€”"}</TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                <TableCell>
  <div className="space-y-3">
    {/* RÃ´les actuellement attribuÃ©s */}
    <div className="flex flex-wrap gap-2">
      {u.roles.length === 0 && (
        <span className="text-sm text-muted-foreground">
          Aucun rÃ´le
        </span>
      )}

      {u.roles.map((role) => (
        <div
          key={role}
          className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
        >
          <span>{role}</span>

          <button
       type="button"
            disabled={
              !currentUserId ||
              u.id === currentUserId ||
              (!isSuperAdmin &&
                (u.roles.includes("super_admin") || role === "super_admin"))
            }
            className="text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Retirer le rÃ´le ${role}`}
            onClick={async () => {
              if (!window.confirm(`Retirer le rÃ´le ${role} ?`)) return;

              try {
                await changeRole({
                  data: {
                    user_id: u.id,
                    role: role as R,
                    action: "remove",
                  },
                });

                toast.success("RÃ´le retirÃ©.");
                await users.refetch();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            Retirer
          </button>
        </div>
      ))}
    </div>

    {/* Ajouter un rÃ´le sans supprimer les autres */}
    <Select
      value=""
	disabled={
  !currentUserId ||
  u.id === currentUserId ||
  (!isSuperAdmin && u.roles.includes("super_admin"))
}
      onValueChange={async (role) => {
        try {
          await changeRole({
            data: {
              user_id: u.id,
              role: role as R,
              action: "add",
            },
          });

          toast.success("RÃ´le ajoutÃ©.");
          await users.refetch();
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <SelectTrigger className="h-8 w-44">
        <SelectValue placeholder="Ajouter un rÃ´le" />
      </SelectTrigger>

      <SelectContent>
        {(
          ["patient", "praticien", "admin", "super_admin"] as R[]
        )
          .filter(
            (role) =>
              !u.roles.includes(role) &&
              (isSuperAdmin || role !== "super_admin")
          )
          .map((role) => (
            <SelectItem key={role} value={role}>
              {role}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  </div>
</TableCell>
		<TableCell>
                  <Select
                    value={u.roles.includes("super_admin") ? "super_admin" : (u.roles[0] ?? "patient")}
                    onValueChange={async (v) => {
                      try {
                        await changeRole({ data: { user_id: u.id, role: v as R } });
                        toast.success("RÃ´le mis Ã  jour.");
                        users.refetch();
                      } catch (err) { toast.error((err as Error).message); }
                    }}
                  >
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="patient">Patient</SelectItem><SelectItem value="praticien">Praticien</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="super_admin">Super admin</SelectItem></SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
