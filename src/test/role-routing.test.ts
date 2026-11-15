import { describe, expect, it } from "vitest";
import { homeFor } from "../lib/auth";

describe("Destination après connexion", () => {
  it("oriente un patient vers son espace", () => {
    expect(homeFor(["patient"])).toBe("/patient");
  });

  it("oriente un praticien qui a aussi le rôle patient vers l’agenda", () => {
    expect(homeFor(["patient", "praticien"])).toBe("/praticien");
  });

  it("donne la priorité à l’espace admin si plusieurs rôles sont présents", () => {
    expect(homeFor(["patient", "praticien", "admin"])).toBe("/admin");
  });

  it("choisit l’espace patient par défaut si aucun rôle n’est fourni", () => {
    expect(homeFor([])).toBe("/patient");
  });
});