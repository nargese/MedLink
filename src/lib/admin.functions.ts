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

  if (superError) {
    throw new Error("Verification des droits impossible");
  }

  if (isSuperAdmin) return "super_admin";

  const { data: isAdmin, error: adminError } =
    await ctx.supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: "admin",
    });

  if (adminError) {
    throw new Error("Verification des droits impossible");
  }

  if (isAdmin) return "admin";

  throw new Error("Acces refuse");
}

// Fonction indépendante, accessible aux fonctions serveur.
async function assertSuperAdmin(
  ctx: { supabase: any; userId: string; claims: any }
): Promise<void> {
  const role = await assertAdmin(ctx);

  if (role !== "super_admin") {
    throw new Error(
      "Acces refuse : fonctionnalite reservee au Super Admin."
    );
  }
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const [rolesResult, profilesResult] = await Promise.all([
  supabaseAdmin.from("user_roles").select("user_id, role"),
  supabaseAdmin.from("profiles").select("id, full_name"),
]);

if (rolesResult.error) {
  throw new Error("Impossible de recuperer les roles.");
}

if (profilesResult.error) {
  throw new Error("Impossible de recuperer les profils.");
}

const roles = rolesResult.data;
const profiles = profilesResult.data;
        return data.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: profiles?.find((p) => p.id === u.id)?.full_name ?? "",
      roles: (roles ?? [])
        .filter((r) => r.user_id === u.id)
        .map((r) => r.role as string),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      is_banned:
        u.banned_until != null &&
        new Date(u.banned_until).getTime() > Date.now(),
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
  await assertSuperAdmin(context);
const currentRole = "super_admin";

  if (data.role === "super_admin" && currentRole !== "super_admin") {
    throw new Error(
      "Seul un super administrateur peut creer un autre super administrateur."
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
          specialite: data.specialite || "Medecine generale",
        })
        .select()
        .single();

      if (practitionerError || !p) {
        throw practitionerError ?? new Error("Creation du praticien impossible.");
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
    await assertSuperAdmin(context);
const currentRole = "super_admin";

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
  throw new Error("Impossible de verifier les roles existants.");
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
const deleteAccountSchema = z.object({
  user_id: z.string().uuid(),
});

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    deleteAccountSchema.parse(data)
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error("Vous ne pouvez pas supprimer votre propre compte.");
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Vérifier les rôles du compte cible.
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);

    if (rolesError) {
      throw new Error("Impossible de vérifier les rôles.");
    }

    if (!roles?.length) {
      throw new Error("Compte introuvable.");
    }

    // Protection des comptes Super Admin.
    if (roles.some((r) => r.role === "super_admin")) {
      throw new Error(
        "La suppression d'un Super Admin nécessite une procédure spécifique."
      );
    }

    // Bloquer la suppression si le patient possède des rendez-vous.
    const { count: appointmentsCount, error: appointmentsError } =
      await supabaseAdmin
        .from("rendez_vous")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", data.user_id);

    if (appointmentsError) throw appointmentsError;

    // Bloquer la suppression si le patient possède des documents.
    const { count: documentsCount, error: documentsError } =
      await supabaseAdmin
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", data.user_id);

    if (documentsError) throw documentsError;

    // Vérifier les fiches praticien associées.
    const { data: practitioners, error: practitionersError } =
      await supabaseAdmin
        .from("praticiens")
        .select("id")
        .eq("user_id", data.user_id);

    if (practitionersError) throw practitionersError;

    // Bloquer la suppression des praticiens associés à une fiche métier.
    if (practitioners?.length) {
      throw new Error(
        "Ce compte est lié à un praticien. Désactivez-le pour conserver son historique."
      );
    }

    if ((appointmentsCount ?? 0) > 0 || (documentsCount ?? 0) > 0) {
      throw new Error(
        "Ce compte possède des données médicales. Désactivez-le plutôt que de le supprimer."
      );
    }

    // Supprimer les notifications propres au compte.
    // Journaliser la demande avant toute suppression.
const { error: auditError } = await supabaseAdmin
  .from("audit_logs")
  .insert({
    actor_id: context.userId,
    action: "suppression_compte_demandee",
    cible: data.user_id,
    details: {
      operation: "suppression_definitive",
      statut: "demandee",
    },
  });

if (auditError) {
  throw new Error(
    "Suppression annulée : impossible de journaliser la demande."
  );
}

// Supprimer les notifications du compte.
const { error: notificationsError } = await supabaseAdmin
  .from("notifications")
  .delete()
  .eq("user_id", data.user_id);

if (notificationsError) {
  throw new Error(
    "Suppression interrompue : " + notificationsError.message
  );
}

// Supprimer le compte dans Supabase Auth.
const { error: deleteError } =
  await supabaseAdmin.auth.admin.deleteUser(data.user_id);

if (deleteError) {
  throw new Error(
    "Suppression du compte impossible : " + deleteError.message
  );
}
    return { ok: true };
  });

  export const deactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ user_id: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);

    if (rolesError) {
      throw new Error("Impossible de vérifier les rôles.");
    }

    if (roles?.some((r) => r.role === "super_admin")) {
      throw new Error("La désactivation d'un Super Admin est interdite.");
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      data.user_id,
      { ban_duration: "876000h" }
    );

    if (error) {
      throw new Error("Désactivation impossible : " + error.message);
    }

    return { ok: true };
  });
  export const reactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ user_id: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error("Vous ne pouvez pas modifier votre propre compte.");
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: target, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(data.user_id);

    if (userError || !target.user) {
      throw new Error("Utilisateur introuvable.");
    }

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
        ban_duration: "none",
      });

    if (updateError) {
      throw new Error("Réactivation impossible : " + updateError.message);
    }

    return { ok: true };
  });