export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduCohorts, listEduPrograms } from "@/lib/edu/padron";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduEstructuraScreen } from "@/components/edu/padron/estructura-screen";

export const metadata: Metadata = {
  title: "Especialidades y generaciones · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/padron/estructura — especialidades y generaciones.
 *
 * EXIGE "padron.manage": es la pantalla donde se decide qué especialidades
 * existen y qué generaciones hay abiertas. Un docente entra al padrón, no
 * a esto.
 *
 * Está colgada de /padron/ y no en la raíz del menú porque es su
 * configuración, no otra área. El sidebar marca activo el item cuyo href
 * COINCIDE MÁS, así que estar aquí enciende "Especialidades y generaciones"
 * y no "Padrón".
 *
 * ⚠️ Ola 1B: la RUTA sigue siendo /estructura y el modelo sigue siendo
 * EduProgram — solo cambió lo que se LEE. La escuela les dice
 * "especialidades", no "programas"; renombrar la ruta rompería los enlaces
 * que ya tengan guardados y renombrar el modelo obligaría a migrar tablas.
 */
export default async function InstitutoEstructuraPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "padron.manage")) {
    return (
      <EduDenied
        permission="padron.manage"
        what="Aquí se crean las especialidades del instituto y las generaciones de cada una."
      />
    );
  }

  const [programas, generaciones] = await Promise.all([listEduPrograms(ctx), listEduCohorts(ctx)]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Especialidades y generaciones</h1>
          <p className="edu-page__lead">
            El esqueleto de la lista de estudiantes: primero la especialidad, luego la generación, y ya
            con eso se puede inscribir a alguien. Nada de aquí se borra — se activa y se desactiva.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/padron" className="edu-btn edu-btn--ghost edu-btn--sm">
            Ir a Estudiantes
          </Link>
        </div>
      </header>

      <EduEstructuraScreen programs={programas} cohorts={generaciones} />
    </div>
  );
}
