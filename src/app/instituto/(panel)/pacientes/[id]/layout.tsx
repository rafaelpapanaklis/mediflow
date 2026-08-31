export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { EDU_PATIENT_STATUS_LABELS } from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacienteTabs, type EduPacienteTab } from "@/components/edu/expediente/paciente-tabs";

export const metadata: Metadata = {
  title: "Paciente · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * Shell de la ficha de UN paciente: encabezado + pestañas.
 *
 * Por qué es un LAYOUT y no un encabezado repetido en cada página: Next
 * conserva el layout al navegar entre rutas hermanas, así que cambiar de
 * pestaña NO vuelve a consultar el paciente. Con el encabezado dentro de
 * cada página, cada clic haría una consulta más — cinco consultas para
 * mirar cinco pestañas del mismo paciente.
 *
 * 🔴 EL PACIENTE SE BUSCA DENTRO DEL ALCANCE (getEduPatient). El id de la
 * URL no basta: uno de otra escuela —o de otro alumno— da 404, igual que
 * uno que no existe. Un 403 confirmaría que ese folio existe.
 *
 * ⚠️ Este layout exige "pacientes.view" y NADA más. Cada pestaña vuelve a
 * exigir la suya (expediente.view, odontograma.view, estudios.view): la
 * lista de pestañas filtrada es una comodidad visual, no un candado.
 * Esconder una pestaña no cierra ninguna puerta — basta con teclear la URL.
 * Y por eso CAJA puede abrir esta ficha (recibe y cobra, necesita los
 * datos) y no ve ni una de las tres pestañas del expediente.
 */
export default async function InstitutoPacienteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "pacientes.view")) {
    return (
      <EduDenied
        permission="pacientes.view"
        what="La ficha de un paciente: sus datos, sus casos y su expediente clínico."
      />
    );
  }

  const paciente = await getEduPatient(ctx, params.id);
  if (!paciente) notFound();

  const base = `/instituto/pacientes/${paciente.id}`;
  // `permission` cierra la pestaña con UNA key; `permissionAny` la abre con
  // CUALQUIERA de varias. La segunda forma la estrenó la Ola 9 y hacía falta:
  // la pestaña de WhatsApp la usan dos personas distintas por dos motivos
  // distintos —el alumno manda la carta de consentimiento, caja manda el
  // recibo— y ninguna de las dos keys sirve para las dos. Con una sola habría
  // que elegir a quién dejar fuera.
  const definicion: {
    key: string;
    href: string;
    label: string;
    permission: EduPermissionKey | null;
    permissionAny?: EduPermissionKey[];
  }[] =
    [
      { key: "datos", href: base, label: "Datos", permission: null },
      { key: "casos", href: `${base}/casos`, label: "Casos", permission: "casos.view" },
      {
        key: "expediente",
        href: `${base}/expediente`,
        label: "Expediente",
        permission: "expediente.view",
      },
      {
        key: "odontograma",
        href: `${base}/odontograma`,
        label: "Odontograma",
        permission: "odontograma.view",
      },
      { key: "estudios", href: `${base}/estudios`, label: "Estudios", permission: "estudios.view" },
      {
        // Ola 3B. Va la ÚLTIMA y con permiso propio porque es la única
        // pestaña del expediente que CAJA sí puede abrir: la carta se
        // imprime y se entrega en el mostrador. Las tres de arriba siguen
        // cerradas para caja por partida doble (permiso + alcance).
        key: "consentimientos",
        href: `${base}/consentimientos`,
        label: "Consentimientos",
        permission: "consentimientos.view",
      },
      {
        // Ola 9. Va después de Consentimientos y con DOS permisos
        // alternativos, que es la forma nueva: aquí se le
        // manda al paciente su carta para firmar (consentimientos.view) o el
        // recibo de un cobro (caja.view), y son dos trabajos de dos personas
        // distintas. NO exige "whatsapp.view" —que solo tiene la dirección—
        // porque esa key es la de CONFIGURAR la conexión del instituto, no la
        // de mandarle un documento a un paciente.
        key: "whatsapp",
        href: `${base}/whatsapp`,
        label: "WhatsApp",
        permission: null,
        permissionAny: ["consentimientos.view", "caja.view"],
      },
      {
        // Ola 14. Documento clínico: CAJA no la ve (ni por permiso ni por
        // alcance — se lee con "cases", que para caja es "none"). Aquí el
        // alumno PROPONE la receta; quien la expide con su cédula es el
        // docente, desde su bandeja de autorizaciones.
        key: "recetas",
        href: `${base}/recetas`,
        label: "Recetas",
        permission: "recetas.view",
      },
    ];

  const tabs: EduPacienteTab[] = definicion
    .filter((t) => {
      if (t.permissionAny) return t.permissionAny.some((k) => hasEduPermission(permUser, k));
      return t.permission === null || hasEduPermission(permUser, t.permission);
    })
    .map(({ key, href, label }) => ({ key, href, label }));

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/pacientes" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Pacientes
        </Link>
      </p>

      <header className="edu-fichahead">
        <div>
          <span className="edu-fichahead__folio">Folio {paciente.folio}</span>
          <h1 className="edu-fichahead__name">{eduPatientFullName(paciente)}</h1>
          <p className="edu-fichahead__meta">
            {paciente.ageYears !== null ? `${paciente.ageYears} años` : "Sin fecha de nacimiento"} ·{" "}
            {EDU_PATIENT_STATUS_LABELS[paciente.status]}
            {paciente.openCases > 0
              ? ` · ${paciente.openCases} caso${paciente.openCases === 1 ? "" : "s"} abierto${
                  paciente.openCases === 1 ? "" : "s"
                }`
              : ""}
          </p>
        </div>
      </header>

      <EduPacienteTabs tabs={tabs} />

      {children}
    </div>
  );
}
