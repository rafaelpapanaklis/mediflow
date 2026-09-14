/**
 * La FASE 2 del alta: el usuario tocó una opción de la propuesta y ahora sí se
 * ejecuta. Es lo único de Sabina que da de alta a un paciente.
 *
 * ── A QUIÉN LE TOCA LLAMAR ESTO ────────────────────────────────────────
 * Al mecanismo de confirmación (ws1-t1), nunca al bucle del modelo. Recibe:
 *  · `propuesta` — la que devolvió `registrar_paciente`, tal como la GUARDÓ el
 *    servidor. No la que mande el navegador.
 *  · `opcionId` — el botón que tocó el usuario.
 *  · `llamar` — cómo llegar a POST /api/patients. En producción,
 *    `llamarAltaEnProceso(req)` de ./registrar-paciente-http.
 *
 * ── LO QUE GARANTIZA ───────────────────────────────────────────────────
 *  1. No escribe en Prisma: el alta la hace POST /api/patients, así que se
 *     heredan su validación (400 claro), su cupo del plan (402), su guarda de
 *     duplicados (409), su folio, su auditoría y el enlace de WhatsApp.
 *  2. Solo ejecuta una opción que la propuesta OFRECIÓ, y solo con un paciente
 *     que la propuesta ENSEÑÓ.
 *  3. El cuerpo que viaja es la lista blanca de la propuesta; `allowDuplicate`
 *     lo añade SOLO esta función, SOLO con «es otra persona» y SOLO si la
 *     propuesta enseñó un duplicado. Y no a ciegas: antes vuelve a buscar, y si
 *     el conjunto de duplicados cambió desde la tarjeta (la `huella`: incluye
 *     los que no caben y los que el usuario no puede ver), pregunta otra vez.
 *  3b. Solo confirma quien la pidió, en la sede donde la pidió (`emitidaPara`).
 *  4. Un 409 de duplicado no es un error: vuelve como `duplicado`, con una
 *     propuesta nueva que trae los tres caminos. Nunca reintenta por su cuenta.
 *  5. Nunca repite el texto de un 500: puede ser el mensaje interno de Prisma.
 */

import { buildPatientWhere } from "@/lib/auth-context";
import { comoAuthContext, dbDe, exigirSesion, tienePermiso } from "./base";
import {
  armarPropuesta,
  buscarDuplicados,
  telefonoFinal,
  type CuerpoAlta,
  type Duplicados,
  type PropuestaAlta,
} from "./registrar-paciente";
import type { SabinaCtx } from "../tipos";

/** Lo que contestó POST /api/patients: el status y el JSON (o `null`). */
export interface RespuestaAlta {
  status: number;
  cuerpo: unknown;
}

export type LlamarAlta = (cuerpo: Record<string, unknown>) => Promise<RespuestaAlta>;

export interface PacienteResuelto {
  pacienteId: string;
  folio: string | null;
  nombre: string;
}

/**
 * El resultado, con `estado` como discriminante de texto (con `strict: false`
 * TypeScript no estrecha por un booleano). `frase` es lo que se le dice al
 * usuario; `http`, lo que contestó el servidor, para el rastro.
 */
export type ResultadoAlta =
  | { estado: "creado"; paciente: PacienteResuelto; frase: string; http: number }
  | { estado: "usar_existente"; paciente: PacienteResuelto; frase: string }
  | { estado: "duplicado"; propuesta: PropuestaAlta; frase: string; http?: number }
  | { estado: "requiere_revision"; frase: string }
  | { estado: "no_encontrado"; frase: string }
  | { estado: "cancelado"; frase: string }
  | { estado: "sin_permiso"; permiso: string; frase: string; http?: number }
  | { estado: "tope_plan"; limite: number | null; esAdmin: boolean; frase: string; http: number }
  | { estado: "datos_invalidos"; campo: string | null; frase: string; http: number }
  | { estado: "sesion_cerrada"; frase: string; http: number }
  | { estado: "error"; detalle: string; frase: string; http?: number };

