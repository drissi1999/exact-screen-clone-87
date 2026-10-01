/** Visit booking form and the case's visit list. */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, todayIso } from "@/components/kit";
import { bookVisitFn, listCaseVisitsFn, listPractitionersFn } from "@/lib/visits.functions";
import { AVIS_TYPE_LABELS, VISIT_KIND_LABELS } from "@/lib/message-templates";

const KIND_FOR_CODE: Record<string, string> = { RDV_LIAISON: "RDV_LIAISON", PRE_REPRISE: "PRE_REPRISE", VISITE_REPRISE: "VISITE_REPRISE" };
const field = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function BookVisitForm({ caseId, code, onDone, onCancel }: { caseId: string; code?: string; onDone: () => void; onCancel?: () => void }) {
  const fetchPeople = useServerFn(listPractitionersFn);
  const book = useServerFn(bookVisitFn);
  const { data: people } = useQuery({ queryKey: ["practitioners"], queryFn: () => fetchPeople() });
  const [kind, setKind] = useState(KIND_FOR_CODE[code ?? ""] ?? "VISITE_REPRISE");
  const [who, setWho] = useState("");
  const [day, setDay] = useState(todayIso());
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const practitioner = who || people?.[0]?.id || "";
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onClick={(e) => e.stopPropagation()}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!practitioner) { toast.error("Aucun médecin ou infirmier(e) dans l'équipe"); return; }
        setBusy(true);
        try {
          // Local Paris time -> ISO with the browser offset (the team works in Europe/Paris).
          await book({ data: { caseId, kind: kind as any, practitionerId: practitioner, scheduledAt: new Date(`${day}T${time}:00`).toISOString() } });
          toast.success("Visite planifiée");
          onDone();
        } catch (err) { toast.error(err instanceof Error ? err.message : "Erreur"); }
        finally { setBusy(false); }
      }}
    >
      <select aria-label="Type de visite" className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
        {Object.entries(VISIT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select aria-label="Praticien" className={field} value={practitioner} onChange={(e) => setWho(e.target.value)}>
        {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
      </select>
      <input aria-label="Date" type="date" required min={todayIso()} value={day} onChange={(e) => setDay(e.target.value)} className={field} />
      <input aria-label="Heure" type="time" required step={900} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
      <Button size="sm" type="submit" disabled={busy}>Réserver</Button>
      {onCancel && <Button size="sm" type="button" variant="ghost" onClick={onCancel}>Annuler</Button>}
    </form>
  );
}

const STATUS: Record<string, { label: string; tone: "info" | "done" | "neutral" }> = {
  PLANIFIEE: { label: "Planifiée", tone: "info" }, REALISEE: { label: "Réalisée", tone: "done" }, ANNULEE: { label: "Annulée", tone: "neutral" },
};

export function CaseVisits({ caseId, canBook, canPrepare, onChange }: { caseId: string; canBook: boolean; canPrepare: boolean; onChange: () => void }) {
  const fetchVisits = useServerFn(listCaseVisitsFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["visits", caseId], queryFn: () => fetchVisits({ data: { caseId } }) });
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Visites <span className="font-normal">· {data?.length ?? 0}</span></h2>
        {canBook && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><CalendarPlus className="mr-1 h-4 w-4" />Planifier une visite</Button>}
      </div>
      {open && (
        <div className="panel p-3">
          <BookVisitForm caseId={caseId} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["visits", caseId] }); onChange(); }} />
        </div>
      )}
      {(data ?? []).length > 0 && (
        <div className="panel divide-y divide-border">
          {data!.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{VISIT_KIND_LABELS[v.kind]}</p>
                <p className="text-xs text-muted-foreground">{new Date(v.scheduledAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })} · {v.practitioner}</p>
              </div>
              <StatusBadge tone={STATUS[v.status]?.tone ?? "neutral"}>{STATUS[v.status]?.label ?? v.status}{v.avisType ? ` · ${AVIS_TYPE_LABELS[v.avisType]}` : ""}</StatusBadge>
              {canPrepare && <Button asChild size="sm" variant={v.status === "PLANIFIEE" ? "default" : "outline"}><Link to="/visite/$visitId" params={{ visitId: v.id }}>{v.status === "PLANIFIEE" ? "Préparer la visite" : "Voir la visite"}</Link></Button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
