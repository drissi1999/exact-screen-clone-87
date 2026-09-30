import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSimulatedMessages } from "@/lib/portal.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Messages simulés — Reprise" },
      { name: "description", content: "Tous les SMS et emails qui auraient été envoyés, à qui et quand." },
      { property: "og:title", content: "Messages simulés — Reprise" },
      { property: "og:description", content: "Journal des envois simulés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const fList = useServerFn(listSimulatedMessages);
  const { data, isLoading } = useQuery({ queryKey: ["sim-messages"], queryFn: () => fList() });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Messages simulés</h1>
        <p className="mt-1 text-sm text-muted-foreground">Aucun SMS ni email n'est réellement envoyé. Voici exactement ce qui l'aurait été.</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Aucun message pour le moment.</p>}
      <div className="space-y-3">
        {data?.map((m) => (
          <div key={m.id} className="panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{m.channel}</Badge>
              <span className="font-medium">{m.recipient_label}</span>
              {m.to_address && <span className="text-muted-foreground">({m.to_address})</span>}
              <span className="ml-auto text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>
            </div>
            {m.subject && <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.subject}</p>}
            <pre className="whitespace-pre-wrap break-all font-sans text-sm">{m.body}</pre>
            {m.case_id && <Link to="/dossiers/$caseId" params={{ caseId: m.case_id }} className="text-xs text-primary hover:underline">Voir le dossier</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}