export async function confirmarRegistroPaciente(args: {
  ctx: SabinaCtx;
  propuesta: PropuestaAlta;
  opcionId: string;
  llamar: LlamarAlta;
}): Promise<ResultadoAlta> {
  try {
    return await confirmar(args);
  } catch (e) {
    // Nunca una excepción hacia arriba, y nunca su texto: puede ser de Prisma.
    console.error("[sabina/registrar_paciente] la confirmación falló:", e);
    return {
      estado: "error",
      detalle: "confirmacion_fallida",
      frase: "No pude completar la confirmación por un error del sistema. Antes de reintentar, busca al paciente por si llegó a quedar registrado.",
    };
  }
}

async function confirmar(args: {
  ctx: SabinaCtx;
  propuesta: PropuestaAlta;
  opcionId: string;
  llamar: LlamarAlta;
}): Promise<ResultadoAlta> {
  const { ctx, propuesta, opcionId, llamar } = args;
  try {
    exigirSesion(ctx);
  } catch {
    return { estado: "error", detalle: "sesion_invalida", frase: "No pude confirmar: la sesión no está completa. No se creó nada." };
  }

  if (
    !propuesta?.emitidaPara ||
    propuesta.emitidaPara.clinicId !== ctx.clinicId ||
    propuesta.emitidaPara.userId !== ctx.userId
  ) {
    return {
      estado: "error",
      detalle: "propuesta_de_otra_sesion",
      frase: "Esa propuesta se preparó para otra sesión o para otra sede. No se creó nada; pídemelo de nuevo.",
    };
  }

  const opcion =
    propuesta && propuesta.accion === "registrar_paciente" && Array.isArray(propuesta.opciones)
      ? propuesta.opciones.find((o) => o.id === opcionId)
      : undefined;
  if (!opcion) {
    return { estado: "error", detalle: "opcion_invalida", frase: "Esa opción no estaba en la propuesta. No se creó nada." };
  }

  if (opcion.tipo === "cancelar") {
    return { estado: "cancelado", frase: "Cancelado. No se dio de alta a nadie." };
  }

  if (opcion.tipo === "usar_existente") return usarExistente(ctx, propuesta, opcion.pacienteId ?? null);

  // crear / crear_a_sabiendas
  if (!tienePermiso(ctx, "patients.create")) return sinPermiso();

  const cuerpo = cuerpoPermitido(propuesta.cuerpo);
  const vistos = propuesta.duplicados;
  const visiblesVistos = Array.isArray(vistos?.visibles) ? vistos.visibles : [];
  const enseñoDuplicado = visiblesVistos.length > 0 || (vistos?.masVisibles ?? 0) > 0 || vistos?.hayOcultos === true;
  let permitirDuplicado = false;

  if (opcion.tipo === "crear_a_sabiendas" && enseñoDuplicado) {
    let ahora: Duplicados;
    try {
      ahora = await buscarDuplicados(ctx, cuerpo);
    } catch (e) {
      console.error("[sabina/registrar_paciente] no pude volver a buscar duplicados:", e);
      return { estado: "error", detalle: "busqueda_fallida", frase: "No pude volver a comprobar si ya existe. No se creó nada; inténtalo otra vez." };
    }
    // Con huella, cualquier cambio del conjunto vuelve a preguntar. Sin ella (la
    // propuesta vino de un 409 que no se pudo reconstruir), lo que se puede
    // comparar: fichas nuevas o un oculto que antes no estaba.
    const cambio = vistos?.huella
      ? ahora.huella !== vistos.huella
      : ahora.visibles.some((v) => !visiblesVistos.some((x) => x.pacienteId === v.pacienteId)) ||
        (ahora.hayOcultos && vistos?.hayOcultos !== true);
    if (cambio) {
      const otra = armarPropuesta(ctx, cuerpo, ahora);
      return { estado: "duplicado", propuesta: otra, frase: `Desde que te lo enseñé cambió lo que hay registrado. ${otra.pregunta}` };
    }
    permitirDuplicado = true;
  }

  let respuesta: RespuestaAlta;
  try {
    respuesta = await llamar(permitirDuplicado ? { ...cuerpo, allowDuplicate: true } : { ...cuerpo });
  } catch (e) {
    console.error("[sabina/registrar_paciente] la llamada a POST /api/patients falló:", e);
    return {
      estado: "error",
      detalle: "llamada_fallida",
      frase: "No se pudo completar el alta por un error del sistema. Antes de reintentar, busca al paciente por si llegó a quedar registrado.",
    };
  }
  return traducirRespuesta(ctx, cuerpo, respuesta);
}

