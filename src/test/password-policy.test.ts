import { describe, expect, it } from "vitest";
import { passwordIssues } from "../lib/auth";

describe("Politique de mot de passe", () => {
  it("accepte un mot de passe conforme de 12 caractères", () => {
    expect(passwordIssues("MedLink2026!")).toEqual([]);
  });

  it.each([
    ["MedLin2026!", "12 caractères minimum"],
    ["medlink2026!", "une majuscule"],
    ["MEDLINK2026!", "une minuscule"],
    ["MedLinkTest!", "un chiffre"],
    ["MedLink2026X", "un caractère spécial"],
  ])("signale la règle manquante pour %s", (password, issue) => {
    expect(passwordIssues(password)).toEqual([issue]);
  });
});
