import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { passwordIssues } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nouveau mot de passe — MedLink" },
      { name: "description", content: "Définissez un nouveau mot de passe pour votre compte MedLink." },
      { property: "og:title", content: "Nouveau mot de passe — MedLink" },
      { property: "og:description", content: "Réinitialisation du mot de passe MedLink." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;

    const issues = passwordIssues(pw);
    if (issues.length) {
      toast.error("Mot de passe : " + issues.join(", "));
      return;
    }

    setBusy(true);

    try {
      const session = await supabase.auth.getSession();
      if (session.error) throw session.error;
      if (!session.data.session) {
        throw new Error(
          "Session absente ou expirée. Demandez un nouveau lien de réinitialisation.",
        );
      }

      const assurance =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;

      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;

      const hasVerifiedFactor = factors.data.all.some(
        (factor) => factor.status === "verified",
      );

      if (
        assurance.data.currentLevel !== "aal2" &&
        (hasVerifiedFactor || assurance.data.nextLevel === "aal2")
      ) {
        const factor = factors.data.totp.find(
          (entry) => entry.status === "verified",
        );

        if (!factor) {
          throw new Error(
            "Ce compte nécessite une autre méthode MFA. Contactez l’administrateur.",
          );
        }

        setNeedsMfa(true);

        if (!/^\d{6}$/.test(code)) {
          toast.info(
            "Saisissez le code à 6 chiffres de votre application d’authentification.",
          );
          return;
        }

        const verification = await supabase.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code,
        });

        if (verification.error) {
          setCode("");
          throw new Error(
            "Vérification MFA impossible. Vérifiez le code et réessayez.",
          );
        }

        setCode("");

        const confirmed =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (confirmed.error) throw confirmed.error;
        if (confirmed.data.currentLevel !== "aal2") {
          throw new Error("La validation MFA n’a pas été confirmée.");
        }
      }

      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;

      setPw("");
      toast.success("Mot de passe mis à jour.");
      await navigate({ to: "/espace", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le mot de passe. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl">Nouveau mot de passe</h1>

        <div className="space-y-2">
          <Label htmlFor="np">Mot de passe</Label>
          <Input
            id="np"
            type="password"
            autoComplete="new-password"
            required
            value={pw}
            disabled={busy}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>

        {needsMfa && (
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Code de vérification MFA</Label>
            <p className="text-sm text-muted-foreground">
              Saisissez le code de votre application d’authentification.
            </p>
            <Input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              value={code}
              disabled={busy}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Vérification…" : "Enregistrer"}
        </Button>
      </form>
    </div>
  );
}