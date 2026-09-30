import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/cases.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/tableau-de-bord", label: "Tableau de bord" },
  { to: "/dossiers", label: "Dossiers" },
  { to: "/entreprises", label: "Entreprises" },
  { to: "/messages", label: "Messages simulés" },
  { to: "/parametres/imports", label: "Imports" },
  { to: "/parametres/equipe", label: "Équipe · Accès" },
  { to: "/apercu", label: "Voir en tant que" },
] as const;

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [checked, setChecked] = useState(false);
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe(), enabled: checked });
  const staff = (me?.roles ?? []).some((r) => r !== "EMPLOYER_HR" && r !== "WORKER");
  const employerOnly = !!me && !staff;
  useEffect(() => {
    if (employerOnly && !pathname.startsWith("/employeur")) navigate({ to: "/employeur", replace: true });
  }, [employerOnly, pathname, navigate]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) navigate({ to: "/auth", replace: true });
      else setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate({ to: "/auth", replace: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!checked) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
          <Link to={employerOnly ? "/employeur" : "/tableau-de-bord"} className="font-display text-lg font-semibold tracking-tight">
            Reprise
          </Link>
          <nav className="flex flex-wrap gap-1">
            {(employerOnly ? ([{ to: "/employeur", label: "Espace employeur" }] as const) : NAV).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted",
                  pathname.startsWith(item.to) && "bg-accent text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={signOut}>
            Déconnexion
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
