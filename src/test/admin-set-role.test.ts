import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  serviceRpc: vi.fn(),
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
  supabaseAdmin: { rpc: mocks.serviceRpc },
}));

import { setRole } from "../lib/admin.functions";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";

type Role = "patient" | "praticien" | "admin" | "super_admin";

type HandlerInput = {
  data: {
    user_id: string;
    role: Role;
    action: "add" | "remove";
  };
  context: {
    userId: string;
    claims: { aal: string };
    supabase: { rpc: typeof mocks.rpc };
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
      action: "add",
    },
    context: {
      userId: actorId,
      claims: { aal },
      supabase: { rpc: mocks.rpc },
    },
  };
}

function authorize(actorRole: "admin" | "super_admin" | null) {
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "has_role") {
      return { data: args._role === actorRole, error: null };
    }
    if (name === "change_user_role") {
      return { data: null, error: null };
    }
    throw new Error(`RPC inattendue : ${name}`);
  });
}

function changes() {
  return mocks.rpc.mock.calls.filter(
    ([name]) => name === "change_user_role",
  );
}

describe("Gestion des rôles administrateur", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authorize("super_admin");
  });

  it("refuse une session sans MFA", async () => {
    await expect(runSetRole(request("aal1")))
      .rejects.toThrow("MFA requise");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur non administrateur", async () => {
    authorize(null);
    await expect(runSetRole(request()))
      .rejects.toThrow("Accès refusé");
    expect(changes()).toHaveLength(0);
  });

  it("refuse une vérification des droits en erreur", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Internal details" },
    });
    await expect(runSetRole(request()))
      .rejects.toThrow("Vérification des droits impossible.");
    expect(changes()).toHaveLength(0);
  });

  it("interdit la modification de son propre compte", async () => {
    const input = request();
    input.data.user_id = actorId;
    await expect(runSetRole(input))
      .rejects.toThrow("Vous ne pouvez pas modifier votre propre rôle.");
    expect(changes()).toHaveLength(0);
  });

  it("ajoute un rôle via le client utilisateur", async () => {
    await expect(runSetRole(request())).resolves.toEqual({ ok: true });
    expect(changes()).toEqual([
      ["change_user_role", {
        _target_user: targetId,
        _role: "praticien",
        _action: "add",
      }],
    ]);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("transmet une demande de retrait sans remplacer les autres rôles", async () => {
    const input = request();
    input.data.action = "remove";
    await expect(runSetRole(input)).resolves.toEqual({ ok: true });
    expect(changes()[0]?.[1]).toEqual({
      _target_user: targetId,
      _role: "praticien",
      _action: "remove",
    });
  });

  it("accepte un acteur super administrateur", async () => {
    authorize("super_admin");
    const input = request();
    input.data.role = "super_admin";
    await expect(runSetRole(input)).resolves.toEqual({ ok: true });
    expect(changes()).toHaveLength(1);
  });

  it("respecte un refus SQL sans exposer son détail", async () => {
    mocks.rpc.mockImplementation(async (name) => {
      if (name === "has_role") {
        return { data: true, error: null };
      }
      return {
        data: null,
        error: { message: "Internal database details" },
      };
    });
    await expect(runSetRole(request()))
      .rejects.toThrow("Modification du rôle refusée ou impossible.");
    expect(changes()).toHaveLength(1);
  });
  it("refuse les changements de roles par un admin simple", async () => {
    authorize("admin");
    await expect(runSetRole(request()))
      .rejects.toThrow("Accès réservé au Super Admin.");
    expect(changes()).toHaveLength(0);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

});