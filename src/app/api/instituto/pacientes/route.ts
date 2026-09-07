import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { parseEduPatientFilters } from "@/lib/edu/pacientes-core";
import {
  createEduPatient,
  EduPatientDuplicateError,
  listEduPatientOptions,
  listEduPatients,
} from "@/lib/edu/pacientes";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes — los pacientes que le tocan a quien pregunta.
 *
 * 🔴 El institutionId sale de la sesión, NUNCA de la query. Lo único que se
 * lee de la URL son los filtros (?estado=&origen=&q=), la página
 * (?cursor=&take=) y el modo (?opciones=1), y `parseEduPatientFilters`
 * descarta cualquier otra cosa que venga ahí.
 *
 * El recorte (alumno → los suyos; docente → los de sus alumnos VIGENTES;
 * caja y dirección → todos) lo aplica `listEduPatients` por dentro con el
 * helper de visibilidad: este endpoint no puede pedir "todos" ni aunque
 * quisiera, porque el alcance no es un parámetro.
 *
 * ── DOS COSAS QUE AÑADIÓ LA OLA B ──────────────────────────────────────
 *
 * 1. **`?cursor=`** — la página siguiente (H-06). La lista dejó de cortarse
 *    en 300 sin salida: baja de 50 en 50 y `nextCursor` dice por dónde
 *    seguir. Es lo que alimenta el «Ver más» de la pantalla, que APILA la
 *    página nueva sobre las que ya tiene en vez de recargar la ruta.
 *
 * 2. **`?opciones=1&q=`** — el desplegable de agendar, buscando en el
 *    SERVIDOR. Devuelve lo MÍNIMO (id, folio, nombre, estado) y no la ficha
 *    entera: un `<select>` no necesita el domicilio ni los antecedentes de
 *    nadie, y mandárselos sería volver a la lección del P1-4. Su tope y su
 *    `truncated` son los del desplegable, no los de la lista.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    if (params.opciones === "1") {
      const opciones = await listEduPatientOptions(g.ctx, new Date(), {
        q: params.q,
        take: Number(params.take) || undefined,
      });
      return NextResponse.json(opciones);
    }

    const page = await listEduPatients(g.ctx, parseEduPatientFilters(params), new Date(), {
      cursor: params.cursor,
      take: Number(params.take) || undefined,
    });
    return NextResponse.json({
      rows: page.rows,
      truncated: page.truncated,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes");
  }
}

/**
 * POST /api/instituto/pacientes — registra a un paciente.
 *
 * 🔴 El ORIGEN (cuál alumno lo trajo) solo se guarda si quien registra
 * tiene "pacientes.origen". Que el campo venga en el body no basta: ese
 * dato decide el precio en la Ola 5, así que se ignora en silencio para
 * quien no puede ponerlo — y queda registrado quién lo puso.
 *
 * 🔴 EL AVISO DE DUPLICADO (H-05). Si ya hay un paciente con el mismo
 * teléfono, o con el mismo nombre + apellidos + nacimiento, el alta se
 * DETIENE y contesta a quién se parece, con folio. No es un bloqueo: quien
 * mira la lista y ve que es otra persona vuelve a mandar con
 * `allowDuplicate: true` y se registra igual. La comprobación vive DENTRO
 * de `createEduPatient`, pegada a la escritura — hacerla desde la pantalla
 * antes de enviar dejaría entre las dos los cinco segundos en los que la
 * otra recepcionista lo registra.
 *
 * 🔴 Y SE CONTESTA 200 CON `duplicados`, NO un 409. No es cosmética: un
 * error solo le llega a la pantalla como TEXTO (`eduRequest` lanza un Error
 * con el mensaje del servidor y tira el resto del cuerpo), así que
 * distinguir "puede que ya exista" de un fallo de verdad obligaría a la
 * pantalla a reconocer el aviso leyendo la frase en español — y el día que
 * alguien reescriba el mensaje, el flujo ámbar de "¿es la misma persona?"
 * se convertiría en un error rojo duro sin que nada falle. Con un 200 y un
 * campo, la pantalla pregunta por el campo. Aquí no se creó a nadie: por
 * eso `ok: false`.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("pacientes.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const canSetOrigin = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "pacientes.origen",
    );
    const created = await createEduPatient(g.ctx, body, {
      canSetOrigin,
      allowDuplicate: body.allowDuplicate === true,
    });
    // 🔴 N-8 · el AVISO viaja con el 201, en su propio campo. Sin fecha de
    // nacimiento no se puede afirmar que el paciente sea menor, así que el
    // alta NO se bloquea — pero quien registra tiene que enterarse de que
    // la ficha quedó sin la pareja de datos con la que se firma un
    // consentimiento. Es el mismo patrón que el aviso de duplicado: campo
    // propio, nunca una frase que la pantalla tenga que reconocer leyéndola.
    return NextResponse.json(
      { ok: true, id: created.id, folio: created.folio, aviso: created.aviso },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof EduPatientDuplicateError) {
      return NextResponse.json({
        ok: false,
        duplicados: err.duplicates,
        aviso: err.message,
      });
    }
    return eduApiError(err, "POST /api/instituto/pacientes");
  }
}
