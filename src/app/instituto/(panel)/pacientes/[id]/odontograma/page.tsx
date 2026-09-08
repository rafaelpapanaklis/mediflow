export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduOdontogramHistory } from "@/lib/edu/odontograma";
import { listEduOdontoEventos } from "@/lib/edu/odontograma-eventos";
import {
  eduOdontogramDefaultDentition,
  eduOdontogramLiveEntries,
} from "@/lib/edu/odontograma-core";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduOdontogramaScreen } from "@/components/edu/expediente/odontograma-screen";

/**
 * /instituto/pacientes/[id]/odontograma
 *
 * EXIGE "odontograma.view" AQUÍ, no solo en la pestaña.
 *
 * 🔴 Y EL ALCANCE, que es otra cosa: el odontograma cuelga del PACIENTE en
 * la base (la boca es una sola) pero se lee con el alcance del recurso
 * "cases". Para CAJA eso es "none". Si se leyera con el de "patients" —el
 * que "parece" natural porque es de donde cuelga— caja vería el
 * odontograma de la escuela entera con solo encenderse un permiso.
 */
export default async function PacienteOdontogramaPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "odontograma.view")) {
    return (
      <EduDenied
        permission="odontograma.view"
        what="El odontograma del paciente: qué tiene cada diente y quién lo marcó."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay odontograma que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  // 🔴 UNA sola consulta para las dos cosas. El dibujo quiere lo VIVO y el
  // historial quiere también lo RETIRADO; pedirlos por separado serían dos
  // fotos tomadas en instantes distintos, y un hallazgo que alguien quita
  // entre una y otra saldría dibujado sin aparecer en el historial.
  // 🔴 N-3 · DOS LECTURAS Y NO UNA, y son dos preguntas distintas:
  //   · `listEduOdontogramHistory` → el ESTADO de cada hallazgo (una fila
  //     por llave). De ahí sale el DIBUJO y la lista de abajo, y es lo
  //     único que puede contestar por lo que se marcó antes de que
  //     existiera el libro de movimientos.
  //   · `listEduOdontoEventos`     → los MOVIMIENTOS (una fila por acto):
  //     quién marcó, quién quitó y CUÁNDO, aunque después se remarcara mil
  //     veces. Es lo que hace verdad los dos rótulos de la pantalla.
  // Van en paralelo: son dos tablas distintas y esperar una para pedir la
  // otra solo suma latencia.
  const [historial, movimientos] = await Promise.all([
    listEduOdontogramHistory(ctx, paciente.id, ctx.institution.timezone),
    listEduOdontoEventos(ctx, paciente.id, ctx.institution.timezone),
  ]);

  return (
    <EduOdontogramaScreen
      patientId={paciente.id}
      entries={eduOdontogramLiveEntries(historial.rows)}
      historial={historial.rows}
      historialTruncado={historial.truncated}
      movimientos={movimientos.rows}
      movimientosTruncados={movimientos.truncated}
      // Dentición inicial: un paciente con dentición temporal abre en los
      // cuadrantes 5-8 en vez de obligar a quien atiende a cambiarlo cada
      // vez. Se puede cambiar a mano — es el punto de partida, no un
      // candado. `isChild` lo captura la ficha; aquí solo se lee.
      denticionInicial={eduOdontogramDefaultDentition(paciente.isChild)}
      esInfantil={paciente.isChild}
      canEdit={hasEduPermission(permUser, "odontograma.edit")}
    />
  );
}
