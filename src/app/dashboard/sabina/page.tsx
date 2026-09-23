export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { ACCIONES_SABINA } from "@/lib/sabina/engine-catalog";
import { leerAjustesSabina } from "@/lib/sabina/ajustes-sabina";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { SabinaClient } from "./sabina-client";
import { SaldoIaImporte } from "./saldo-ia-importe";

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
  //
  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio: Rafael prueba «el diseño nuevo» como una sola cosa. Falla cerrado
  // (sin tabla, sin fila o con error → false = la Sabina de hoy, tal cual). Va
  // en el mismo Promise.all que los ajustes para no añadir un viaje en fila; la
  // respuesta además vive 60 s en memoria por clínica, así que aquí cae en la
  // caché que el layout acaba de llenar.
  const [apagada, rediseno] = await Promise.all([
    leerAjustesSabina(user.clinicId, user.id)
      .then((ajustes) => ajustes?.activa === false)
      .catch(() => false),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  // SALDO IA (ws1-t5): el acceso al monedero que Sabina gasta. Lo ve quien
  // puede abrir esa pantalla —el MISMO permiso que ella exige
  // (`requirePermissionOrRedirect(user, "whatsapp.view")`)—, para no enseñar
  // un chip que rebote. El importe NO entra en el Promise.all de arriba: va en
  // un Suspense y llega por streaming cuando la base contesta, así que ni la
  // página ni la conversación esperan por él.
  const puedeVerSaldo = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
    "whatsapp.view",
  );
  return (
    <SabinaClient
      key={user.clinicId}
      clinicId={user.clinicId}
      firstName={user.firstName}
      puedeProponer={ACCIONES_SABINA.length > 0}
      apagada={apagada}
      rediseno={rediseno}
      puedeVerSaldo={puedeVerSaldo}
      saldoIa={
        puedeVerSaldo ? (
          <Suspense fallback={null}>
            <SaldoIaImporte clinicId={user.clinicId} />
          </Suspense>
        ) : null
      }
    />
  );
}
