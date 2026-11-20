import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { staffSchema, setRoleSchema } from "./admin.schemas";

async function assertAdmin(ctx: {
  supabase: any;
  userId: string;
  claims: any;
}): Promise<"admin" | "super_admin"> {
  if (ctx.claims?.aal !== "aal2") {
    throw new Error("MFA requise");
  }

  for (const role of ["super_admin", "admin"] as const) {
    const { data, error } = await ctx.supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: role,
    });

    if (error) {
      throw new Error("Vérification des droits impossible.");
    }

    if (data === true) {
      return role;
    }
  }

  throw new Error("Accès refusé");
}

async function assertCanCreateAccount(
  ctx: Parameters<typeof assertAdmin>[0],
  role: string,
) {
  const actorRole = await assertAdmin(ctx);

  if (role === "super_admin" && actorRole !== "super_admin") {
    throw new Error(
      "Seul un super administrateur peut créer un super administrateur.",
    );
  }
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 200,
    });

    if (error) {
      throw new Error("Impossible de charger les utilisateurs.");
    }

    const [rolesResult, profilesResult] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("profiles").select("id, full_name"),
    ]);

    if (rolesResult.error || profilesResult.error) {
      throw new Error("Impossible de charger les profils et les rôles.");
    }

    const roles = rolesResult.data ?? [];
    const profiles = profilesResult.data ?? [];

    return data.users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      name: profiles.find((profile) => profile.id === user.id)?.full_name ?? "",
      roles: roles
        .filter((entry) => entry.user_id === user.id)
        .map((entry) => entry.role as string),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
    }));
  });

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => staffSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanCreateAccount(context, data.role);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const creation = await supabaseAdmin.auth.admin
      .createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        ban_duration: "876000h",
        user_metadata: {
          full_name: data.full_name,
        },
      })
      .catch(() => {
        throw new Error(
          "Réponse du service de création indisponible. " +
            "Vérifiez si le compte existe avant de réessayer.",
        );
      });

    if (creation.error || !creation.data.user) {
      throw new Error(
        "Création du compte impossible. " +
          "Vérifiez notamment si cette adresse est déjà utilisée.",
      );
    }

    const user = creation.data.user;
    const uid = user.id;

    // Vérifier la suspension avant toute attribution de privilèges.
    const bannedUntil =
      "banned_until" in user && typeof user.banned_until === "string"
        ? Date.parse(user.banned_until)
        : NaN;

    if (!Number.isFinite(bannedUntil) || bannedUntil <= Date.now()) {
      throw new Error(
        "La suspension initiale du compte n’a pas pu être confirmée. " +
          "Vérifiez le compte dans Supabase avant de poursuivre.",
      );
    }

    const finalization = await supabaseAdmin
      .rpc("admin_finalize_account_atomic", {
        _actor_id: context.userId,
        _user_id: uid,
        _role: data.role,
        _praticien_id:
          data.role === "praticien" ? (data.praticien_id ?? null) : null,
        _specialite:
          data.role === "praticien" ? (data.specialite ?? null) : null,
        _cliniques:
          data.role === "praticien" ? (data.cliniques ?? []) : [],
      })
      .then(
        (result) => result,
        () => {
          throw new Error(
            "Résultat de la finalisation inconnu. " +
              "Le compte reste suspendu. Vérifiez son rôle, sa fiche " +
              "et son audit dans Supabase avant toute nouvelle tentative.",
          );
        },
      );

    if (finalization.error) {
      throw new Error(
        "La finalisation du compte n’a pas été confirmée. " +
          "Le compte reste suspendu. Vérifiez le rôle, " +
          "la fiche praticien et les cliniques avant de réessayer.",
      );
    }

    // Revérifier les droits avant d’activer le compte finalisé.
    await assertCanCreateAccount(context, data.role);

    const activation = await supabaseAdmin.auth.admin
      .updateUserById(uid, {
        ban_duration: "none",
      })
      .catch(() => {
        throw new Error(
          "Compte finalisé, mais résultat de l’activation inconnu. " +
            "Vérifiez sa suspension dans Supabase avant de réessayer.",
        );
      });

    if (activation.error || !activation.data.user) {
      throw new Error(
        "Compte finalisé, mais activation non confirmée. " +
          "Vérifiez sa suspension dans Supabase.",
      );
    }

    return { id: uid };
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error(
        "Vous ne pouvez pas modifier votre propre rôle.",
      );
    }

    // Le JWT utilisateur permet à PostgreSQL de vérifier
    // l'identité, la MFA et les autorisations dans la transaction.
    const { error } = await context.supabase.rpc(
      "change_user_role",
      {
        _target_user: data.user_id,
        _role: data.role,
        _action: data.action,
      },
    );

    if (error) {
      throw new Error(
        "Modification du rôle refusée ou impossible.",
      );
    }

    return { ok: true };
  });
