export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { eduDirFiltrosDeSearchParams } from "@/lib/edu/direccion-core";
import {
  eduDirContextFrom,
  getEduDireccionAhora,
  getEduDireccionPanel,
} from "@/lib/edu/direccion";
import { getEduCampusScope } from "@/lib/edu/campus";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduDireccionScreen } from "@/components/edu/direccion/direccion-screen";

export const metadata: Metadata = {
  title: "Dirección · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/direccion — EL TABLERO DE QUIEN DIRIGE LA ESCUELA.
 *
 * DOS CERRADURAS, como en todo el vertical, pero con una diferencia que
 * conviene entender antes de tocar nada:
 *
 *  1. el PERMISO "direccion.panel" abre la pantalla (solo lo trae DIRECCION);
 *  2. el ALCANCE (visibility.ts) NO recorta las filas aquí: las NIEGA. En
 *     las seis olas anteriores el mismo permiso servía para tres roles
 *     porque el alcance le daba a cada uno lo suyo. Este tablero no admite
 *     ese reparto: su contenido ES el total —"la clínica ahora", "cobrado
 *     del periodo", "ocupación promedio"—, y un total recortado presentado
 *     como el total es un dato falso. Así que si los cuatro recursos no
 *     devuelven alcance completo, `getEduDireccionPanel` lanza un 403 con el
 *     motivo y aquí se pinta.
 *
 * 🔴 Las dos cargas van en SECUENCIA y no en un Promise.all: cada una lanza
 * su propio grupo de consultas (cuatro la de "ahora", catorce la del
 * periodo) y encadenarlas dejaría el doble de conexiones abiertas a la vez
 * contra el mismo pool. El bloque en vivo es el barato y va primero, así
 * que lo que se ve primero es lo que está pasando.
 */
export default async function InstitutoDireccionPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "direccion.panel")) {
    return (
      <EduDenied
        permission="direccion.panel"
        what="El tablero de dirección: qué está pasando en la clínica ahora mismo, cuánto se cobró, cómo va cada especialidad y qué hay atorado."
      />
    );
  }

  const filtros = eduDirFiltrosDeSearchParams(searchParams);

  // 🔴 Ola 11 · LA SEDE ELEGIDA EN LA BARRA SUPERIOR. Este tablero lee
  // sillones, citas y cobros — o sea, TODO lo que cuelga de un edificio—,
  // así que sin esto sumaría los dos campus como si fueran uno y le daría
  // al director una ocupación que no es la de ninguna de sus dos sedes.
  //
  // Sin sedes dadas de alta el alcance es `null` y no recorta nada: la
  // pantalla se comporta igual que antes de la Ola 11.
  const sede = await getEduCampusScope(ctx);
  const dirCtx = eduDirContextFrom(ctx, sede);

  try {
    const ahora = await getEduDireccionAhora(dirCtx, filtros);
    const panel = await getEduDireccionPanel(dirCtx, filtros);

    return (
      <div className="edu-page edu-page--ancha">
        <header className="edu-pagehead">
          <div>
            <h1 className="edu-page__title">Dirección</h1>
            <p className="edu-page__lead">
              Cómo va {panel.sede ?? ctx.institution.name}. Todo lo que se pinta sale de una fila de la base:
              si algo no se puede saber, esta pantalla lo dice en vez de inventar un número.
              Cada cifra abre la lista que hay detrás.
            </p>
          </div>
        </header>

        <EduDireccionScreen ahora={ahora} panel={panel} />
      </div>
    );
  } catch (err) {
    // El 403 del alcance no es un fallo: es la respuesta correcta para una
    // cuenta que ve una parte de la clínica. Se pinta el motivo, con las
    // mismas palabras que devuelve el servidor, en vez de una pantalla en
    // blanco o un redirect que diría "esto no existe".
    if (err instanceof EduPadronError) {
      return (
        <div className="edu-page">
          <header>
            <h1 className="edu-page__title">Dirección</h1>
          </header>
          <div className="edu-banner edu-banner--warn" role="alert">
            <div>
              <p className="edu-banner__title">Este tablero no se puede pintar para tu cuenta</p>
              <p className="edu-banner__detail">{err.message}</p>
            </div>
          </div>
        </div>
      );
    }
    throw err;
  }
}
