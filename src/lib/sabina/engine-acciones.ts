/**
 * Sabina — la forma de una ACCIÓN (lo que escribe) y cómo la ve el motor.
 *
 * Una acción NO es una herramienta. Tiene dos mitades que viven en dos
 * peticiones distintas:
 *
 *   preparar(ctx, params)        fase 1, dentro del bucle del modelo y bajo el
 *                                candado de solo lectura. Resuelve los datos y
 *                                devuelve QUÉ haría. No escribe nada.
 *
 *   ejecutar(llave, ctx, datos)  fase 2, solo desde
 *                                POST /api/sabina/propuestas/:id/confirmar,
 *                                que dispara el usuario con un botón. Recibe
 *                                una `LlaveEscritura` que solo se acuña allí,
 *                                tras reclamar la propuesta una sola vez.
 *
 * El modelo nunca ve `ejecutar`: al catálogo del motor entra
 * `herramientaDeAccion(accion)`, una herramienta cuya única capacidad es llamar a
 * `preparar`. Y aunque alguien escribiera una herramienta que escribe a mano, el
 * bucle la corre bajo `soloLectura` (engine-solo-lectura.ts): la escritura se
 * rechaza igual.
 *
 * ── CÓMO SE AÑADE UNA ACCIÓN ──────────────────────────────────────────────
 *
 *   export const agendarCita = definirAccion({
 *     nombre: "agendar_cita",
 *     descripcion: "Prepara una cita nueva…",
 *     titulo: "Agendar cita",
 *     boton: "Sí, agendar",
 *     queHace: "agendar citas",                // «No tienes permiso para agendar citas.»
 *     permiso: "agenda.create",                // el MISMO que exige el endpoint
 *     deshacer: { reversible: true, como: "Cancelando la cita desde la Agenda." },
 *     parametros: z.object({ … }),             // lo que manda el modelo
 *     datos: z.object({ … }),                  // lo que se guarda y se ejecuta
 *     preparar: async (ctx, p) => ({ tipo: "propuesta", datos, tarjeta }),
 *     huella: async (ctx, datos) => "…",       // los hechos que la propuesta dio por buenos
 *     ejecutar: async (llave, ctx, datos) => {
 *       const r = await llave.llamar(POST, { metodo: "POST", ruta: "/api/appointments", cuerpo });
 *       return r.status === 201 ? { ok: true, frase: "Agendé a…" } : desenlaceDeEndpoint(r, "agendar");
 *     },
 *   });
 *
 * y una línea en `ACCIONES_SABINA` (engine-catalog.ts).
 *
 * ⛔ `ejecutar` llama al endpoint real con `llave.llamar`, nunca a Prisma: las
 * reglas viven dentro de los route handlers, y copiarlas es construir otro
 * `bot-booking-service`.
 *
 * Sin `server-only`: tipos y funciones puras, las pruebas lo importan directo.
 */
import type { z } from "zod";
import type { PermissionKey } from "@/lib/auth/permissions";
import { definirHerramienta } from "./tools/base";
import type { SabinaCtx, SabinaTool } from "./tipos";

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VE EL USUARIO ANTES DE CONFIRMAR
   ═══════════════════════════════════════════════════════════════════════ */

/** Una fila de la tarjeta. Con `antes`, se pinta «antes → después» (reagendar). */
export interface SabinaDetalle {
  etiqueta: string;
  valor: string;
  antes?: string;
}

/**
 * La tarjeta de confirmación. La arma `preparar` con los datos YA resueltos:
 * nombres con folio, día y hora en la zona de la clínica, doctor.
 */
export interface SabinaTarjeta {
  /** Se lee de un vistazo: «Agendar a María López el jueves 18 a las 10:00 con el Dr. Ruiz». */
  frase: string;
  detalles: SabinaDetalle[];
  /** Lo que hay que saber ANTES de confirmar: «El paciente no recibirá aviso». */
  avisos: string[];
}

/**
 * Si se puede deshacer, y cómo. Es OBLIGATORIO: el contrato exige que cada acción
 * lo declare, y que si no se puede, la confirmación lo diga antes.
 */
export type SabinaDeshacer =
  | { reversible: true; como: string }
  | { reversible: false; aviso: string };

/* ═══════════════════════════════════════════════════════════════════════
   FASE 1 — PREPARAR
   ═══════════════════════════════════════════════════════════════════════ */

