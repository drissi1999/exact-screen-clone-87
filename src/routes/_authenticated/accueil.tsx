import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { getMe } from "@/lib/cases.functions";

export const Route = createFileRoute("/_authenticated/accueil")({
  head: () => ({
    meta: [
      { title: "Accueil — Reprise" },
      { name: "description", content: "Redirection vers votre page d'accueil selon votre rôle." },
      { property: "og:title", content: "Accueil — Reprise" },
      { property: "og:description", content: "Redirection vers votre page d'accueil selon votre rôle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

/** Landing by role: IDEST and coordinators start on "Ma journée". */
function Landing() {
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  useEffect(() => {
    if (!me) return;
    const r = me.roles;
    const staff = r.some((x) => x !== "EMPLOYER_HR" && x !== "WORKER");
    if (!staff) navigate({ to: "/employeur", replace: true });
    else if (r.includes("IDEST") || r.includes("PDP_COORDINATOR")) navigate({ to: "/ma-journee", replace: true });
    else navigate({ to: "/tableau-de-bord", replace: true });
  }, [me, navigate]);
  return <p className="text-muted-foreground">Chargement…</p>;
}
