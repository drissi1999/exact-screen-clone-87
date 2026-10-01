import { UPLOAD_ACCEPT } from "@/lib/file-signature";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { employerCompletePlanTask, employerCompleteTask, employerUpload, getEmployerDocUrl, getEmployerPortal } from "@/lib/portal.functions";
import { fileToBase64, frDate } from "@/lib/file-to-base64";
import { Lock, Upload } from "lucide-react";
import { DeadlineBadge, EmptyState, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";

const STATUS: Record<string, string> = { A_VENIR: "À venir", EN_COURS: "En cours", DEPASSEE: "Dépassée", INFO: "Dès la reprise connue", FAIT: "Fait", NON_REALISE: "Non réalisé", ECHUE: "Échue", PLANIFIEE: "Visite planifiée" };

export function EmployerView({ asCompanyId }: { asCompanyId?: string }) {
  const readOnly = !!asCompanyId;
  const qc = useQueryClient();
  const fPortal = useServerFn(getEmployerPortal);
  const fUrl = useServerFn(getEmployerDocUrl);
  const fUpload = useServerFn(employerUpload);
  const fDone = useServerFn(employerCompleteTask);
  const fPlanDone = useServerFn(employerCompletePlanTask);
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

  const upload = (caseId: string, f: File, then?: () => Promise<unknown>) => act(async () => {
    await fUpload({ data: { caseId, filename: f.name, mimeType: f.type || "application/octet-stream", base64: await fileToBase64(f) } });
    if (then) await then();
  }, "Document envoyé");

  type Req = { kind: "plan" | "task"; id: string; caseId: string; worker: string; text: string; due: string | null; done: boolean; requiresDocument: boolean };
  const requests: Req[] = data.cases.flatMap((c: any) => [
    ...c.planTasks.map((t: any) => ({ kind: "plan" as const, id: t.id, caseId: c.id, worker: c.worker, text: t.title, due: t.due as string | null, done: t.status === "DONE", requiresDocument: !!t.requiresDocument })),
    ...c.tasks.map((t: any) => ({ kind: "task" as const, id: t.id, caseId: c.id, worker: c.worker, text: t.message, due: null as string | null, done: t.status === "DONE", requiresDocument: false })),
  ]);
  const pending = requests.filter((r) => !r.done).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const done = requests.filter((r) => r.done);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm font-medium text-primary">{data.company}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Demandes du service <span className="text-muted-foreground">({pending.length} en attente)</span></h1>
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden />Secret médical : aucune information de santé n'est visible ici.</p>
      </div>

      <section className="space-y-3">
        {pending.length === 0 ? (
          <EmptyState text="Aucune demande en attente. Le service vous préviendra ici." />
        ) : (
          <ul className="panel divide-y divide-border">
            {pending.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-56 flex-1">
                  <p className="text-sm font-medium">{r.text}</p>
                  <p className="text-xs text-muted-foreground">{r.worker}{r.requiresDocument ? " · document à joindre" : ""}</p>
                </div>
                {r.due && <DeadlineBadge due={r.due} />}
                {readOnly ? <StatusBadge>À faire</StatusBadge> : (
                  <div className="flex items-center gap-2">
                    {r.requiresDocument ? (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                        <Upload className="h-3.5 w-3.5" aria-hidden />Envoyer le document
                        <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) upload(r.caseId, f, () => fPlanDone({ data: { taskId: r.id } }));
                        }} />
                      </label>
                    ) : (
                      <Button size="sm" onClick={() => act(() => (r.kind === "plan" ? fPlanDone({ data: { taskId: r.id } }) : fDone({ data: { taskId: r.id } })), "Demande traitée")}>C'est fait</Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && <p className="text-xs text-muted-foreground">{done.length} demande{done.length > 1 ? "s" : ""} déjà traitée{done.length > 1 ? "s" : ""}.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Vos salariés absents <span className="font-normal">· {data.cases.length}</span></h2>
        {data.cases.length === 0 && <EmptyState text="Aucun salarié accompagné pour le moment." />}
        {data.cases.map((c: any) => (
          <div key={c.id} className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-lg font-semibold">{c.worker}</p>
                <p className="text-sm text-muted-foreground">{c.jobTitle ?? "Poste non renseigné"} · accompagnement depuis le {frDate(c.openedAt)}</p>
              </div>
              <StatusBadge tone={c.status === "OPEN" ? "info" : "done"}>{c.status === "OPEN" ? "En cours" : "Clos"}</StatusBadge>
            </div>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Périodes d'absence</p>
                {c.periods.map((p: any, i: number) => <p key={i} className="mt-1">du {frDate(p.start)} au {p.end ? frDate(p.end) : "date non connue"}</p>)}
              </div>
              {c.deadlines.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Échéances vous concernant · à valider juridiquement</p>
                  {c.deadlines.map((d: any) => (
                    <div key={d.code} className="mt-1 flex flex-wrap items-center gap-2">
                      <span>{d.label}</span>
                      {d.due && ["A_VENIR", "EN_COURS", "DEPASSEE"].includes(d.status) ? <DeadlineBadge due={d.due} overdue={d.status === "DEPASSEE" && d.kind === "OBLIGATION"} /> : <StatusBadge tone={d.status === "FAIT" ? "done" : "neutral"}>{STATUS[d.status]}</StatusBadge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {c.letters.map((l: any) => (
              <div key={l.id} className="rounded-md border border-border p-3 text-sm">
                <p className="mb-2 text-xs text-muted-foreground">Courrier validé le {frDate(l.approvedAt)}</p>
                <pre className="whitespace-pre-wrap font-sans">{l.text}</pre>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
              {c.documents.map((d: any) => (
                readOnly ? <span key={d.id} className="text-muted-foreground">{d.title}</span> : <Button key={d.id} size="sm" variant="ghost" onClick={() => act(async () => { const { url } = await fUrl({ data: { documentId: d.id } }); if (url) window.open(url, "_blank"); }, "Ouverture…")}>{d.title}</Button>
              ))}
              {!readOnly && <label className="cursor-pointer text-primary hover:underline">
                Envoyer une fiche de poste
                <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) upload(c.id, f);
                }} />
              </label>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
