import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, frDate } from "@/components/kit";

export const Route = createFileRoute("/_authenticated/parametres/demandes-demo")({
  head: () => ({
    meta: [
      { title: "Demandes de démo — Reprise" },
      { name: "description", content: "Demandes de démonstration reçues depuis la page d'accueil." },
      { property: "og:title", content: "Demandes de démo — Reprise" },
      { property: "og:description", content: "Demandes de démonstration reçues depuis la page d'accueil." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemoRequests,
});

type Row = { id: string; full_name: string; organisation: string; email: string; message: string | null; created_at: string };

function DemoRequests() {
  // RLS: only SPSTI_ADMIN can read; others get an empty list.
  const { data, isLoading } = useQuery({
    queryKey: ["demo-requests"],
    queryFn: async () => ((await supabase.from("demo_requests" as any).select("id, full_name, organisation, email, message, created_at").order("created_at", { ascending: false })).data ?? []) as unknown as Row[],
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demandes de démo</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reçues depuis la page d'accueil. Aucun e-mail n'est envoyé (prototype). Visible par les administrateurs uniquement.</p>
      </div>
      {isLoading ? <p className="text-muted-foreground">Chargement…</p> : !data?.length ? <EmptyState text="Aucune demande pour l'instant." /> : (
        <ul className="panel divide-y divide-border">
          {data.map((r) => (
            <li key={r.id} className="space-y-1 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{r.full_name} · <span className="font-normal text-muted-foreground">{r.organisation}</span></p>
                <span className="text-xs text-muted-foreground">{frDate(r.created_at)}</span>
              </div>
              <p className="text-sm">{r.email}</p>
              {r.message && <p className="text-sm text-muted-foreground">{r.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
