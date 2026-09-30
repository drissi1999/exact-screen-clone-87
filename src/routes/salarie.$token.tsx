import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { exchangeWorkerLink, getWorkerDocUrl, getWorkerPortal, workerCompleteTask, workerUpload } from "@/lib/portal.functions";
import { fileToBase64, frDate } from "@/lib/file-to-base64";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/salarie/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mon espace salarié — Reprise" },
      { name: "description", content: "Suivez votre retour au travail et envoyez vos documents en toute confidentialité." },
      { property: "og:title", content: "Mon espace salarié — Reprise" },
      { property: "og:description", content: "Espace salarié sécurisé." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkerPortal,
});

type Portal = Awaited<ReturnType<typeof getWorkerPortal>>;
const KEY = "reprise-worker-session";

function WorkerPortal() {
  const { token } = Route.useParams();
  const fExchange = useServerFn(exchangeWorkerLink);
  const fPortal = useServerFn(getWorkerPortal);
  const fUpload = useServerFn(workerUpload);
  const fDone = useServerFn(workerCompleteTask);
  const fUrl = useServerFn(getWorkerDocUrl);
  const [session, setSession] = useState<string | null>(null);
  const [data, setData] = useState<Portal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (s: string) => {
    try {
      setData(await fPortal({ data: { sessionToken: s } }));
    } catch {
      sessionStorage.removeItem(KEY);
      setSession(null);
      setData(null);
      setErr("Votre session a expiré. Demandez un nouveau lien à votre service de santé au travail.");
    }
  }, [fPortal]);

  useEffect(() => {
    const saved = sessionStorage.getItem(KEY);
    if (saved) {
      const { t, s } = JSON.parse(saved);
      if (t === token) { setSession(s); load(s); return; }
    }
    fExchange({ data: { token } })
      .then(({ sessionToken }) => {
        sessionStorage.setItem(KEY, JSON.stringify({ t: token, s: sessionToken }));
        setSession(sessionToken);
        load(sessionToken);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Lien invalide"));
  }, [token, fExchange, load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    if (!session) return;
    setBusy(true);
    try { await fn(); toast.success(ok); await load(session); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md space-y-4 px-4 py-6">
      <p className="font-display text-lg font-semibold">Reprise</p>
      {err && <div className="panel p-5 text-sm text-destructive">{err}</div>}
      {!err && !data && <p className="text-sm text-muted-foreground">Ouverture de votre espace…</p>}
      {data && session && (
        <>
          <div className="panel space-y-1 p-5">
            <h1 className="font-display text-xl font-semibold">Bonjour {data.firstName}</h1>
            <p className="text-sm text-muted-foreground">Votre service de santé au travail vous accompagne pour votre retour chez {data.company}. Vos informations médicales ne sont jamais transmises à votre employeur.</p>
            <p className="text-xs text-muted-foreground">Session sécurisée jusqu'à {new Date(data.expiresAt).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}</p>
          </div>

          {data.tasks.filter((t: any) => t.status !== "DONE").length > 0 && (
            <div className="panel space-y-3 p-5">
              <h2 className="font-semibold">À faire</h2>
              {data.tasks.filter((t: any) => t.status !== "DONE").map((t: any) => (
                <div key={t.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                  <p>{t.message}</p>
                  <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => act(() => fDone({ data: { sessionToken: session, taskId: t.id } }), "C'est noté, merci")}>C'est fait</Button>
                </div>
              ))}
            </div>
          )}

          <div className="panel space-y-3 p-5">
            <h2 className="font-semibold">Envoyer un document</h2>
            <p className="text-sm text-muted-foreground">Arrêt de travail, certificat… Seule l'équipe médicale y a accès.</p>
            <label className="block">
              <span className="flex h-12 w-full cursor-pointer items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">{busy ? "Envoi…" : "Prendre une photo ou choisir un fichier"}</span>
              <input type="file" accept="image/*,.pdf" capture="environment" className="hidden" disabled={busy} onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) await act(async () => fUpload({ data: { sessionToken: session, filename: f.name, mimeType: f.type || "application/octet-stream", base64: await fileToBase64(f) } }), "Document envoyé");
              }} />
            </label>
            {data.sent.length > 0 && <ul className="text-xs text-muted-foreground">{data.sent.map((d: any) => <li key={d.id}>✓ {d.filename} — {frDate(d.createdAt)}</li>)}</ul>}
          </div>

          <div className="panel space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Mon arrêt</h2>
            {data.periods.map((p: any, i: number) => <p key={i} className="text-muted-foreground">Du {frDate(p.start)} au {p.end ? frDate(p.end) : "date non connue"}</p>)}
            {data.deadlines.map((d: any) => <p key={d.code}>• {d.label}{d.due ? ` — avant le ${frDate(d.due)}` : ""}</p>)}
          </div>

          {(data.messages.length > 0 || data.documents.length > 0) && (
            <div className="panel space-y-3 p-5 text-sm">
              <h2 className="font-semibold">Messages et documents</h2>
              {data.messages.map((m: any) => <pre key={m.id} className="whitespace-pre-wrap font-sans">{m.text}</pre>)}
              {data.documents.map((d: any) => (
                <Button key={d.id} variant="ghost" size="sm" onClick={() => act(async () => { const { url } = await fUrl({ data: { sessionToken: session, documentId: d.id } }); if (url) window.open(url, "_blank"); }, "Ouverture…")}>{d.filename}</Button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
