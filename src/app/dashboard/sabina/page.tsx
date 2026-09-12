export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { SabinaClient } from "./sabina-client";

export const metadata: Metadata = { title: "Sabina — DaleControl" };

/**
 * `key={user.clinicId}` — mismo motivo que /dashboard/ai-assistant: el
 * historial vive en la base, aislado por clínica y por persona. Un
 * `router.refresh()` (el switcher de sede) no reinicia un componente cliente
 * por sí solo; la `key` sí — al cambiar el clinicId, React desmonta y vuelve
 * a montar, y Sabina arranca limpia en vez de arrastrar la conversación de
 * la sede anterior.
 */
export default async function SabinaPage() {
  const user = await getCurrentUser();
  return <SabinaClient key={user.clinicId} firstName={user.firstName} />;
}
