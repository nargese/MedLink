import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasRole: vi.fn(),
  createUser: vi.fn(),
  finalize: vi.fn(),
  activate: vi.fn(),
}));

// Exposer le handler pour tester sa logique sans serveur TanStack.
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
        createUser: mocks.createUser,
        updateUserById: mocks.activate,
      },
    },
    rpc: mocks.finalize,
  },
}));

import { createAccount } from "../lib/admin.functions";

const actorId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";

const account = {
  email: "test@example.com",
  password: "DemoMedLink2026!",
  full_name: "Compte Test",
  role: "patient",
};

type HandlerInput = {
  data: typeof account & {
    praticien_id?: string;
    specialite?: string;
    cliniques?: string[];
  };
  context: {
    userId: string;
    claims: { aal: string };
    supabase: { rpc: typeof mocks.hasRole };
  };
};

const runCreateAccount = createAccount as unknown as (
  input: HandlerInput,
) => Promise<{ id: string }>;

function request(aal = "aal2"): HandlerInput {
  return {
    data: { ...account },
    context: {
      userId: actorId,
      claims: { aal },
      supabase: { rpc: mocks.hasRole },
    },
  };
}

describe("Création administrée des comptes", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.hasRole.mockResolvedValue({
      data: true,
      error: null,
    });

    mocks.createUser.mockResolvedValue({
      data: {
        user: {
          id: userId,
          banned_until: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      },
      error: null,
    });

    mocks.finalize.mockResolvedValue({
      data: null,
      error: null,
    });

    mocks.activate.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
  });

  it("refuse une session sans MFA renforcée", async () => {
    await expect(runCreateAccount(request("aal1")))
      .rejects.toThrow("MFA requise");

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur non administrateur", async () => {
    mocks.hasRole.mockResolvedValue({
      data: false,
      error: null,
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Accès refusé");

    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuse si la vérification du rôle échoue", async () => {
    mocks.hasRole.mockResolvedValue({
      data: null,
      error: { message: "Database unavailable" },
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Accès refusé");

    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("arrête le parcours si la création échoue", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Email already exists" },
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Création du compte impossible");

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("arrête le parcours si la réponse de création est perdue", async () => {
    mocks.createUser.mockRejectedValue(new Error("Network error"));

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Vérifiez si le compte existe");

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("refuse de finaliser sans suspension confirmée", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("suspension initiale");

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("n'active pas le compte si la finalisation échoue", async () => {
    mocks.finalize.mockResolvedValue({
      data: null,
      error: { message: "Invalid clinic" },
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("finalisation du compte");

    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("n'active pas le compte si le résultat SQL est inconnu", async () => {
    mocks.finalize.mockRejectedValue(new Error("Network error"));

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Résultat de la finalisation inconnu");

    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("revérifie les droits avant l'activation", async () => {
    mocks.hasRole
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("Accès refusé");

    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("signale un échec d'activation", async () => {
    mocks.activate.mockResolvedValue({
      data: { user: null },
      error: { message: "Activation failed" },
    });

    await expect(runCreateAccount(request()))
      .rejects.toThrow("activation non confirmée");
  });

  it("crée, finalise puis active le compte dans cet ordre", async () => {
    const steps: string[] = [];

    mocks.createUser.mockImplementation(async (attributes) => {
      steps.push("creation");
      expect(attributes.ban_duration).toBe("876000h");

      return {
        data: {
          user: {
            id: userId,
            banned_until: new Date(
              Date.now() + 86_400_000,
            ).toISOString(),
          },
        },
        error: null,
      };
    });

    mocks.finalize.mockImplementation(async () => {
      steps.push("finalisation");
      return { data: null, error: null };
    });

    mocks.activate.mockImplementation(async () => {
      steps.push("activation");
      return {
        data: { user: { id: userId } },
        error: null,
      };
    });

    await expect(runCreateAccount(request()))
      .resolves.toEqual({ id: userId });

    expect(steps).toEqual([
      "creation",
      "finalisation",
      "activation",
    ]);

    expect(mocks.finalize).toHaveBeenCalledWith(
      "admin_finalize_account_atomic",
      {
        _actor_id: actorId,
        _user_id: userId,
        _role: "patient",
        _praticien_id: null,
        _specialite: null,
        _cliniques: [],
      },
    );

    expect(mocks.activate).toHaveBeenCalledWith(userId, {
      ban_duration: "none",
    });
  });
});