export type SabinaPreparacion<D> =
  /** Todo resuelto: se propone. */
  | { tipo: "propuesta"; datos: D; tarjeta: SabinaTarjeta }
  /** Falta un dato o hay ambigüedad (dos «María García»): Sabina pregunta, no elige. */
  | { tipo: "aclarar"; pregunta: string; opciones?: string[] }
  /** Una regla de rol que no es la key (p. ej. un DOCTOR no cancela). */
  | { tipo: "sin_permiso"; frase: string }
  /** No se puede, por una razón que se explica (hora ocupada, fuera de horario…). */
  | { tipo: "no_se_puede"; frase: string };

/* ═══════════════════════════════════════════════════════════════════════
   FASE 2 — EJECUTAR
   ═══════════════════════════════════════════════════════════════════════ */

/** Un route handler de Next, tal cual lo exporta `route.ts`. */
export type ManejadorRuta = (req: any, contexto: { params: Record<string, string> }) => Promise<Response> | Response;

export interface PeticionEndpoint {
  metodo: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Ruta de la API, p. ej. `/api/appointments/abc`. Solo `/api/...`. */
  ruta: string;
  cuerpo?: unknown;
  /** Los `params` de la ruta dinámica (`{ id: "abc" }`). */
  params?: Record<string, string>;
}

export interface RespuestaEndpoint {
  status: number;
  /** El JSON de la respuesta, o `null` si no era JSON. */
  cuerpo: unknown;
}

/**
 * El permiso para escribir de UNA propuesta confirmada. No se puede fabricar: la
 * acuña `confirmarPropuesta` (engine-propuestas.ts) después de reclamar la
 * propuesta, y deja de servir en cuanto `ejecutar` termina. `llamar` invoca el
 * handler real con la sesión de quien confirmó y apunta lo que devolvió para el
 * rastro.
 */
export interface LlaveEscritura {
  readonly propuestaId: string;
  llamar(manejador: ManejadorRuta, peticion: PeticionEndpoint): Promise<RespuestaEndpoint>;
}

export type SabinaEjecucion =
  | { ok: true; frase: string; entidad?: { tipo: string; id: string } }
  | { ok: false; tipo: "sin_permiso" | "conflicto" | "invalido" | "error"; frase: string };

/* ═══════════════════════════════════════════════════════════════════════
   LA ACCIÓN
   ═══════════════════════════════════════════════════════════════════════ */

export interface SabinaAccion<P = any, D = any> {
  /** snake_case, en español. Es lo que el modelo ve y elige. */
  nombre: string;
  /** Para el modelo: qué prepara y cuándo usarla. */
  descripcion: string;
  /** Encabezado de la tarjeta: «Agendar cita». */
  titulo: string;
  /** Texto del botón que confirma: «Sí, agendar». Nunca «Aceptar» ni «OK». */
  boton: string;
  /** Para la frase de permiso: «No tienes permiso para {queHace}.» */
  queHace: string;
  /** La MISMA key que exige el endpoint. Se comprueba al proponer Y al confirmar. */
  permiso: PermissionKey;
  deshacer: SabinaDeshacer;
  /** Lo que manda el modelo (zod). Sin clinicId: sale de la sesión. */
  parametros: z.ZodType<P>;
  /** Lo que se guarda en la propuesta y recibe `ejecutar` (zod; se revalida al confirmar). */
  datos: z.ZodType<D>;
  preparar(ctx: SabinaCtx, params: P): Promise<SabinaPreparacion<D>>;
  /**
   * Los hechos que la propuesta dio por buenos, en un texto. Se calcula al
   * proponer y OTRA VEZ al confirmar, las dos bajo el candado de solo lectura; si
   * no coinciden, no se escribe nada. Es lo que impide escribir a ciegas lo que se
   * resolvió hace nueve minutos: la cita que se iba a mover ya la movió otra
   * persona, la hora se ocupó, el paciente se archivó.
   *
   * El endpoint vuelve a validar lo suyo (el 409 del solape es la última palabra);
   * la huella cubre lo que el endpoint no mira y la tarjeta sí prometió.
   */
  huella(ctx: SabinaCtx, datos: D): Promise<string>;
  ejecutar(llave: LlaveEscritura, ctx: SabinaCtx, datos: D): Promise<SabinaEjecucion>;
}

