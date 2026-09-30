import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion — Reprise" },
      { name: "description", content: "Accédez à votre espace Reprise : imports, dossiers et suivi des arrêts." },
      { property: "og:title", content: "Connexion — Reprise" },
      { property: "og:description", content: "Accédez à votre espace Reprise." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/tableau-de-bord", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/tableau-de-bord` },
        });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez votre boîte mail si une confirmation est demandée.");
        const { data } = await supabase.auth.getSession();
        if (data.session) navigate({ to: "/tableau-de-bord" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/tableau-de-bord" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connexion impossible");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error("Connexion Google impossible");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/tableau-de-bord" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="panel w-full max-w-md p-8">
        <Link to="/" className="font-display text-lg font-semibold tracking-tight">
          Reprise
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">
          {mode === "signin" ? "Connexion" : "Créer un compte"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Espace réservé aux équipes des services de prévention et de santé au travail.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Adresse e-mail professionnelle</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={255}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Veuillez patienter…" : mode === "signin" ? "Se connecter" : "Créer le compte"}
          </Button>
        </form>

        <Button type="button" variant="outline" className="mt-3 w-full" onClick={handleGoogle}>
          Continuer avec Google
        </Button>

        <button
          type="button"
          className="mt-6 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}
        </button>
      </div>
    </main>
  );
}
