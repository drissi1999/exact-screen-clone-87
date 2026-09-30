import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  createApiKey,
  listApiKeys,
  listImportProfiles,
  listImportRuns,
  runImport,
  saveImportProfile,
  suggestMapping,
  validateImport,
} from "@/lib/imports.functions";
import { FIELDS, sha256, type FieldKey } from "@/lib/import-core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/parametres/imports")({
  head: () => ({
    meta: [
      { title: "Imports — Reprise" },
      {
        name: "description",
        content: "Importez vos fichiers d'absences, contrôlez le mappage des colonnes et suivez l'historique.",
      },
      { property: "og:title", content: "Imports — Reprise" },
      { property: "og:description", content: "Import de fichiers d'absences et historique des exécutions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportsPage,
});

type Row = Record<string, unknown>;
type Mapping = Record<string, FieldKey | null>;
type InvalidRow = { rowNumber: number; errors: string[]; raw: Row };

function ImportsPage() {
  const queryClient = useQueryClient();
  const suggest = useServerFn(suggestMapping);
  const validate = useServerFn(validateImport);
  const commit = useServerFn(runImport);
  const saveProfile = useServerFn(saveImportProfile);
  const fetchRuns = useServerFn(listImportRuns);
  const fetchProfiles = useServerFn(listImportProfiles);
  const fetchKeys = useServerFn(listApiKeys);
  const newKey = useServerFn(createApiKey);

  const [step, setStep] = useState(1);
  const [filename, setFilename] = useState("");
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [profileName, setProfileName] = useState("");
  const [invalid, setInvalid] = useState<InvalidRow[]>([]);
  const [validCount, setValidCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const runs = useQuery({ queryKey: ["import-runs"], queryFn: () => fetchRuns() });
  const profiles = useQuery({ queryKey: ["import-profiles"], queryFn: () => fetchProfiles() });
  const apiKeys = useQuery({ queryKey: ["api-keys"], queryFn: () => fetchKeys() });

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      setFileHash(await sha256(Array.from(new Uint8Array(buffer.slice(0, 200000))).join(",")));
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
      const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: true });
      if (!parsed.length) throw new Error("Le fichier ne contient aucune ligne.");
      const cols = Object.keys(parsed[0]!);
      setFilename(file.name);
      setHeaders(cols);
      setRows(parsed);
      setProfileName(file.name.replace(/\.[^.]+$/, ""));

      const result = await suggest({ data: { headers: cols, sampleRows: parsed.slice(0, 5) } });
      const next: Mapping = {};
      for (const suggestion of result.suggestions) next[suggestion.header] = suggestion.field;
      setMapping(next);
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture du fichier impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    setBusy(true);
    try {
      const result = await validate({ data: { rows, mapping } });
      setValidCount(result.valid);
      setInvalid(result.invalid);
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contrôle impossible");
    } finally {
      setBusy(false);
    }
  }

  const importMutation = useMutation({
    mutationFn: () => commit({ data: { filename, fileHash, rows, mapping } }),
    onSuccess: (result) => {
      toast.success(
        `${result.rowsImported} arrêt(s) importé(s), ${result.casesCreated} dossier(s) ouvert(s), ${result.rowsSkipped} doublon(s) ignoré(s).`,
      );
      queryClient.invalidateQueries();
      setStep(1);
      setRows([]);
      setHeaders([]);
      setInvalid([]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Import impossible"),
  });

  function fixValue(rowNumber: number, header: string, value: string) {
    setRows((current) =>
      current.map((row, index) => (index + 2 === rowNumber ? { ...row, [header]: value } : row)),
    );
    setInvalid((current) =>
      current.map((row) => (row.rowNumber === rowNumber ? { ...row, raw: { ...row.raw, [header]: value } } : row)),
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Imports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chargez un export SPSTI ou un fichier d'absences RH (CSV ou Excel). Les colonnes sont reconnues
          automatiquement, vous validez avant l'import.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm">
        {["1. Fichier", "2. Colonnes", "3. Contrôle"].map((label, index) => (
          <li
            key={label}
            className={cn(
              "rounded-md border border-border px-3 py-1.5",
              step === index + 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="panel space-y-4 p-6">
          <Label htmlFor="file">Fichier CSV ou XLSX</Label>
          <Input
            id="file"
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <p className="text-sm text-muted-foreground">
            Besoin d'un exemple ?{" "}
            <a className="underline underline-offset-4" href="/samples/absences_demo.csv" download>
              absences_demo.csv
            </a>{" "}
            contient des en-têtes approximatifs et quelques lignes erronées.
          </p>
          {profiles.data && profiles.data.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Profils enregistrés : {profiles.data.map((p: any) => p.name).join(", ")}
            </p>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="panel space-y-5 p-6">
          <h2 className="text-lg font-semibold">Associer les colonnes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Colonne du fichier</th>
                  <th className="py-2 font-medium">Exemple</th>
                  <th className="py-2 font-medium">Champ Reprise</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{header}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{String(rows[0]?.[header] ?? "")}</td>
                    <td className="py-2">
                      <select
                        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm"
                        value={mapping[header] ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [header]: (e.target.value || null) as FieldKey | null })
                        }
                      >
                        <option value="">Ignorer cette colonne</option>
                        {FIELDS.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.labelFr}
                            {field.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="profile">Enregistrer ce mappage sous</Label>
              <Input
                id="profile"
                value={profileName}
                maxLength={120}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-72"
              />
            </div>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await saveProfile({ data: { name: profileName, mapping } });
                  toast.success("Profil d'import enregistré.");
                  queryClient.invalidateQueries({ queryKey: ["import-profiles"] });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
                }
              }}
            >
              Enregistrer le profil
            </Button>
            <Button onClick={handleValidate} disabled={busy}>
              Contrôler les lignes
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="panel space-y-5 p-6">
          <h2 className="text-lg font-semibold">Contrôle des lignes</h2>
          <p className="text-sm">
            <Badge className="mr-2">{validCount} ligne(s) valide(s)</Badge>
            <Badge variant="destructive">{invalid.length} ligne(s) en erreur</Badge>
          </p>

          {invalid.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Ligne</th>
                    <th className="py-2 font-medium">Erreurs</th>
                    <th className="py-2 font-medium">Correction</th>
                  </tr>
                </thead>
                <tbody>
                  {invalid.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-border align-top">
                      <td className="py-2 pr-4">{row.rowNumber}</td>
                      <td className="py-2 pr-4 text-destructive">{row.errors.join(" · ")}</td>
                      <td className="space-y-2 py-2">
                        {headers
                          .filter((header) => mapping[header])
                          .map((header) => (
                            <div key={header} className="flex items-center gap-2">
                              <span className="w-40 shrink-0 text-xs text-muted-foreground">{header}</span>
                              <Input
                                className="h-8 w-56"
                                defaultValue={String(row.raw[header] ?? "")}
                                onBlur={(e) => fixValue(row.rowNumber, header, e.target.value)}
                              />
                            </div>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={handleValidate} disabled={busy}>
              Recontrôler après correction
            </Button>
            <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending || validCount === 0}>
              {importMutation.isPending ? "Import en cours…" : `Importer ${validCount} ligne(s) valide(s)`}
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Revenir aux colonnes
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Historique des imports</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Fichier</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Importées</th>
                <th className="px-4 py-3 font-medium">Doublons</th>
                <th className="px-4 py-3 font-medium">Erreurs</th>
                <th className="px-4 py-3 font-medium">Dossiers</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-muted-foreground">
                    Aucun import pour le moment.
                  </td>
                </tr>
              )}
              {runs.data?.map((run: any) => (
                <tr key={run.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{run.filename}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.source === "API" ? "API" : "Fichier"}</td>
                  <td className="px-4 py-3">{run.rows_imported}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.rows_skipped}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.rows_failed}</td>
                  <td className="px-4 py-3">{run.cases_created}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(run.created_at).toLocaleString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel space-y-4 p-6">
        <h2 className="text-lg font-semibold">Clés d'API (ingestion automatique)</h2>
        <p className="text-sm text-muted-foreground">
          Pour brancher un logiciel SPSTI ou un outil de paie : <code>POST /api/public/ingest/stoppages</code> avec
          l'en-tête <code>x-api-key</code>.
        </p>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const result = await newKey({ data: { label: `Clé ${new Date().toLocaleDateString("fr-FR")}` } });
              toast.success("Clé créée. Copiez-la maintenant, elle ne sera plus affichée.", {
                description: result.key,
                duration: 30000,
              });
              queryClient.invalidateQueries({ queryKey: ["api-keys"] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Création impossible");
            }
          }}
        >
          Créer une clé d'API
        </Button>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {apiKeys.data?.map((key: any) => (
            <li key={key.id}>
              {key.label} — {key.key_prefix}… {key.revoked ? "(révoquée)" : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