/**
 * La pregunta que sigue a un 409: con la MISMA búsqueda que la propuesta, para
 * que traiga huella y una segunda confirmación no pregunte por diferencias de
 * red (el servidor busca solo por nombre). Si esa búsqueda no ve nada o no
 * responde, se usa la lista del servidor.
 */
async function preguntaTrasConflicto(ctx: SabinaCtx, cuerpo: CuerpoAlta, b: Record<string, any>): Promise<PropuestaAlta> {
  try {
    const propios = await buscarDuplicados(ctx, cuerpo);
    if (propios.visibles.length > 0 || propios.hayOcultos) return armarPropuesta(ctx, cuerpo, propios);
  } catch (e) {
    console.error("[sabina/registrar_paciente] tras el 409 no pude volver a buscar; uso la lista del servidor:", e);
  }
  // La lista del servidor ya viene recortada a lo que el usuario puede listar.
  // Sin `patients.view`, ni eso: se queda en «existe alguien».
  const lista: any[] = Array.isArray(b.duplicates) ? b.duplicates.filter((d: any) => d && typeof d.id === "string") : [];
  const puedeVer = tienePermiso(ctx, "patients.view");
  const visibles = puedeVer
    ? lista.slice(0, 5).map((d) => ({
        pacienteId: d.id as string,
        folio: typeof d.patientNumber === "string" ? d.patientNumber : null,
        nombre: typeof d.fullName === "string" ? d.fullName : "",
        telefonoFinal: telefonoFinal(d.phone),
      }))
    : [];
  return armarPropuesta(ctx, cuerpo, {
    comprobacion: "completa",
    visibles,
    masVisibles: puedeVer ? Math.max(0, lista.length - visibles.length) : 0,
    hayOcultos: b.hasHiddenDuplicates === true || (!puedeVer && lista.length > 0),
    huella: null,
  });
}

/* ── usar el que existe ─────────────────────────────────────────────── */

async function usarExistente(ctx: SabinaCtx, propuesta: PropuestaAlta, pacienteId: string | null): Promise<ResultadoAlta> {
  if (pacienteId === null) {
    // Existe, pero fuera de su alcance: no hay nada que devolverle.
    return {
      estado: "requiere_revision",
      frase: "No di de alta a nadie. Ese paciente ya existe pero no está a tu alcance: pide a un administrador que te dé acceso a su expediente.",
    };
  }
  if (!(Array.isArray(propuesta.duplicados?.visibles) && propuesta.duplicados.visibles.some((v) => v.pacienteId === pacienteId))) {
    return { estado: "error", detalle: "paciente_no_propuesto", frase: "Ese paciente no estaba en la propuesta. No se hizo nada." };
  }
  if (!tienePermiso(ctx, "patients.view")) {
    return { estado: "sin_permiso", permiso: "patients.view", frase: "No tienes permiso para ver pacientes, así que no puedo usar ese expediente." };
  }

  // Se vuelve a mirar: entre la tarjeta y el toque pudo archivarse por ARCO o
  // quedar restringido a otros.
  const filas = await dbDe(ctx).patient.findMany({
    where: buildPatientWhere(comoAuthContext(ctx), { id: pacienteId }),
    select: { id: true, patientNumber: true, firstName: true, lastName: true },
    take: 1,
  });
  const p = (filas as any[])[0];
  if (!p) {
    return { estado: "no_encontrado", frase: "Ese paciente ya no está disponible para ti. No se hizo nada." };
  }
  const paciente = {
    pacienteId: p.id,
    folio: p.patientNumber ?? null,
    nombre: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
  };
  return {
    estado: "usar_existente",
    paciente,
    frase: `Uso el expediente que ya existe: ${paciente.nombre} (${paciente.folio ?? "sin folio"}). No se creó ninguno nuevo.`,
  };
}

/* ── el cuerpo ─────────────────────────────────────────────────────── */

