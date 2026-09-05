export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import { getEduDocenteFicha } from "@/lib/edu/docente";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacienteTabs, type EduPacienteTab } from "@/components/edu/expediente/paciente-tabs";

export const metadata: Metadata = {
  title: "Docente · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * Shell de la ficha de UN docente: encabezado + pestañas.
 *
 * LAYOUT y no encabezado repetido, por lo mismo que las otras dos fichas:
 * cambiar de pestaña no vuelve a consultar a la persona.
 *
 * 🔴 `getEduDocenteFicha` exige `role: "DOCENTE"` EN EL WHERE. Con el id de
 * un alumno —o el de la dirección— esta ruta da 404, no una "ficha de
 * docente" con cero estudiantes y cero casos. Una pantalla que miente es
 * peor que una que no está.
 *
 * ⚠️ Este layout exige "docentes.view" y nada más; cada pestaña vuelve a
 * exigir la suya. Esconder una pestaña no cierra ninguna puerta.
 *
 * A diferencia de la ficha del estudiante, aquí NO hay un alcance de "de
 * quién puedo abrir la ficha": la lista de docentes ya es visible entera
 * para quien tiene el permiso, y una ficha que solo repite lo que la lista
 * enseña no necesita una segunda puerta. Lo que sí se recorta —y por
 * separado— es lo clínico de dentro.
 */
export default async function InstitutoDocenteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "docentes.view")) {
    return (
      <EduDenied
        permission="docentes.view"
        what="La ficha de un docente: sus estudiantes vigentes, los casos que supervisa y su agenda."
      />
    );
  }

  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone);
  if (!docente) notFound();

  const base = `/instituto/docentes/${docente.id}`;

  const definicion: {
    key: string;
    href: string;
    label: string;
    permission: EduPermissionKey | null;
  }[] = [
    { key: "resumen", href: base, label: "Resumen", permission: null },
    {
      key: "estudiantes",
      href: `${base}/estudiantes`,
      label: "Estudiantes",
      permission: "padron.view",
    },
    { key: "casos", href: `${base}/casos`, label: "Casos", permission: "casos.view" },
    { key: "agenda", href: `${base}/agenda`, label: "Agenda", permission: "agenda.view" },
  ];

  const tabs: EduPacienteTab[] = definicion
    .filter((t) => t.permission === null || hasEduPermission(permUser, t.permission))
    .map(({ key, href, label }) => ({ key, href, label }));

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/docentes" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Docentes
        </Link>
      </p>

      <header className="edu-fichahead">
        <div>
          <span className="edu-fichahead__folio">Docente</span>
          <h1 className="edu-fichahead__name">{docente.name}</h1>
          <p className="edu-fichahead__meta">
            {[
              docente.email,
              docente.phone,
              // La cédula se LEE, no se navega: es lo que firma una receta.
              docente.cedulaProfesional ? `Cédula ${docente.cedulaProfesional}` : null,
              !docente.isActive ? "Cuenta desactivada" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      <EduPacienteTabs tabs={tabs} ariaLabel="Secciones del docente" />

      {children}
    </div>
  );
}
