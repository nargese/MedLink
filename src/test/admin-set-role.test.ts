import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasRole: vi.fn(),
  setRoleRpc: vi.fn(),
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
    rpc: mocks.setRoleRpc,
  },
}));

import { setRole } from "../lib/admin.functions";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";

type HandlerInput = {
  data: {
    user_id: string;
    role: "patient" | "praticien" | "admin";
  };
  context: {
    userId: string;
    claims: { aal: string };
    supabase: { rpc: typeof mocks.hasRole };
  };
};

const runSetRole = setRole as unknown as (
  input: HandlerInput,
) => Promise<{ ok: true }>;

function request(aal = "aal2"): HandlerInput {
  return {
    data: {
      user_id: targetId,
      role: "praticien",
    },
    context: {
      userId: actorId,
      claims: { aal },
      supabase: { rpc: mocks.hasRole },
    },
  };
}

describe("Changement de rôle administrateur", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.hasRole.mockResolvedValue({
      data: true,
      error: null,
    });

    mocks.setRoleRpc.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  it("refuse une session sans MFA renforcée", async () => {
    await expect(runSetRole(request("aal1")))
      .rejects.toThrow("MFA requise");

    expect(mocks.hasRole).not.toHaveBeenCalled();
    expect(mocks.setRoleRpc).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur non administrateur", async () => {
    mocks.hasRole.mockResolvedValue({
      data: false,
      error: null,
    });

    await expect(runSetRole(request()))
      .rejects.toThrow("Accès refusé");

    expect(mocks.setRoleRpc).not.toHaveBeenCalled();
  });

  it("refuse si la vérification du rôle échoue", async () => {
    mocks.hasRole.mockResolvedValue({
      data: null,
      error: { message: "Database unavailable" },
    });

    await expect(runSetRole(request()))
      .rejects.toThrow("Accès refusé");

    expect(mocks.setRoleRpc).not.toHaveBeenCalled();
  });

  it("interdit la modification de son propre rôle", async () => {
    const input = request();
    input.data.user_id = actorId;

    await expect(runSetRole(input))
      .rejects.toThrow(
        "Vous ne pouvez pas modifier votre propre rôle.",
      );

    expect(mocks.setRoleRpc).not.toHaveBeenCalled();
  });

  it("signale un échec SQL sans exposer le détail interne", async () => {
    mocks.setRoleRpc.mockResolvedValue({
      data: null,
      error: { message: "Internal database details" },
    });

    await expect(runSetRole(request()))
      .rejects.toThrow(
        "Modification du rôle impossible. Réessayez.",
      );

    expect(mocks.setRoleRpc).toHaveBeenCalledTimes(1);
  });

  it("utilise l'identité de l'acteur provenant du contexte", async () => {
    await expect(runSetRole(request()))
      .resolves.toEqual({ ok: true });

    expect(mocks.hasRole).toHaveBeenCalledWith("has_role", {
      _user_id: actorId,
      _role: "admin",
    });

    expect(mocks.setRoleRpc).toHaveBeenCalledExactlyOnceWith(
      "admin_set_role_atomic",
      {
        _actor_id: actorId,
        _user_id: targetId,
        _role: "praticien",
      },
    );

    expect(mocks.hasRole.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setRoleRpc.mock.invocationCallOrder[0]);
  });
});