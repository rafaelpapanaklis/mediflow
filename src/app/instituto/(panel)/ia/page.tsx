export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { getEduIaPanel } from "@/lib/edu/ia-cupo";
import { eduContractNotice, formatEduContractDate } from "@/lib/edu/contract";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduIaScreen } from "@/components/edu/ia/ia-screen";

export const metadata: Metadata = {
  title: "Consumo de IA · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/ia — EN QUÉ SE ESTÁ YENDO EL CUPO DE IA, Y CUÁNTO QUEDA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PARA QUÉ EXISTE ESTA PANTALLA
 *
 * Para que nadie tenga que abrir un ticket. Las dos preguntas que la traen
 * aquí son "¿por qué se apagó el micrófono de mis alumnos?" y "¿en qué se
 * nos fue el cupo?", y las dos se contestan sin salir de ella: cuánto va
 * del mes, cuánto queda, quién lo está usando y en qué función.
 *
 * DOS CERRADURAS, como en todo el vertical:
 *   1. el PERMISO "ia.view" abre la pantalla (default: solo DIRECCION);
 *   2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide las
 *      filas, y para DOCENTE y ALUMNO es "none" pase lo que pase.
 *
 * Y una tercera cosa que NO es un permiso: lo que INCLUYE el contrato no
 * se edita desde aquí con ninguna key. Se pinta, con la fecha de su
 * contrato al lado, y para cambiarlo hay que hablar con DaleControl.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function InstitutoIaPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "ia.view")) {
    return (
      <EduDenied
        permission="ia.view"
        what="El consumo de IA del instituto: cuánto lleva gastado del cupo de este mes, quién lo está usando y en qué función."
      />
    );
  }

  // El alcance del DINERO. Se comprueba aquí además de en el endpoint
  // porque esconder una pantalla no cierra ninguna puerta, pero enseñar
  // una vacía sin explicar por qué tampoco sirve de nada.
  const scope = eduVisibility(ctx, "charges");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Consumo de IA</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
        </div>
      </div>
    );
  }

  const puedeEditar = hasEduPermission(permUser, "ia.manage");
  const panel = await getEduIaPanel(ctx, ctx.institution.timezone, { puedeEditar });

  // El cupo es un renglón del CONTRATO, así que la pantalla dice hasta
  // cuándo vale ese contrato. Sin esa fecha, "tu cupo es de 50 USD al mes"
  // no dice hasta cuándo.
  const aviso = eduContractNotice(ctx.institution);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Consumo de IA</h1>
          <p className="edu-page__lead">
            {puedeEditar
              ? "El cupo de IA que incluye el contrato del instituto, lo que lleva consumido este mes y quién lo está usando. Lo que incluye el contrato no se edita aquí; lo que sí decides es si se puede gastar de más y hasta cuánto."
              : "El cupo de IA que incluye el contrato del instituto, lo que lleva consumido este mes y quién lo está usando."}
          </p>
        </div>
      </header>

      {aviso && (
        <div className={`edu-banner ${aviso.level === "expired" ? "edu-banner--warn" : ""}`}>
          <div>
            <p className="edu-banner__title">{aviso.title}</p>
            <p className="edu-banner__detail">{aviso.detail}</p>
          </div>
        </div>
      )}

      <EduIaScreen
        panel={panel}
        contratoHasta={formatEduContractDate(ctx.institution.contractEndsAt)}
      />
    </div>
  );
}
