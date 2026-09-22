/**
 * Sabina — las acciones de agenda (ws1-t2) enchufadas a la confirmación en dos
 * fases (ws1-t1). Es el adaptador que faltaba al juntar las dos ramas.
 *
 * Las dos se construyeron contra el contrato sin verse, y cada una dejó su mitad
 * con otra forma:
 *  · ws1-t2 dejó HERRAMIENTAS (`SabinaTool`) que devuelven la `PropuestaAgenda`
 *    con la petición exacta al endpoint, más `revalidarPropuestaAgenda` e
 *    `interpretarRespuestaAgenda` para la fase 2;
 *  · ws1-t1 espera ACCIONES (`SabinaAccion`: preparar → huella → ejecutar).
 *
 * Aquí se traduce una a la otra SIN reescribir ninguna regla:
 *
 *  preparar  corre la herramienta de ws1-t2 tal cual y traduce su respuesta
 *            (propuesta / pregunta / no disponible / sin permiso) a la del motor.
 *  huella    es `revalidarPropuestaAgenda`: vuelve a correr la MISMA herramienta
 *            con los ids resueltos y exige la misma tarjeta. Si ya no vale, la
 *            huella es irrepetible y la confirmación no escribe.
 *  ejecutar  manda `propuesta.peticion` al route handler real con la llave, y la
 *            frase sale de `interpretarRespuestaAgenda`.
 *
 * ⛔ Nada de Prisma aquí. Los handlers se importan dentro de `ejecutar` (import
 * dinámico): el bucle del modelo ni siquiera carga su código.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  desenlaceDeEndpoint,
  definirAccion,
  type ManejadorRuta,
  type SabinaAccion,
  type SabinaDeshacer,
  type SabinaEjecucion,
  type SabinaPreparacion,
} from "./engine-acciones";
import {
  agendarCita,
  cancelarCita,
  interpretarRespuestaAgenda,
  reagendarCita,
  revalidarPropuestaAgenda,
  type DatosAccionAgenda,
  type PropuestaAgenda,
} from "./tools/agenda-acciones";
import type { SabinaCtx, SabinaTool } from "./tipos";

/* ── lo que se guarda: la PropuestaAgenda entera ───────────────────────────
   Todos los campos declarados: `z.object` quita lo que no conoce, y la
   revalidación compara la propuesta guardada campo a campo. */

const esquemaMomento = z
  .object({ fecha: z.string(), hora: z.string(), texto: z.string(), doctor: z.string() })
  .nullable();

function esquemaPropuesta(accion: PropuestaAgenda["accion"]) {
  return z.object({
    accion: z.literal(accion),
    permiso: z.string(),
    peticion: z.object({
      metodo: z.enum(["POST", "PATCH", "DELETE"]),
      ruta: z.string(),
      cuerpo: z.record(z.unknown()).nullable(),
    }),
    titulo: z.string(),
    frase: z.string(),
    detalle: z.array(z.object({ campo: z.string(), valor: z.string() })),
    antes: esquemaMomento,
    despues: esquemaMomento,
    avisos: z.array(z.string()),
    deshacer: z.object({ reversible: z.boolean(), como: z.string() }),
    revalidar: z.object({ herramienta: z.literal(accion), parametros: z.record(z.unknown()) }),
    esperado: z
      .object({ startsAt: z.string(), endsAt: z.string(), doctorId: z.string(), status: z.string() })
      .nullable(),
  }) as unknown as z.ZodType<PropuestaAgenda>;
}

/* ── fase 1: la respuesta de la herramienta, en la forma del motor ──────── */

/** El parámetro con el que el modelo manda de vuelta lo que eligió el usuario. */
const PARAMETRO_DE: Record<string, string> = {
  paciente: "pacienteId",
  doctor: "doctorId",
  sillon: "sillonId",
  cita: "citaId",
};

