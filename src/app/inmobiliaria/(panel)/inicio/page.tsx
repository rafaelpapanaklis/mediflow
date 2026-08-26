export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/inicio — el tablero del día.
//
// 🔴 ES LA PANTALLA DE ATERRIZAJE Y EL DESTINO DE TODOS LOS REDIRECTS del
// panel: cada `redirect("/inmobiliaria/inicio")` de las demás pantallas
// termina aquí. Hasta ahora era el placeholder de la Ola 0, así que quien
// entraba —o quien rebotaba de una pantalla que su plan no incluye— veía un
// cartel de "en construcción". Eso ya no.
//
// SIN REJA PROPIA, y es a propósito: el item `inicio` de REALTY_NAV_ITEMS
// va con `permission: null`, `featureKey: null` y los tres modos. Si esta
// pantalla se cerrara por permiso, un rebote de otra pantalla se volvería
// un bucle de redirects. Lo que sí se recorta es CADA TARJETA, una por una,
// con el mismo AND de tres del sidebar (ver `puedeVer` en lib/realty/inicio.ts).
//
// i18n CONVENCIÓN A: se baja el diccionario COMPLETO y la vista antepone
// `realty.inicio.`. No se recorta el sub-árbol, así que el prefijo se
// aplica UNA sola vez (cruzar las dos convenciones es el bug de barber que
// documenta src/lib/realty/i18n.ts).
// ═══════════════════════════════════════════════════════════════════════

import "@/components/realty/inicio/inicio.css";
import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { getRealtyT } from "@/i18n/dictionaries/realty";
import { getRealtyInicio } from "@/lib/realty/inicio";
import { InicioView } from "@/components/realty/inicio/inicio-view";

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const t = getRealtyT(ctx.account.locale);
  const data = await getRealtyInicio(ctx);

  return (
    <InicioView
      data={data}
      t={t}
      locale={ctx.account.locale}
      timezone={ctx.account.timezone}
    />
  );
}
