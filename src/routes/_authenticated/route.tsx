import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";
import { getMe } from "@/lib/cases.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

type NavItem = { to: "/ma-journee" | "/visites" | "/dossiers" | "/agenda" | "/tableau-de-bord" | "/employeur"; label: string };
const ADMIN_ITEMS = [
  { to: "/tableau-de-bord", label: "Tableau de bord" },
  { to: "/entreprises", label: "Entreprises" },
  { to: "/parametres/imports", label: "Imports" },
  { to: "/messages", label: "Messages simulés" },
  { to: "/parametres/equipe", label: "Équipe" },
  { to: "/apercu", label: "Voir en tant que" },
] as const;

/** Primary navigation by role; everything else lives under "Administration". */
function navFor(roles: string[]): NavItem[] {
  const coord = roles.includes("IDEST") || roles.includes("PDP_COORDINATOR");
  const med = roles.includes("MEDECIN_TRAVAIL");
  const items: NavItem[] = [];
  if (coord) items.push({ to: "/ma-journee", label: "Ma journée" });
  if (med) items.push({ to: "/visites", label: "Visites à préparer" });
  if (!coord && !med) items.push({ to: "/tableau-de-bord", label: "Tableau de bord" });
  items.push({ to: "/dossiers", label: "Dossiers" });
  if (coord) items.push({ to: "/agenda", label: "Agenda" });
  return items;
}

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [checked, setChecked] = useState(false);
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe(), enabled: checked });
  const roles = me?.roles ?? [];
  const staff = roles.some((r) => r !== "EMPLOYER_HR" && r !== "WORKER");
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

  const primary: NavItem[] = employerOnly ? [{ to: "/employeur", label: "Demandes du service" }] : me ? navFor(roles) : [];
  const linkCls = (active: boolean) => cn(
    "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
    active && "bg-accent text-accent-foreground hover:text-accent-foreground",
  );
  const adminActive = ADMIN_ITEMS.some((i) => pathname.startsWith(i.to)) && !primary.some((p) => pathname.startsWith(p.to));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-3">
          <Link to={employerOnly ? "/employeur" : "/accueil"} className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground text-sm">R</span>
            Reprise
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {primary.map((item) => (
              <Link key={item.to} to={item.to} className={linkCls(pathname.startsWith(item.to))}>{item.label}</Link>
            ))}
            {staff && (
              <DropdownMenu>
                <DropdownMenuTrigger className={cn(linkCls(adminActive), "inline-flex items-center gap-1")}>
                  Administration <ChevronDown className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {ADMIN_ITEMS.map((i) => (
                    <DropdownMenuItem key={i.to} asChild><Link to={i.to}>{i.label}</Link></DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={signOut}>Déconnexion</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