export function preparacionDeAgenda(d: DatosAccionAgenda, deshacer: SabinaDeshacer): SabinaPreparacion<PropuestaAgenda> {
  switch (d.estado) {
    case "propuesta": {
      const p = d.propuesta;
      const avisos = [...p.avisos];
      // La tarjeta pinta el «deshacer» fijo de la acción; si la propuesta trae
      // uno más preciso (p. ej. el de un administrador), va como aviso.
      // Sin strictNullChecks TS no estrecha por `reversible` (booleano).
      const fijo = (deshacer as { como?: string; aviso?: string }).como ?? (deshacer as { aviso?: string }).aviso;
      if (p.deshacer?.como && p.deshacer.como !== fijo) avisos.push(p.deshacer.como);
      return {
        tipo: "propuesta",
        datos: p,
        tarjeta: {
          frase: p.frase,
          detalles: p.detalle.map((f) => ({ etiqueta: f.campo, valor: f.valor })),
          avisos,
        },
      };
    }
    case "pregunta":
      return {
        tipo: "aclarar",
        pregunta: d.preguntas.map((q) => q.texto).join(" "),
        // El id va en la opción: sin él, el modelo no puede volver a llamar con lo
        // que eligió el usuario y la pregunta se repetiría.
        opciones: d.preguntas.flatMap((q) =>
          q.opciones.map(
            (o) => `${o.etiqueta}${o.detalle ? ` (${o.detalle})` : ""} → ${PARAMETRO_DE[q.falta] ?? "id"}: ${o.id}`,
          ),
        ),
      };
    case "no_disponible":
      return {
        tipo: "no_se_puede",
        frase: d.alternativas.length > 0 ? `${d.frase} Horas libres ese día: ${d.alternativas.join(", ")}.` : d.frase,
      };
    case "sin_permiso":
      return { tipo: "sin_permiso", frase: d.frase };
    case "no_se_puede":
    default:
      return { tipo: "no_se_puede", frase: (d as { frase?: string }).frase ?? "No se puede." };
  }
}

/* ── fase 2: la respuesta del endpoint, en la forma del motor ──────────── */

const TIPO_DE_MOTIVO: Record<string, "sin_permiso" | "conflicto" | "invalido" | "error"> = {
  sin_sesion: "sin_permiso",
  sin_permiso: "sin_permiso",
  solape: "conflicto",
  sillon_no_disponible: "conflicto",
  transicion_invalida: "conflicto",
  regla: "invalido",
  no_encontrado: "invalido",
  datos: "invalido",
  error_sistema: "error",
};

export function ejecucionDeAgenda(
  propuesta: PropuestaAgenda,
  r: { status: number; cuerpo: unknown },
  citaId: string | null,
): SabinaEjecucion {
  const i = interpretarRespuestaAgenda(propuesta, r.status, r.cuerpo);
  if (i.ok) {
    const nueva = (r.cuerpo as { appointment?: { id?: unknown } } | null)?.appointment?.id;
    const id = typeof nueva === "string" ? nueva : citaId;
    return { ok: true, frase: i.frase, ...(id ? { entidad: { tipo: "appointment", id } } : {}) };
  }
  if (i.falloDeSabina) {
    console.error("[sabina/agenda] el endpoint rechazó una petición armada por Sabina", {
      accion: propuesta.accion,
      status: r.status,
      motivo: i.motivo,
    });
  }
  if (i.motivo === "error_sistema") {
    // «No se guardó nada» no se puede afirmar ante un 500: los handlers de citas
    // responden 500 también si falla algo DESPUÉS de guardar (bitácora, DTO).
    return desenlaceDeEndpoint(r, VERBO[propuesta.accion]);
  }
  // Tras confirmar no hay turno de chat que «busque otra hora»: se pide.
  const frase = i.reintentar ? i.frase.replace("No se guardó; te busco otra hora.", "No se guardó nada: pídeme otra hora.") : i.frase;
  return { ok: false, tipo: TIPO_DE_MOTIVO[i.motivo] ?? "error", frase };
}

const VERBO: Record<PropuestaAgenda["accion"], string> = {
  agendar_cita: "agendar la cita",
  reagendar_cita: "mover la cita",
  cancelar_cita: "cancelar la cita",
};

/** La única petición que cada acción puede mandar. Lo guardado no se da por bueno a ciegas. */
const PETICION_PERMITIDA: Record<PropuestaAgenda["accion"], { metodo: string; ruta: RegExp }> = {
  agendar_cita: { metodo: "POST", ruta: /^\/api\/appointments$/ },
  reagendar_cita: { metodo: "PATCH", ruta: /^\/api\/appointments\/([A-Za-z0-9_-]{1,64})$/ },
  cancelar_cita: { metodo: "DELETE", ruta: /^\/api\/appointments\/([A-Za-z0-9_-]{1,64})$/ },
};

async function manejadorDe(accion: PropuestaAgenda["accion"]): Promise<ManejadorRuta> {
  if (accion === "agendar_cita") return (await import("@/app/api/appointments/route")).POST as ManejadorRuta;
  const rutaId = await import("@/app/api/appointments/[id]/route");
  return (accion === "reagendar_cita" ? rutaId.PATCH : rutaId.DELETE) as ManejadorRuta;
}

