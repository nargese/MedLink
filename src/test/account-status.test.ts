import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  roles: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: mocks.getUser,
        updateUserById: mocks.updateUser,
      },
    },
    from: (table: string) => {
      if (table === "user_roles") {
        return { select: () => ({ eq: mocks.roles }) };
      }
      if (table === "audit_logs") return { insert: mocks.audit };
      throw new Error(`Table inattendue : ${table}`);
    },
  },
}));

import {
  deactivateAccount,
  reactivateAccount,
} from "../lib/account-status.functions";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";
const future = () => new Date(Date.now() + 86_400_000).toISOString();

type User = {
  id: string;
  banned_until: string | null;
  app_metadata: Record<string, unknown>;
};

let actor: User;
let target: User;

function request() {
  return {
    data: { user_id: targetId },
    context: {
      userId: actorId,
      claims: { aal: "aal2" },
      supabase: { rpc: mocks.rpc },
    },
  };
}

type Handler = (input: ReturnType<typeof request>) => Promise<{ ok: true }>;
const disable = deactivateAccount as unknown as Handler;
const enable = reactivateAccount as unknown as Handler;

function prepareDisabledAccount() {
  target.banned_until = future();
  target.app_metadata["medlink_access_state"] = "disabled_by_super_admin";
}

describe("Statut des comptes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actor = { id: actorId, banned_until: null, app_metadata: {} };
    target = {
      id: targetId,
      banned_until: null,
      app_metadata: { provider: "email" },
    };

    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.roles.mockResolvedValue({ data: [{ role: "patient" }], error: null });
    mocks.audit.mockResolvedValue({ error: null });

    mocks.getUser.mockImplementation(async (id: string) => ({
      data: { user: id === actorId ? actor : target },
      error: null,
    }));

    mocks.updateUser.mockImplementation(async (_id, attributes) => ({
      data: {
        user: {
          ...target,
          banned_until: attributes.ban_duration === "none" ? null : future(),
          app_metadata: attributes.app_metadata,
        },
      },
      error: null,
    }));
  });

  it("refuse une session sans MFA", async () => {
    const input = request();
    input.context.claims.aal = "aal1";
    await expect(disable(input)).rejects.toThrow("MFA requise");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuse un admin simple", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(disable(request())).rejects.toThrow("Super Admin");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("interdit de modifier son propre statut", async () => {
    const input = request();
    input.data.user_id = actorId;
    await expect(disable(input)).rejects.toThrow("propre statut");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuse un acteur suspendu", async () => {
    actor.banned_until = future();
    await expect(disable(request())).rejects.toThrow("compte suspendu");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("protege le statut des Super Admin", async () => {
    mocks.roles.mockResolvedValue({
      data: [{ role: "super_admin" }], error: null,
    });
    await expect(disable(request())).rejects.toThrow("Super Admin est interdite");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuse si les roles ne peuvent pas etre verifies", async () => {
    mocks.roles.mockResolvedValue({
      data: null, error: { message: "Internal details" },
    });
    await expect(disable(request())).rejects.toThrow("vérifier les rôles");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("ne remplace pas une suspension existante", async () => {
    target.banned_until = future();
    await expect(disable(request())).rejects.toThrow("déjà suspendu");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuse la reactivation d'une creation incomplete", async () => {
    target.banned_until = future();
    await expect(enable(request())).rejects.toThrow("Réactivation refusée");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("desactive en conservant les metadonnees et journalise l'acteur", async () => {
    await expect(disable(request())).resolves.toEqual({ ok: true });

    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith(targetId, {
      ban_duration: "876000h",
      app_metadata: {
        provider: "email",
        medlink_access_state: "disabled_by_super_admin",
      },
    });

    expect(mocks.audit).toHaveBeenLastCalledWith({
      actor_id: actorId,
      action: "compte_desactive",
      cible: targetId,
      details: { statut: "confirme" },
    });
  });

  it("reactive un compte desactive par la procedure", async () => {
    prepareDisabledAccount();
    await expect(enable(request())).resolves.toEqual({ ok: true });

    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith(targetId, {
      ban_duration: "none",
      app_metadata: {
        provider: "email",
        medlink_access_state: "active",
      },
    });

    expect(mocks.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "compte_reactive", actor_id: actorId }),
    );
  });

  it("annule si l'audit initial echoue", async () => {
    mocks.audit.mockResolvedValue({ error: { message: "Audit unavailable" } });
    await expect(disable(request())).rejects.toThrow("journalisation indisponible");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("revérifie les droits avant la modification", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValue({ data: false, error: null });

    await expect(disable(request())).rejects.toThrow("Super Admin");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("signale une reponse reseau perdue sans annoncer de succes", async () => {
    mocks.updateUser.mockRejectedValue(new Error("Network failure"));
    await expect(disable(request())).rejects.toThrow("Résultat inconnu");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("signale un audit final en echec apres changement du statut", async () => {
    mocks.audit
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "Audit unavailable" } });

    await expect(disable(request())).rejects.toThrow(
      "Statut modifié, mais audit final non confirmé",
    );
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
  });
});
