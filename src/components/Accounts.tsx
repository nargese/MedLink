import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { passwordIssues, useMe } from "@/lib/auth";
import { createAccount, listUsers, setRole } from "@/lib/admin.functions";
import {
  deactivateAccount,
  reactivateAccount,
} from "@/lib/account-status.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Role = "patient" | "praticien" | "admin" | "super_admin";

const roles: Role[] = ["patient", "praticien", "admin", "super_admin"];
const labels: Record<Role, string> = {
  patient: "Patient",
  praticien: "Praticien",
  admin: "Administrateur",
  super_admin: "Super administrateur",
};

export function Comptes() {
  const { data: me } = useMe();
  const currentUserId = me?.user.id;
  const isSuperAdmin = me?.roles.includes("super_admin") ?? false;
  const qc = useQueryClient();

  const list = useServerFn(listUsers);
  const create = useServerFn(createAccount);
  const changeRole = useServerFn(setRole);
  const deactivate = useServerFn(deactivateAccount);
  const reactivate = useServerFn(reactivateAccount);

  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "praticien" as Role,
    praticien_id: "new",
    specialite: "",
    clinique: "",
  });

  const users = useQuery({
    queryKey: ["admin-users"],
    enabled: isSuperAdmin,
    queryFn: () => list(),
  });

  const catalog = useQuery({
    queryKey: ["catalog-admin"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const [clinics, practitioners] = await Promise.all([
        supabase.from("cliniques").select("*"),
        supabase.from("praticiens").select("*").is("user_id", null),
      ]);
      if (clinics.error || practitioners.error) {
        throw new Error("Impossible de charger les cliniques et les praticiens.");
      }
      return {
        cliniques: clinics.data ?? [],
        libres: practitioners.data ?? [],
      };
    },
  });

  async function perform(operation: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Opération impossible.",
      );
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-users"] }),
        qc.invalidateQueries({ queryKey: ["catalog-admin"] }),
      ]);
      setBusy(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const issues = passwordIssues(f.password);
    if (issues.length) {
      toast.error("Mot de passe : " + issues.join(", "));
      return;
    }

    await perform(async () => {
      await create({
        data: {
          email: f.email,
          password: f.password,
          full_name: f.full_name,
          role: f.role,
          praticien_id:
            f.role === "praticien" && f.praticien_id !== "new"
              ? f.praticien_id
              : undefined,
          specialite:
            f.role === "praticien" ? f.specialite || undefined : undefined,
          cliniques:
            f.role === "praticien" && f.clinique ? [f.clinique] : undefined,
        },
      });
      setF((previous) => ({
        ...previous, email: "", password: "", full_name: "",
      }));
    }, "Compte créé.");
  }

  async function updateRole(
    userId: string,
    role: Role,
    action: "add" | "remove",
  ) {
    if (!window.confirm(
      `${action === "add" ? "Ajouter" : "Retirer"} le rôle ${labels[role]} ?`,
    )) return;

    await perform(
      () => changeRole({ data: { user_id: userId, role, action } }),
      "Rôles mis à jour.",
    );
  }

  async function toggleStatus(userId: string, banned: boolean) {
    if (!window.confirm(
      banned
        ? "Réactiver ce compte ?"
        : "Désactiver ce compte en conservant son historique ?",
    )) return;

    await perform(
      () => (banned ? reactivate : deactivate)({
        data: { user_id: userId },
      }),
      banned ? "Compte réactivé." : "Compte désactivé.",
    );
  }

  if (!me) return <p>Chargement du compte…</p>;

  if (!isSuperAdmin) {
    return <p>La gestion des comptes est réservée au Super Admin.</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <form
        onSubmit={submit}
        className="space-y-4 rounded-2xl border bg-card p-6 shadow-soft lg:col-span-2"
      >
        <h2 className="text-2xl">Créer un compte</h2>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-name">Nom complet</Label>
            <Input id="account-name" required value={f.full_name}
              onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-email">E-mail</Label>
            <Input id="account-email" type="email" required value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-password">Mot de passe provisoire</Label>
            <Input id="account-password" type="password" required
              autoComplete="new-password" value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Rôle</Label>
            <Select disabled={busy} value={f.role}
              onValueChange={(role) => setF({ ...f, role: role as Role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role} value={role}>{labels[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {f.role === "praticien" && (
            <>
              <div className="space-y-2">
                <Label>Fiche praticien</Label>
                <Select disabled={busy} value={f.praticien_id}
                  onValueChange={(value) => setF({ ...f, praticien_id: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Nouvelle fiche</SelectItem>
                    {(catalog.data?.libres ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nom} ({p.specialite})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {f.praticien_id === "new" && (
                <>
                  <div className="space-y-2">
                    <Label>Spécialité</Label>
                    <Select disabled={busy} value={f.specialite}
                      onValueChange={(value) => setF({ ...f, specialite: value })}>
                      <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                      <SelectContent>
                        {["Médecine générale", "Cardiologie", "Pédiatrie"].map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Clinique</Label>
                    <Select disabled={busy} value={f.clinique}
                      onValueChange={(value) => setF({ ...f, clinique: value })}>
                      <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                      <SelectContent>
                        {(catalog.data?.cliniques ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </>
          )}
          {catalog.isError && (
            <p role="alert" className="text-destructive">
              Impossible de charger le catalogue des cliniques et praticiens.
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "En cours…" : "Créer"}
          </Button>
        </fieldset>
      </form>

      <div className="lg:col-span-3">
        <h2 className="mb-4 text-2xl">Utilisateurs</h2>
        {users.isPending && <p>Chargement des utilisateurs…</p>}
        {users.isError && (
          <p role="alert" className="text-destructive">
            {users.error.message}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Rôles</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data ?? []).map((u) => {
              const ownAccount = u.id === currentUserId;
              const protectedStatus =
                ownAccount || u.roles.includes("super_admin");

              return (
                <TableRow key={u.id}>
                  <TableCell>{u.name || "—"}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {u.roles.map((role) => (
                        <div key={role} className="flex items-center gap-2">
                          <span>{labels[role as Role] ?? role}</span>
                          <Button type="button" variant="outline" size="sm"
                            disabled={busy || ownAccount}
                            onClick={() => updateRole(u.id, role as Role, "remove")}>
                            Retirer
                          </Button>
                        </div>
                      ))}
                      <Select value="" disabled={busy || ownAccount}
                        onValueChange={(role) => updateRole(u.id, role as Role, "add")}>
                        <SelectTrigger><SelectValue placeholder="Ajouter un rôle" /></SelectTrigger>
                        <SelectContent>
                          {roles.filter((role) => !u.roles.includes(role)).map((role) => (
                            <SelectItem key={role} value={role}>{labels[role]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell>{u.is_banned ? "Désactivé" : "Actif"}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline"
                      disabled={busy || protectedStatus}
                      onClick={() => toggleStatus(u.id, u.is_banned)}>
                      {u.is_banned ? "Réactiver" : "Désactiver"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
