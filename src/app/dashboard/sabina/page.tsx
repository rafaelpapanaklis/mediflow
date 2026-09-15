export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { ACCIONES_SABINA } from "@/lib/sabina/engine-catalog";
import { leerAjustesSabina } from "@/lib/sabina/ajustes-sabina";
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
  // Si el Super Admin apagó a Sabina para este usuario, se dice al entrar y no
  // después de escribir. Esto solo AVISA: quien impide es POST /api/sabina (vía
  // `crearSabinaCtx`). Por eso un fallo al leer aquí no tumba la página: se
  // pinta normal y el endpoint decide.
  let apagada = false;
  try {
    apagada = (await leerAjustesSabina(user.clinicId, user.id))?.activa === false;
  } catch {
    apagada = false;
  }
  return (
    <SabinaClient
      key={user.clinicId}
      firstName={user.firstName}
      puedeProponer={ACCIONES_SABINA.length > 0}
      apagada={apagada}
    />
  );
}
