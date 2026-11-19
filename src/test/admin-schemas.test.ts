import { describe, expect, it } from "vitest";
import { staffSchema, setRoleSchema } from "../lib/admin.schemas";

const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const account = {
  email: "test@example.com",
  password: "DemoMedLink2026!",
  full_name: "Compte Test",
  role: "patient",
};

describe("Validation des données admin", () => {
  it("accepte un compte patient sans fiche praticien", () => {
    expect(staffSchema.parse(account)).toEqual(account);
  });

  it("accepte un praticien avec une clinique valide", () => {
    const input = {
      ...account,
      role: "praticien",
      cliniques: [id],
    };

    expect(staffSchema.parse(input)).toEqual(input);
  });

  it("accepte les trois cliniques des données initiales", () => {
    const input = {
      ...account,
      role: "praticien",
      cliniques: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
      ],
    };

    expect(staffSchema.parse(input)).toEqual(input);
  });

  it.each([
    "a0000000-0000-0000-0000-000000000001",
    "a0000000-0000-0000-0000-000000000002",
    "a0000000-0000-0000-0000-000000000003",
    "a0000000-0000-0000-0000-000000000004",
    "a0000000-0000-0000-0000-000000000005",
    "a0000000-0000-0000-0000-000000000006",
  ])("accepte le praticien initial %s", (praticienId) => {
    const input = {
      ...account,
      role: "praticien",
      praticien_id: praticienId,
    };

    expect(staffSchema.parse(input)).toEqual(input);
  });

  it("refuse un identifiant de clinique invalide", () => {
    const input = {
      ...account,
      cliniques: ["invalide"],
    };

    expect(staffSchema.safeParse(input).success).toBe(false);
  });

  it("refuse un identifiant de praticien invalide", () => {
    const input = {
      ...account,
      role: "praticien",
      praticien_id: "invalide",
    };

    expect(staffSchema.safeParse(input).success).toBe(false);
  });

  it("refuse plus de trois cliniques", () => {
    const input = {
      ...account,
      role: "praticien",
      cliniques: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
        id,
      ],
    };

    expect(staffSchema.safeParse(input).success).toBe(false);
  });

  it("accepte un changement de rôle valide", () => {
    const input = { user_id: id, role: "praticien" };

    expect(setRoleSchema.parse(input)).toEqual(input);
  });

  it("refuse un rôle inconnu", () => {
    const input = { user_id: id, role: "autre" };

    expect(setRoleSchema.safeParse(input).success).toBe(false);
  });
});