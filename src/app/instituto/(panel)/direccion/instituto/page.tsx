export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduInstitucion } from "@/lib/edu/institucion";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduInstitutoScreen } from "@/components/edu/direccion/instituto-screen";

export const metadata: Metadata = {
  title: "Datos del instituto · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/direccion/instituto — LOS DATOS DE LA PROPIA ESCUELA (H-150).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DOS PERMISOS DISTINTOS, Y ESO ES A PROPÓSITO
 *
 *   · abrir la pantalla → `inicio.view` (lo tienen los cuatro roles). El
 *     nombre y la zona horaria de la escuela los pinta el panel entero, y
 *     esconderlos detrás del permiso de ESCRIBIR habría obligado a cada
 *     pantalla a consultarlos por su cuenta;
 *   · corregirlos       → `sedes.manage` (solo DIRECCION por defecto), que
 *     es la misma llave con la que se administran las sedes: los datos del
 *     instituto son su cabecera.
 *
 * Son EXACTAMENTE los dos del endpoint (GET/PATCH de
 * /api/instituto/institucion). Si la pantalla exigiera uno distinto,
 * tendríamos dos respuestas a la misma pregunta.
 *
 * 🔴 Y NO ACEPTA NINGÚN id: se lee y se escribe el instituto de la SESIÓN.
 * Una ruta que aceptara cuál instituto editar sería el botón de renombrar
 * la escuela de otro.
 *
 * ⚠️ Es subruta de /direccion y no un item del menú por la regla de esta
 * ola: cero keys de permiso nuevas (una key nueva NO le llega a nadie con
 * `permissionsOverride` guardado, porque el override REEMPLAZA al default).
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function InstitutoDatosPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "inicio.view")) {
    return (
      <EduDenied
        permission="inicio.view"
        what="Los datos del propio instituto: cómo se llama, dónde está, cómo contactarlo y en qué zona horaria trabaja."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "sedes.manage");
  const institucion = await getEduInstitucion(ctx);

  // 🔴 EL CATÁLOGO DE ZONAS SE ARMA EN EL SERVIDOR, con el mismo `Intl` que
  // valida el PATCH. Hacerlo en el navegador daría una lista distinta según
  // el dispositivo —Safari estrenó `supportedValuesOf` en la 15.4— y una
  // zona que el teléfono no ofrece pero el servidor sí acepta es un campo
  // que no se puede corregir desde ese teléfono. Si el runtime tampoco la
  // trae, la pantalla cae a un campo de texto y la validación de verdad
  // sigue siendo la del servidor.
  const zonas =
    typeof (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf ===
    "function"
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
          "timeZone",
        )
      : [];

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Datos del instituto</h1>
          <p className="edu-page__lead">
            Cómo se llama tu escuela, dónde está, cómo contactarla y —lo que más pesa— en qué zona
            horaria trabaja. Hasta esta ola no había dónde corregirlos: un instituto de Tijuana dado
            de alta con la hora de CDMX no tenía arreglo.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/direccion" className="edu-btn edu-btn--ghost edu-btn--sm">
            Dirección
          </Link>
          <Link href="/instituto/sedes" className="edu-btn edu-btn--ghost edu-btn--sm">
            Sedes
          </Link>
        </div>
      </header>

      <EduInstitutoScreen institucion={institucion} canManage={canManage} zonas={zonas} />
    </div>
  );
}
