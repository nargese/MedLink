import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const targetSchema = z.object({
  user_id: z.string().uuid(),
});

type Context = {
  userId: string;
  claims: { aal?: string };
  supabase: {
    rpc: (
      name: "has_role",
      args: { _user_id: string; _role: "super_admin" },
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

async function assertSuperAdmin(context: Context) {
  if (context.claims.aal !== "aal2") {
    throw new Error("MFA requise");
  }

  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "super_admin",
  });

  if (error || data !== true) {
    throw new Error("Accès réservé au Super Admin.");
  }
}

function isBanned(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  return (
    "banned_until" in user &&
    typeof user.banned_until === "string" &&
    Date.parse(user.banned_until) > Date.now()
  );
}

async function changeAccountStatus(
  context: Context,
  userId: string,
  deactivate: boolean,
) {
  await assertSuperAdmin(context);

  if (userId === context.userId) {
    throw new Error("Vous ne pouvez pas modifier votre propre statut.");
  }

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const [actorResult, targetResult, rolesResult] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(context.userId),
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId),
  ]);

  if (
    actorResult.error ||
    !actorResult.data.user ||
    isBanned(actorResult.data.user)
  ) {
    throw new Error("Session administrateur indisponible ou compte suspendu.");
  }

  if (targetResult.error || !targetResult.data.user) {
    throw new Error("Utilisateur introuvable.");
  }

  if (rolesResult.error || !rolesResult.data?.length) {
    throw new Error("Impossible de vérifier les rôles du compte.");
  }

  if (rolesResult.data.some((entry) => entry.role === "super_admin")) {
    throw new Error("La modification du statut d’un Super Admin est interdite.");
  }

  const target = targetResult.data.user;
  const banned = isBanned(target);

  if (deactivate && banned) {
    throw new Error(
      "Ce compte est déjà suspendu. Son motif de suspension doit être vérifié.",
    );
  }

  if (
    !deactivate &&
    (!banned ||
      target.app_metadata?.['medlink_access_state'] !== "disabled_by_super_admin")
  ) {
    throw new Error(
      "Réactivation refusée : ce compte n’a pas été désactivé par cette procédure.",
    );
  }

  // Revérifier les droits avant l'opération.
  await assertSuperAdmin(context);

  const action = deactivate ? "compte_desactive" : "compte_reactive";

  const requested = await supabaseAdmin.from("audit_logs").insert({
    actor_id: context.userId,
    action: action + "_demande",
    cible: userId,
    details: { statut: "demande" },
  });

  if (requested.error) {
    throw new Error("Opération annulée : journalisation indisponible.");
  }

  let result;
  try {
    result = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: deactivate ? "876000h" : "none",
      app_metadata: {
        ...target.app_metadata,
        medlink_access_state: deactivate
          ? "disabled_by_super_admin"
          : "active",
      },
    });
  } catch {
    throw new Error(
      "Résultat inconnu. Vérifiez le statut du compte avant de réessayer.",
    );
  }

  if (result.error || !result.data.user) {
    throw new Error(
      "Modification non confirmée. Vérifiez le statut du compte.",
    );
  }

  if (isBanned(result.data.user) !== deactivate) {
    throw new Error(
      "Le statut retourné est inattendu. Vérifiez le compte dans Supabase.",
    );
  }

  const completed = await supabaseAdmin.from("audit_logs").insert({
    actor_id: context.userId,
    action,
    cible: userId,
    details: { statut: "confirme" },
  });

  if (completed.error) {
    throw new Error(
      "Statut modifié, mais audit final non confirmé. Vérifiez le journal avant de réessayer.",
    );
  }

  return { ok: true as const };
}

export const deactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data, context }) =>
    changeAccountStatus(context, data.user_id, true),
  );

export const reactivateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data, context }) =>
    changeAccountStatus(context, data.user_id, false),
  );