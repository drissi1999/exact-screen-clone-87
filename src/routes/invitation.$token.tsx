import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { acceptInvitation, getInvitation } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/invitation/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Invitation espace employeur — Reprise" },
      { name: "description", content: "Créez votre mot de passe pour accéder à l'espace employeur." },
      { property: "og:title", content: "Invitation espace employeur — Reprise" },
      { property: "og:description", content: "Activation de votre espace employeur." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitationPage,
});

function InvitationPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const fGet = useServerFn(getInvitation);
  const fAccept = useServerFn(acceptInvitation);
  const { data, isLoading } = useQuery({ queryKey: ["invitation", token], queryFn: () => fGet({ data: { token } }), retry: false });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { toast.error("Les mots de passe ne correspondent pas"); return; }
    setBusy(true);
    try {
      const { email } = await fAccept({ data: { token, password: pw } });
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      navigate({ to: "/employeur", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="panel w-full max-w-md space-y-4 p-6">
        <h1 className="font-display text-xl font-semibold">Espace employeur</h1>
        {isLoading && <p className="text-sm text-muted-foreground">Vérification de l'invitation…</p>}
        {data && !data.valid && <p className="text-sm text-destructive">Cette invitation est invalide, déjà utilisée ou expirée.</p>}
        {data?.valid && (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-muted-foreground">Invitation pour <strong>{data.email}</strong> · {data.company}. Choisissez votre mot de passe (10 caractères minimum).</p>
            <Input type="password" placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
            <Input type="password" placeholder="Confirmer le mot de passe" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={10} required />
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Création…" : "Créer mon accès"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