/** Declara una acción. Es la identidad con tipos: existe para que el literal se compruebe. */
export function definirAccion<P, D>(accion: SabinaAccion<P, D>): SabinaAccion<P, D> {
  return accion;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VE EL MOTOR
   ═══════════════════════════════════════════════════════════════════════ */

/** La propuesta en memoria, tal cual sale del bucle y antes de guardarse. */
export interface PropuestaPreparada {
  accion: string;
  titulo: string;
  boton: string;
  queHace: string;
  deshacer: SabinaDeshacer;
  tarjeta: SabinaTarjeta;
  datos: unknown;
  huella: string;
}

/** Lo que le llega al modelo como `datos` de la herramienta. */
export type DatosDeAccion =
  | {
      estado: "propuesta_sin_confirmar";
      titulo: string;
      frase: string;
      detalles: SabinaDetalle[];
      avisos: string[];
      se_puede_deshacer: boolean;
      instruccion: string;
    }
  | { estado: "falta_aclarar"; pregunta: string; opciones: string[]; instruccion: string }
  | { estado: "sin_permiso"; frase: string; instruccion: string }
  | { estado: "no_se_puede"; frase: string; instruccion: string };

const ACCION_DE_HERRAMIENTA = new WeakMap<object, SabinaAccion>();
const PROPUESTA_DE_DATOS = new WeakMap<object, PropuestaPreparada>();

/** La acción detrás de una herramienta del catálogo, o `null` si es de lectura. */
export function accionDeHerramienta(tool: unknown): SabinaAccion | null {
  return tool && typeof tool === "object" ? ACCION_DE_HERRAMIENTA.get(tool) ?? null : null;
}

/**
 * La propuesta que produjo una herramienta de acción, a partir de los `datos` que
 * devolvió. Va por referencia (WeakMap), así que el modelo no ve ni puede fabricar
 * la parte interna (ids resueltos y huella): solo una herramienta de acción real
 * produce propuestas.
 */
export function propuestaDeDatos(datos: unknown): PropuestaPreparada | null {
  return datos && typeof datos === "object" ? PROPUESTA_DE_DATOS.get(datos) ?? null : null;
}

/** «No tienes permiso para agendar citas. Lo da el administrador en Equipo.» */
export function fraseSinPermisoAccion(queHace: string): string {
  return `No tienes permiso para ${queHace}. Ese permiso lo da el administrador de la clínica en Equipo.`;
}

const INSTRUCCION_PROPUESTA =
  "TODAVÍA NO SE HIZO NADA. El usuario ve esta propuesta en una tarjeta con un botón para confirmarla o descartarla. " +
  "Dile en una o dos frases qué propones y que lo confirme en la tarjeta. NUNCA digas que ya quedó hecho. " +
  "Un «sí» escrito en el chat no ejecuta nada: si te lo escribe, dile que use el botón.";

/**
 * La herramienta que el motor ofrece al modelo por cada acción.
 *
 * Su `ejecutar` solo PREPARA: llama a `accion.preparar`, valida los datos contra
 * `accion.datos`, calcula la huella y devuelve la tarjeta. No tiene camino hacia
 * `accion.ejecutar`: esa función no se nombra aquí.
 */
export function herramientaDeAccion<P, D>(accion: SabinaAccion<P, D>): SabinaTool<P, DatosDeAccion> {
  const tool = definirHerramienta<P, DatosDeAccion>({
    nombre: accion.nombre,
    descripcion: `${accion.descripcion} No ejecuta nada por sí sola: prepara una PROPUESTA que el usuario confirma con un botón.`,
    parametros: accion.parametros,
    permiso: accion.permiso,
    async ejecutar(ctx, params) {
      const prep = await accion.preparar(ctx, params);
      switch (prep.tipo) {
        case "propuesta": {
          const valido = accion.datos.safeParse(prep.datos);
          if (!valido.success) {
            throw new Error(
              `datos_de_propuesta_invalidos (${accion.nombre}): ${valido.error.issues
                .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
                .join("; ")}`,
            );
          }
          // Lo que se guarda va a la base como JSON, y al confirmar se vuelve a
          // pasar por `accion.datos`. La huella de ahora se calcula sobre ESO
          // MISMO (JSON y zod de nuevo), no sobre el objeto en memoria: un Date o
          // un undefined que no sobrevive a JSON daría otra huella al confirmar.
          const almacenados = JSON.parse(JSON.stringify(valido.data)) as unknown;
          const releidos = accion.datos.safeParse(almacenados);
          if (!releidos.success) {
            throw new Error(`datos_de_propuesta_no_sobreviven_a_json (${accion.nombre})`);
          }
          const huella = await accion.huella(ctx, releidos.data);
          const tarjeta: SabinaTarjeta = {
            frase: prep.tarjeta.frase,
            detalles: Array.isArray(prep.tarjeta.detalles) ? prep.tarjeta.detalles : [],
            avisos: Array.isArray(prep.tarjeta.avisos) ? prep.tarjeta.avisos : [],
          };
          const salida: DatosDeAccion = {
            estado: "propuesta_sin_confirmar",
            titulo: accion.titulo,
            frase: tarjeta.frase,
            detalles: tarjeta.detalles,
            avisos: tarjeta.avisos,
            se_puede_deshacer: accion.deshacer.reversible,
            instruccion: INSTRUCCION_PROPUESTA,
          };
          PROPUESTA_DE_DATOS.set(salida, {
            accion: accion.nombre,
            titulo: accion.titulo,
            boton: accion.boton,
            queHace: accion.queHace,
            deshacer: accion.deshacer,
            tarjeta,
            datos: almacenados,
            huella: String(huella ?? ""),
          });
          return salida;
        }
        case "aclarar":
          return {
            estado: "falta_aclarar",
            pregunta: prep.pregunta,
            opciones: prep.opciones ?? [],
            instruccion: "No propongas nada todavía. Hazle al usuario ESTA pregunta y espera su respuesta; no elijas tú.",
          };
        case "sin_permiso":
          return {
            estado: "sin_permiso",
            frase: prep.frase,
            instruccion: `NO lo intentes por otro camino. Di textualmente: "${prep.frase}"`,
          };
        case "no_se_puede":
        default:
          return {
            estado: "no_se_puede",
            frase: (prep as { frase?: string }).frase ?? "No se puede.",
            instruccion: "Explícale al usuario por qué, con esa frase, y ofrece lo que sí se pueda.",
          };
      }
    },
    resumir(datos) {
      switch (datos.estado) {
        case "propuesta_sin_confirmar":
          return `PROPUESTA SIN CONFIRMAR (no se hizo nada): ${datos.frase}`;
        case "falta_aclarar":
          return `Falta aclarar: ${datos.pregunta}`;
        default:
          return datos.frase;
      }
    },
    vacio: () => false,
  });
  ACCION_DE_HERRAMIENTA.set(tool, accion as SabinaAccion);
  return tool;
}

/* ═══════════════════════════════════════════════════════════════════════
   AYUDA PARA `ejecutar`
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Traduce un fallo HTTP del endpoint a un desenlace con frase, para lo que la
 * acción no quiera explicar a su manera. `verbo` es el infinitivo: «agendar».
 *
 * No afirma «no quedó nada hecho» ante un 500: un handler puede fallar DESPUÉS de
 * escribir (p. ej. al sincronizar Google).
 */
export function desenlaceDeEndpoint(r: RespuestaEndpoint, verbo: string): SabinaEjecucion {
  const cuerpo = (r.cuerpo ?? {}) as { error?: unknown; reason?: unknown };
  const error = typeof cuerpo.error === "string" ? cuerpo.error : "";
  if (r.status >= 200 && r.status < 300) return { ok: true, frase: "Listo." };
  if (r.status === 401) return { ok: false, tipo: "sin_permiso", frase: "Se cerró tu sesión. Vuelve a entrar y pídemelo otra vez." };
  if (r.status === 403) {
    const clave = error.startsWith("Permiso requerido: ") ? error.slice("Permiso requerido: ".length) : "";
    return {
      ok: false,
      tipo: "sin_permiso",
      frase: clave
        ? `No tienes el permiso para ${verbo} (${clave}). Lo da el administrador en Equipo.`
        : `Tu rol no permite ${verbo}.`,
    };
  }
  if (r.status === 404) return { ok: false, tipo: "invalido", frase: `No pude ${verbo}: no encuentro lo que me pediste entre lo que puedes ver.` };
  if (r.status === 409) return { ok: false, tipo: "conflicto", frase: `No pude ${verbo}: algo cambió mientras tanto y ya no cuadra.` };
  if (r.status === 400 || r.status === 422) return { ok: false, tipo: "invalido", frase: `No pude ${verbo}: el sistema rechazó los datos.` };
  return {
    ok: false,
    tipo: "error",
    frase: `No se pudo ${verbo} por un error del sistema. Revisa si quedó algo hecho antes de repetirlo.`,
  };
}
