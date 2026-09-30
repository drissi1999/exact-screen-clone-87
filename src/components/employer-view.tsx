import { UPLOAD_ACCEPT } from "@/lib/file-signature";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { employerCompleteTask, employerUpload, getEmployerDocUrl, getEmployerPortal } from "@/lib/portal.functions";
import { fileToBase64, frDate } from "@/lib/file-to-base64";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS: Record<string, string> = { A_VENIR: "À venir", EN_COURS: "En cours", DEPASSEE: "Dépassée", INFO: "Dès la reprise connue" };

export function EmployerView({ asCompanyId }: { asCompanyId?: string }) {
  const readOnly = !!asCompanyId;
  const qc = useQueryClient();
  const fPortal = useServerFn(getEmployerPortal);
  const fUrl = useServerFn(getEmployerDocUrl);
  const fUpload = useServerFn(employerUpload);
  const fDone = useServerFn(employerCompleteTask);
  const { data, isLoading, error } = useQuery({ queryKey: ["employer-portal", asCompanyId ?? "me"], queryFn: () => fPortal({ data: { asCompanyId } }) });

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["employer-portal"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">{error instanceof Error ? error.message : "Accès refusé"}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Espace employeur · {data.company}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conformément au secret médical, aucune information de santé n'est visible ici.</p>
      </div>
      {data.cases.length === 0 && <p className="text-sm text-muted-foreground">Aucun salarié accompagné pour le moment.</p>}
      {data.cases.map((c: any) => (
        <div key={c.id} className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-display text-lg font-semibold">{c.worker}</p>
              <p className="text-sm text-muted-foreground">{c.jobTitle ?? "Poste non renseigné"} · accompagnement depuis le {frDate(c.openedAt)}</p>
            </div>
            <Badge variant={c.status === "OPEN" ? "default" : "secondary"}>{c.status === "OPEN" ? "En cours" : "Clos"}</Badge>
          </div>
          <div className="text-sm">
            <p className="font-medium">Périodes d'absence</p>
            {c.periods.map((p: any, i: number) => <p key={i} className="text-muted-foreground">du {frDate(p.start)} au {p.end ? frDate(p.end) : "date non connue"}</p>)}
          </div>
          {c.deadlines.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Échéances vous concernant</p>
              {c.deadlines.map((d: any) => (
                <p key={d.code} className="text-muted-foreground">{d.label} — limite {frDate(d.due)} <Badge variant={d.status === "DEPASSEE" ? "destructive" : "outline"}>{STATUS[d.status]}</Badge> <Badge variant="outline">à valider juridiquement</Badge></p>
              ))}
            </div>
          )}
          {c.tasks.length > 0 && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Demandes du service</p>
              {c.tasks.map((t: any) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                  <p>{t.message}</p>
                  {t.status === "DONE" || readOnly ? <Badge variant="secondary">{t.status === "DONE" ? "Traité" : "À traiter"}</Badge> : <Button size="sm" variant="outline" onClick={() => act(() => fDone({ data: { taskId: t.id } }), "Demande marquée comme traitée")}>Marquer traité</Button>}
                </div>
              ))}
            </div>
          )}
          {c.letters.map((l: any) => (
            <div key={l.id} className="rounded-md border border-border p-3 text-sm">
              <p className="mb-2 text-xs text-muted-foreground">Courrier validé le {frDate(l.approvedAt)}</p>
              <pre className="whitespace-pre-wrap font-sans">{l.text}</pre>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {c.documents.map((d: any) => (
              readOnly ? <span key={d.id} className="text-muted-foreground">{d.title}</span> : <Button key={d.id} size="sm" variant="ghost" onClick={() => act(async () => { const { url } = await fUrl({ data: { documentId: d.id } }); if (url) window.open(url, "_blank"); }, "Ouverture…")}>{d.title}</Button>
            ))}
            {!readOnly && <label className="cursor-pointer text-primary hover:underline">
              Envoyer une fiche de poste
              <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) await act(async () => fUpload({ data: { caseId: c.id, filename: f.name, mimeType: f.type || "application/octet-stream", base64: await fileToBase64(f) } }), "Document envoyé");
              }} />
            </label>}
          </div>
        </div>
      ))}
    </div>
  );
}