/** JSON con las claves ordenadas: la huella no depende del orden en que vuelva un `jsonb`. */
function canonico(valor: unknown): string {
  return JSON.stringify(valor ?? null, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/* ── la acción ─────────────────────────────────────────────────────────── */

function accionDeAgenda(def: {
  tool: SabinaTool<any, DatosAccionAgenda>;
  accion: PropuestaAgenda["accion"];
  titulo: string;
  boton: string;
  queHace: string;
  deshacer: SabinaDeshacer;
}): SabinaAccion<any, PropuestaAgenda> {
  const { tool, accion, deshacer } = def;
  return definirAccion<any, PropuestaAgenda>({
    nombre: tool.nombre,
    descripcion: tool.descripcion,
    titulo: def.titulo,
    boton: def.boton,
    queHace: def.queHace,
    permiso: tool.permiso,
    deshacer,
    parametros: tool.parametros,
    datos: esquemaPropuesta(accion),

    async preparar(ctx: SabinaCtx, params: unknown) {
      return preparacionDeAgenda(await tool.ejecutar(ctx, params), deshacer);
    },

    async huella(ctx: SabinaCtx, propuesta: PropuestaAgenda) {
      const r = await revalidarPropuestaAgenda(ctx, propuesta);
      if (r.vigente === true) {
        const { peticion, esperado, avisos, detalle, frase } = propuesta;
        return `vigente:${canonico({ peticion, esperado, avisos, detalle, frase })}`;
      }
      // Si la herramienta no pudo correr (la base no respondió), no se sabe si algo
      // cambió: se lanza, y la confirmación dice «no pude comprobar», no «algo cambió».
      const fallo = (r as { resultado: { ok: boolean; motivo?: string; detalle?: string } }).resultado;
      if (fallo.ok === false && fallo.motivo === "error") throw new Error(`revalidacion_fallida: ${fallo.detalle ?? ""}`);
      // Irrepetible: una propuesta que dejó de valer nunca coincide con otra
      // huella, ni con la de otra que también dejó de valer.
      return `ya_no_vale:${randomUUID()}`;
    },

    async ejecutar(llave, _ctx, propuesta) {
      const permitida = PETICION_PERMITIDA[accion];
      const { metodo, ruta, cuerpo } = propuesta.peticion;
      const id = permitida.ruta.exec(ruta);
      // WS1-T3: `bloqueoConfirmado` se suma a la lista por el mismo criterio
      // que `overrideReason`. No es una escalada —no apaga ninguna regla y el
      // texto del rastro lo escribe el servidor—, pero Sabina es justamente
      // una de las puertas a las que un bloqueo SÍ prohíbe: que no pueda
      // mandar el campo con el que el staff dice «ya lo confirmé».
      if (
        propuesta.accion !== accion ||
        metodo !== permitida.metodo ||
        !id ||
        (cuerpo && ("overrideReason" in cuerpo || "bloqueoConfirmado" in cuerpo))
      ) {
        console.error("[sabina/agenda] propuesta guardada con una petición que no corresponde", { accion, metodo, ruta });
        return { ok: false, tipo: "error", frase: "Esa propuesta no se pudo ejecutar tal como estaba. No se hizo nada; pídemelo otra vez." };
      }
      const citaId = id[1] ?? null;
      const r = await llave.llamar(await manejadorDe(accion), {
        metodo: permitida.metodo as "POST" | "PATCH" | "DELETE",
        ruta,
        // DELETE sin motivo va sin cuerpo, como lo manda la pantalla.
        cuerpo: cuerpo ?? undefined,
        params: citaId ? { id: citaId } : {},
      });
      return ejecucionDeAgenda(propuesta, r, citaId);
    },
  });
}

export const accionAgendarCita = accionDeAgenda({
  tool: agendarCita,
  accion: "agendar_cita",
  titulo: "Agendar cita",
  boton: "Sí, agendar",
  queHace: "agendar citas",
  deshacer: { reversible: true, como: "Se puede cancelar después desde la agenda (lo hace recepción o un administrador)." },
});

export const accionReagendarCita = accionDeAgenda({
  tool: reagendarCita,
  accion: "reagendar_cita",
  titulo: "Mover cita",
  boton: "Sí, mover la cita",
  queHace: "mover citas",
  deshacer: { reversible: true, como: "Se puede volver a mover a la hora anterior si ese hueco sigue libre." },
});

export const accionCancelarCita = accionDeAgenda({
  tool: cancelarCita,
  accion: "cancelar_cita",
  titulo: "Cancelar cita",
  boton: "Sí, cancelar la cita",
  queHace: "cancelar citas",
  deshacer: {
    reversible: false,
    aviso: "No se puede deshacer: solo un administrador puede reabrir una cita cancelada. Si hace falta, se agenda una cita nueva.",
  },
});
