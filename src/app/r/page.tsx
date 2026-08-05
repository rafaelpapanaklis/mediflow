import { redirect } from "next/navigation";

// /r a secas (sin código) — pasa cuando un link se trunca al compartirse o
// alguien recorta la URL a mano. Mismo criterio que /r/<código> desconocido:
// al sitio, nunca a un 404. Sin cookie, porque no hay a quién atribuir.
export const dynamic = "force-dynamic";

export default function ShortLinkRootPage() {
  redirect("/");
}
