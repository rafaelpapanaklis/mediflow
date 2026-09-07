export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BadgeCheck, ClipboardList, Mail, Phone, Users } from "lucide-react";
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

  // Iniciales para el recuadro, mismo cálculo que las otras dos fichas.
  const iniciales =
    docente.name
      .split(/\s+/)
      .filter(Boolean)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || docente.name.charAt(0).toUpperCase();

  // 🔴 `casosAbiertos` es `number | null` y null NO es cero: null significa
  // que a quien mira no le toca el recurso clínico (caja). Un 0 ahí mentiría
  // sobre la carga de este docente.
  const casos = docente.casosAbiertos;

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

      {/* ── LA CABECERA DE LA FICHA ────────────────────────────────────
          La misma que la del paciente y la del estudiante
          (`.edu-fichahero`, Ola B). Antes era `.edu-fichahead`: correo,
          teléfono y cédula unidos por `.join(" · ")` en una línea gris de
          13 px, con el correo —que es a lo que se entra— pesando lo mismo
          que el resto y sin poder tocarse para escribir.

          Apilado por defecto y en fila con `@container`: la fila se
          estrena cuando la CABECERA se ha medido a sí misma, no cuando la
          ventana pasa un número. */}
      <header className="edu-fichahero">
        <div className="edu-fichahero__main">
          <span className="edu-fichahero__avatar" aria-hidden="true">
            {iniciales}
          </span>

          <div className="edu-fichahero__info">
            <span className="edu-fichahero__folio">Docente</span>
            <h1 className="edu-fichahero__name">{docente.name}</h1>
            {!docente.isActive && (
              <span className="edu-fichahero__estado">
                <span className="edu-tag edu-tag--danger">Cuenta desactivada</span>
              </span>
            )}
          </div>

          <div className="edu-fichahero__datos">
            {/* `mailto:` y `tel:`: son los dos datos a los que se entra, y
                un toque escribe o marca en vez de obligar a copiar. */}
            <a className="edu-fichadato" href={`mailto:${docente.email}`}>
              <Mail size={13} strokeWidth={1.9} aria-hidden />
              {docente.email}
            </a>

            {docente.phone && (
              <a className="edu-fichadato" href={`tel:${docente.phone.replace(/[^+\d]/g, "")}`}>
                <Phone size={13} strokeWidth={1.9} aria-hidden />
                {docente.phone}
              </a>
            )}

            {/* La cédula se LEE, no se navega: es lo que firma una receta. */}
            {docente.cedulaProfesional && (
              <span className="edu-fichadato">
                <BadgeCheck size={13} strokeWidth={1.9} aria-hidden />
                Cédula {docente.cedulaProfesional}
              </span>
            )}

            <span className="edu-fichadato">
              <Users size={13} strokeWidth={1.9} aria-hidden />
              {`${docente.estudiantesVigentes} alumno${
                docente.estudiantesVigentes === 1 ? "" : "s"
              } a cargo`}
            </span>

            {casos !== null && (
              <span className="edu-fichadato">
                <ClipboardList size={13} strokeWidth={1.9} aria-hidden />
                {`${casos} caso${casos === 1 ? "" : "s"} que supervisa`}
              </span>
            )}
          </div>
        </div>
      </header>

      <EduPacienteTabs tabs={tabs} ariaLabel="Secciones del docente" />

      {children}
    </div>
  );
}
