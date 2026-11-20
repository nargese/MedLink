import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
  next: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({
    server: (handler: unknown) => handler,
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.getRequest,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

import { requireSupabaseAuth } from
  "../integrations/supabase/auth-middleware";

const runMiddleware = requireSupabaseAuth as unknown as (
  input: { next: typeof mocks.next },
) => Promise<unknown>;

const userId = "10000000-0000-4000-8000-000000000001";
const token = "header.payload.signature";

function authorization(value?: string) {
  mocks.getRequest.mockReturnValue({
    headers: new Headers(
      value === undefined ? {} : { authorization: value },
    ),
  });
}

describe("Middleware d'authentification", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Valeurs fictives : aucun appel réseau réel.
    vi.stubEnv("SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public-key");

    mocks.createClient.mockReturnValue({
      auth: { getClaims: mocks.getClaims },
      rpc: mocks.rpc,
    });

    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: userId, aal: "aal2" } },
      error: null,
    });

    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.next.mockResolvedValue("suite executee");
    authorization(`Bearer ${token}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuse une requête sans en-têtes", async () => {
    mocks.getRequest.mockReturnValue(undefined);

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("No request headers available");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse un en-tête Authorization absent", async () => {
    authorization();

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("No authorization header provided");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse un mécanisme autre que Bearer", async () => {
    authorization("Basic credentials");

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("Only Bearer tokens are supported");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse un jeton vide", async () => {
    // Headers normalise les espaces finaux.
    authorization("Bearer ");

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse un jeton qui ne comporte pas trois parties", async () => {
    authorization("Bearer invalid-token");

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("Invalid token");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse un jeton rejeté par Supabase", async () => {
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { message: "Invalid signature" },
    });

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("Invalid token");

    expect(mocks.getClaims).toHaveBeenCalledWith(token);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse des claims sans identité utilisateur", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { aal: "aal2" } },
      error: null,
    });

    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("No user ID found in token");

    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("transmet les claims vérifiés et le client au handler suivant", async () => {
    await expect(runMiddleware({ next: mocks.next }))
      .resolves.toBe("suite executee");

    expect(mocks.getClaims).toHaveBeenCalledExactlyOnceWith(token);

    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.invalid",
      "test-public-key",
      expect.objectContaining({
        global: expect.objectContaining({
          fetch: expect.any(Function),
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      }),
    );

    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({
      context: {
        supabase: mocks.createClient.mock.results[0]?.value,
        userId,
        claims: { sub: userId, aal: "aal2" },
      },
    });
  });
  it("refuse un compte suspendu avec un JWT valide", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("Account suspended or unavailable");
    expect(mocks.getClaims).toHaveBeenCalledExactlyOnceWith(token);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("account_is_active");
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("refuse si la verification du statut echoue", async () => {
    mocks.rpc.mockResolvedValue({
      data: null, error: { message: "Internal database details" },
    });
    await expect(runMiddleware({ next: mocks.next }))
      .rejects.toThrow("Account status unavailable");
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("controle le statut avant de poursuivre", async () => {
    await runMiddleware({ next: mocks.next });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("account_is_active");
    expect(mocks.rpc.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.next.mock.invocationCallOrder[0]!);
  });

});