/** Solo las claves de `CuerpoAlta`, y solo con su tipo. Lo demás no viaja. */
function cuerpoPermitido(c: CuerpoAlta): CuerpoAlta {
  const out: CuerpoAlta = {
    firstName: String(c?.firstName ?? ""),
    lastName: String(c?.lastName ?? ""),
    phone: String(c?.phone ?? ""),
    allergies: Array.isArray(c?.allergies) ? c.allergies.filter((a) => typeof a === "string") : [],
  };
  if (typeof c?.dob === "string") out.dob = c.dob;
  if (c?.gender === "M" || c?.gender === "F" || c?.gender === "OTHER") out.gender = c.gender;
  if (typeof c?.email === "string") out.email = c.email;
  return out;
}

/* ── lo que contesta el servidor ───────────────────────────────────── */

function sinPermiso(http?: number): ResultadoAlta {
  return {
    estado: "sin_permiso",
    permiso: "patients.create",
    frase: "No tienes permiso para dar de alta pacientes; lo da el administrador en Equipo. No se creó nada.",
    ...(http !== undefined && { http }),
  };
}

async function traducirRespuesta(ctx: SabinaCtx, cuerpo: CuerpoAlta, r: RespuestaAlta): Promise<ResultadoAlta> {
  const b = (r.cuerpo && typeof r.cuerpo === "object" ? r.cuerpo : {}) as Record<string, any>;
  const http = r.status;

  if (http === 201 || http === 200) {
    if (typeof b.id !== "string" || !b.id) {
      return {
        estado: "error",
        detalle: "alta_sin_id",
        frase: "El servidor respondió que lo dio de alta pero no devolvió su ficha. Busca al paciente antes de reintentar, para no duplicarlo.",
        http,
      };
    }
    const paciente = {
      pacienteId: b.id,
      folio: typeof b.patientNumber === "string" ? b.patientNumber : null,
      nombre: `${b.firstName ?? cuerpo.firstName} ${b.lastName ?? cuerpo.lastName}`.trim(),
    };
    return {
      estado: "creado",
      paciente,
      frase: `Di de alta a ${paciente.nombre}${paciente.folio ? ` (folio ${paciente.folio})` : ""}.`,
      http,
    };
  }

  if (http === 409 && b.code === "DUPLICATE_PATIENT") {
    const propuesta = await preguntaTrasConflicto(ctx, cuerpo, b);
    return { estado: "duplicado", propuesta, frase: propuesta.pregunta ?? "Ya existe un paciente así. ¿Es la misma persona?", http };
  }

  if (http === 402) {
    const limite = typeof b.limit === "number" ? b.limit : null;
    const esAdmin = b.isAdmin === true;
    return {
      estado: "tope_plan",
      limite,
      esAdmin,
      frase:
        `Tu plan llegó a su tope${limite !== null ? ` de ${limite} pacientes` : " de pacientes"}. No se creó nada. ` +
        (esAdmin ? "Puedes mejorar el plan en Ajustes → Suscripción." : "Pídele al administrador que mejore el plan."),
      http,
    };
  }

  if (http === 403) return sinPermiso(http);

  if (http === 401) {
    return { estado: "sesion_cerrada", frase: "Se cerró tu sesión. Vuelve a entrar; no se creó nada.", http };
  }

  if (http === 400) {
    // Los textos de INVALID_PATIENT los escribe `validatePatientCreateBody` para
    // enseñarse tal cual en el modal. Cualquier otro 400, en genérico.
    const texto = b.code === "INVALID_PATIENT" && typeof b.error === "string" ? b.error : "un dato no es válido.";
    return {
      estado: "datos_invalidos",
      campo: typeof b.field === "string" ? b.field : null,
      frase: `No pude darlo de alta: ${texto} No se creó nada.`,
      http,
    };
  }

  if (http === 409) {
    return { estado: "error", detalle: "http_409_folio", frase: "No pude asignarle folio. No se creó nada; inténtalo otra vez.", http };
  }

  // 500 y lo que no se esperaba. `b.error` NO se repite: puede ser texto de Prisma.
  return {
    estado: "error",
    detalle: `http_${http}`,
    frase: "No se pudo registrar por un error del sistema. Antes de reintentar, busca al paciente por si llegó a quedar registrado.",
    http,
  };
}
