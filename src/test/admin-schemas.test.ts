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

  it("refuse un identifiant de clinique invalide", () => {
    const input = { ...account, cliniques: ["invalide"] };

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