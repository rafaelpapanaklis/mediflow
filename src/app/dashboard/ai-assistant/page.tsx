export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { AiAssistantClient } from "./ai-assistant-client";

export const metadata: Metadata = { title: "Asistente IA — DaleControl" };

/**
 * El asistente pasa a tener un envoltorio de SERVIDOR por una razón concreta:
 * `key={clinicId}`.
 *
 * El historial ya no vive en localStorage sino en la base, aislado por clínica
 * y por persona, así que al cambiar de sede la pantalla NO puede seguir
 * mostrando el estado de la anterior. El switcher del sidebar hace
 * `router.refresh()` (ver ClinicSwitcher en @/components/dashboard/sidebar), y
 * un refresh vuelve a renderizar el árbol de servidor pero NO reinicia el
 * estado de un componente cliente. La `key` sí: cambia el clinicId, React
 * desmonta y vuelve a montar, y el cliente arranca limpio y pide su historial.
 *
 * Es el mismo patrón que ya usan exercises, walk-in, inventory, packages,
 * orthotics, resource-bookings, analytics y el home del panel. No se inventa
 * nada aquí.
 */
export default async function AIAssistantPage() {
  const user = await getCurrentUser();
  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio: Rafael prueba «el diseño nuevo» como una sola cosa. Falla cerrado
  // (sin tabla, sin fila o con error → false = el asistente de hoy, tal cual).
  // Su respuesta vive 60 s en memoria por clínica, así que aquí cae en la
  // caché que el layout acaba de llenar: no es un viaje más a la base.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <AiAssistantClient key={user.clinicId} rediseno={rediseno} />;
}
