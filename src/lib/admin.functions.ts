import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(
  ctx: { supabase: any; userId: string; claims: any }
): Promise<"admin" | "super_admin"> {
  if (ctx.claims?.aal !== "aal2") {
    throw new Error("MFA requise");
  }

  const { data: isSuperAdmin, error: superError } =
    await ctx.supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: "super_admin",
    });

  if (superError) throw new Error("VÃ©rification des droits impossible");

  if (isSuperAdmin) return "super_admin";

  const { data: isAdmin, error: adminError } =
    await ctx.supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: "admin",
    });

  if (adminError) throw new Error("VÃ©rification des droits impossible");

  if (isAdmin) return "admin";

  throw new Error("AccÃ¨s refusÃ©");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const [rolesResult, profilesResult] = await Promise.all([
  supabaseAdmin.from("user_roles").select("user_id, role"),
  supabaseAdmin.from("profiles").select("id, full_name"),
]);

if (rolesResult.error) {
  throw new Error("Impossible de rÃ©cupÃ©rer les rÃ´les.");
}

if (profilesResult.error) {
  throw new Error("Impossible de rÃ©cupÃ©rer les profils.");
}

const roles = rolesResult.data;
const profiles = profilesResult.data;
    return data.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: profiles?.find((p) => p.id === u.id)?.full_name ?? "",
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as string),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));
  });

const staffSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z
    .string()
    .min(12)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
  full_name: z.string().trim().min(2).max(100),
  role: z.enum(["patient", "praticien", "admin", "super_admin"]),
  praticien_id: z.string().uuid().optional(),
  specialite: z.string().trim().max(60).optional(),
  cliniques: z.array(z.string().uuid()).max(3).optional(),
});

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => staffSchema.parse(d))
  .handler(async ({ data, context }) => {
  const currentRole = await assertAdmin(context);

  if (data.role === "super_admin" && currentRole !== "super_admin") {
    throw new Error(
      "Seul un super administrateur peut crÃ©er un autre super administrateur."
    );
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const uid = created.user.id;

try {
  // Remplacer le role patient attribue automatiquement.
  const { error: deleteError } = await supabaseAdmin
    .from("user_roles")
    .delete()
    .eq("user_id", uid);

  if (deleteError) throw deleteError;

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .insert({
      user_id: uid,
      role: data.role,
    });

  if (roleError) throw roleError;

  // Configuration du praticien.
  if (data.role === "praticien") {
    if (data.praticien_id) {
      const { data: linked, error: linkError } = await supabaseAdmin
        .from("praticiens")
        .update({ user_id: uid })
        .eq("id", data.praticien_id)
        .is("user_id", null)
        .select("id")
        .single();

      if (linkError || !linked) {
        throw linkError ?? new Error("Fiche praticien indisponible.");
      }
    } else {
      const { data: p, error: practitionerError } = await supabaseAdmin
        .from("praticiens")
        .insert({
          user_id: uid,
          nom: data.full_name,
          specialite: data.specialite || "MÃ©decine gÃ©nÃ©rale",
        })
        .select()
        .single();

      if (practitionerError || !p) {
        throw practitionerError ?? new Error("CrÃ©ation du praticien impossible.");
      }

      if (data.cliniques?.length) {
        const { error: clinicError } = await supabaseAdmin
          .from("praticien_cliniques")
          .insert(
            data.cliniques.map((clinique_id) => ({
              praticien_id: p.id,
              clinique_id,
            }))
          );

        if (clinicError) throw clinicError;
      }
    }
  }

  const { error: auditError } = await supabaseAdmin
    .from("audit_logs")
    .insert({
      actor_id: context.userId,
      action: "compte_cree_admin",
      cible: uid,
      details: { role: data.role },
    });

  if (auditError) throw auditError;

  return { id: uid };
} catch (err) {
  // Nettoyage du compte cree en cas d'echec.
  const { error: cleanupError } =
    await supabaseAdmin.auth.admin.deleteUser(uid);

  if (cleanupError) {
    throw new Error(
      "Creation incomplete et nettoyage impossible. " +
      "Verification manuelle requise pour le compte " + uid
    );
  }

  throw new Error(
    "Creation du compte annulee : " +
    (err instanceof Error ? err.message : "Erreur inconnue")
  );
}

  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
  z.object({
    user_id: z.string().uuid(),
    role: z.enum(["patient", "praticien", "admin", "super_admin"]),
    action: z.enum(["add", "remove"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const currentRole = await assertAdmin(context);

    if (data.role === "super_admin" && currentRole !== "super_admin") {
      throw new Error(
        "Seul un super administrateur peut attribuer ce rÃ´le."
      );
    }
    if (data.user_id === context.userId) throw new Error("Vous ne pouvez pas modifier votre propre rÃ´le.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const { data: existingRoles, error: rolesError } = await supabaseAdmin
  .from("user_roles")
  .select("role")
  .eq("user_id", data.user_id);

if (rolesError) {
  throw new Error("Impossible de vÃ©rifier les rÃ´les existants.");
}

const targetIsSuperAdmin = (existingRoles ?? []).some(
  (r) => r.role === "super_admin"
);

if (targetIsSuperAdmin && currentRole !== "super_admin") {
  throw new Error(
    "Un administrateur ne peut pas modifier le compte d'un super administrateur."
  );
}
    const { error: roleError } = await context.supabase.rpc(
  "change_user_role",
  {
    _target_user: data.user_id,
    _role: data.role,
    _action: data.action,
  }
);

if (roleError) {
  throw new Error(roleError.message);
}

    return { ok: true };
  });
