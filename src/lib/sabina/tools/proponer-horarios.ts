/**
 * `proponer_horarios` — cuándo cabe una cita, para un doctor, en un día o en
 * un tramo de días.
 *
 * Solo lee (key `agenda.view`, la de ver la agenda). No reserva nada: la hora
 * que devuelve se agenda con `agendar_cita`, que vuelve a comprobarla, y al
 * confirmar la comprueba el servidor otra vez.
 *
 * Nació como «los huecos de HOY» (ws1-t2). Rafael pidió que la hora la ponga
 * Sabina: «¿dónde puedo agendar a tal paciente el jueves?», «¿tengo hueco esta
 * semana?», «acomódame a Juan lo antes posible». Eso NO es una herramienta
 * nueva (regla 2 del contrato: cada una se paga en cada pregunta) — es esta
 * misma con dos parámetros más:
 *
 *  · `hasta` — el día se vuelve un tramo (`fecha` es el primero). Un solo día
 *    sigue siendo el caso de siempre, byte a byte: con `hasta` ausente, todo
 *    este archivo se comporta exactamente como antes.
 *  · `desdeHora`/`hastaHora` — «por la tarde» sin inventar una franja fija por
 *    clínica: se recorta el horario real de atención, nunca al revés.
 *
 * Con un tramo, «lo antes posible» no es un modo aparte: los candidatos salen
 * ordenados por fecha y, dentro de cada día, por cercanía a `horaPreferida` (o
 * en orden si no la dieron) — el primero de la lista YA es el más próximo. Y
 * para no devolver treinta huecos de quince minutos, `resumenDias` cuenta por
 * día (cuántos, desde qué hora) y `huecos` trae solo los mejores candidatos.
 *
 * La duración es la de la herramienta original: la que pida el modelo o, si
 * no la sabe, la de la clínica (`defaultSlotMinutes`). El repo no tiene una
 * tabla de «cuánto dura una limpieza»; cuando el usuario la mencione, que sea
 * el modelo quien pregunte o la traduzca a minutos ANTES de llamar aquí — no
 * se inventa una duración que no está escrita en ningún lado (regla 5).
 *
 * Distingue las respuestas que el MAPA (§5) pide no mezclar: «esos días la
 * clínica cierra», «no quedan huecos de N minutos», «ese tramo ya pasó». Y si
 * quien pregunta no puede agendar, lo dice (`puedeAgendar`): no tiene sentido
 * ofrecerle horas sin avisar.
 */

import { z } from "zod";
import { defaultDurationFor } from "@/lib/new-appointment/duration-presets";
import { definirHerramienta, tienePermiso } from "./base";
import { diasDelRango, esquemaFecha, hoyEnClinica, sumarDias } from "./fechas";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import {
  ROLES_AGENDAR,
  cargarClinica,
  dbAgendaDe,
  esquemaHora,
  fechaLarga,
  minutosDe,
  rolPermitido,
  type PreguntaAgenda,
} from "./agenda-comun";
import { buscarHuecos, leerOcupacion, TOPE_HUECOS, type Hueco } from "./agenda-huecos";
import { resolverDoctor, resolverSillon } from "./agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

/**
 * Tope de días de un tramo. No es una preferencia: cada día es (al menos) una
 * ida a la base, y esto corre dentro de una respuesta de chat. Catorce cubre
 * «esta semana» y «las próximas dos semanas» sin acercarse al pooler.
 */
export const MAX_DIAS_PROPONER = 14;

/** Con tramo (más de un día), menos huecos sueltos: el detalle vive en `resumenDias`. */
const TOPE_HUECOS_RANGO = 8;

const parametros = z.object({
  fecha: esquemaFecha.describe("Día, AAAA-MM-DD. Con `hasta`, es el PRIMER día del tramo."),
  hasta: esquemaFecha
    .optional()
    .describe(
      `Último día del tramo (incluido), máx ${MAX_DIAS_PROPONER} días desde \`fecha\`. Úsalo para «¿algo esta semana?» ` +
        "o para «lo antes posible» dentro de varios días; los candidatos salen ordenados del primer día en adelante, " +
        "así que el primero de la lista ya es el más próximo. Sin `hasta`, solo mira `fecha`.",
    ),
  doctor: z.string().max(80).optional().describe("Nombre del doctor, tal como lo dijo el usuario."),
  doctorId: z.string().max(64).optional().describe("Id del doctor, si ya lo resolviste antes."),
  duracionMinutos: z.number().int().min(5).max(480).optional().describe("Duración de la cita. Por defecto, la de la clínica."),
  horaPreferida: esquemaHora.optional().describe("Si el usuario pidió una hora, para ofrecer las más cercanas (a esa hora, cada día del tramo)."),
  desdeHora: esquemaHora.optional().describe("Acota la búsqueda a partir de esta hora cada día, p.ej. «por la tarde» → 14:00."),
  hastaHora: esquemaHora.optional().describe("Acota la búsqueda hasta esta hora cada día."),
  sillon: z.string().max(80).optional(),
  sillonId: z.string().max(64).optional(),
});

export type ParamsProponerHorarios = z.infer<typeof parametros>;

/** Un candidato con su día: solo hace falta cuando el tramo es de varios. */
export interface HuecoConFecha extends Hueco {
  fecha: string;
}

/** El resumen de UN día del tramo: para decir «el jueves 5, el miércoles 3» sin listar cada hora. */
export interface ResumenDia {
  fecha: string;
  estado: "con_huecos" | "sin_huecos" | "dia_cerrado" | "pasado";
  /** Cuántas horas caben ese día en total (sin recortar). */
  totalHuecos: number;
  primeraHora: string | null;
}

export interface DatosProponerHorarios {
  estado: "con_huecos" | "sin_huecos" | "dia_cerrado" | "pasado" | "pregunta" | "no_se_puede";
  /** Primer día pedido (o el único, sin `hasta`). */
  fecha: string;
  /** Último día pedido. Igual a `fecha` cuando no hay tramo. */
  hasta: string;
  desdeHora: string | null;
  hastaHora: string | null;
  doctor: { id: string; nombre: string } | null;
  sillon: { id: string; nombre: string } | null;
  duracionMinutos: number;
  /** Ventana de atención; solo se rellena con UN día (con tramo, cada día puede tener la suya: ver `resumenDias`). */
  horario: { abre: string; cierra: string } | null;
  /** Los mejores candidatos, en orden. Como mucho 5 (un día) u 8 (tramo). */
  huecos: HuecoConFecha[];
  /** Cuántas horas caben en total, sumando todos los días del tramo. */
  totalHuecos: number;
  /** Un renglón por día pedido (tras aplicar el tope de {@link MAX_DIAS_PROPONER}). Vacío sin tramo. */
  resumenDias: ResumenDia[];
  preguntas: PreguntaAgenda[];
  /** Frase cuando no se pudo resolver algo, cuando cierran todos los días, o cuando se recortó el tramo. */
  frase: string | null;
  /** ¿Quien pregunta puede agendar? Si no, Sabina lo dice al ofrecer. */
  puedeAgendar: boolean;
}

/** «entre las 14:00 y las 19:00» / «desde las 14:00» / "" — para meter en una frase. */
function franjaTexto(desdeHora: string | null, hastaHora: string | null): string {
  if (desdeHora && hastaHora) return ` entre las ${desdeHora} y las ${hastaHora}`;
  if (desdeHora) return ` desde las ${desdeHora}`;
  if (hastaHora) return ` hasta las ${hastaHora}`;
  return "";
}

export const proponerHorarios = definirHerramienta<ParamsProponerHorarios, DatosProponerHorarios>({
  nombre: "proponer_horarios",
  descripcion:
    "Cuándo cabe una cita con un doctor: horas libres dentro del horario de la clínica y del sillón, sin encimar " +
    "otra cita. Sirve para un día («¿qué huecos tiene el Dr. Salas el jueves?») o un tramo con `hasta` («¿algo " +
    "esta semana?», «acomódame a Juan lo antes posible»: pon `fecha` hoy y `hasta` unos días después, el primer " +
    "candidato ya es el más próximo). `desdeHora`/`hastaHora` acotan a una franja del día. No agenda nada. Si " +
    "falta el doctor, pregunta cuál.",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosProponerHorarios> {
    const db = dbAgendaDe(ctx);
    const puedeAgendar = rolPermitido(ctx, ROLES_AGENDAR) && tienePermiso(ctx, "agenda.create");
    const clinica = await cargarClinica(ctx, db);
    const duracion = params.duracionMinutos ?? defaultDurationFor(clinica.defaultSlotMinutes);
    const hastaPedido = params.hasta ?? params.fecha;

    const vacio: DatosProponerHorarios = {
      estado: "pregunta",
      fecha: params.fecha,
      hasta: hastaPedido,
      desdeHora: params.desdeHora ?? null,
      hastaHora: params.hastaHora ?? null,
      doctor: null,
      sillon: null,
      duracionMinutos: duracion,
      horario: null,
      huecos: [],
      totalHuecos: 0,
      resumenDias: [],
      preguntas: [],
      frase: null,
      puedeAgendar,
    };

    if (hastaPedido < params.fecha) {
      return { ...vacio, estado: "no_se_puede", frase: `«hasta» (${hastaPedido}) es anterior a «fecha» (${params.fecha}).` };
    }

    const truncado = diasDelRango(params.fecha, hastaPedido) > MAX_DIAS_PROPONER;
    const hastaISO = truncado ? sumarDias(params.fecha, MAX_DIAS_PROPONER - 1) : hastaPedido;
    const fechas = Array.from({ length: diasDelRango(params.fecha, hastaISO) }, (_, i) => sumarDias(params.fecha, i));
    const esTramo = fechas.length > 1;

    const doctor = await resolverDoctor(ctx, db, { doctorId: params.doctorId, doctor: params.doctor });
    if (doctor.tipo === "pregunta") return { ...vacio, preguntas: [doctor.pregunta] };
    if (doctor.tipo === "no") return { ...vacio, estado: "no_se_puede", frase: doctor.frase };

    // El sillón se resuelve con la ocupación del PRIMER día: los sillones
    // activos de la clínica no cambian de un día a otro.
    const primeraOcupacion = await leerOcupacion(ctx, db, { fecha: fechas[0], doctorId: doctor.valor.id, timezone: clinica.timezone });
    const sillon = resolverSillon(primeraOcupacion.sillones, { sillonId: params.sillonId, sillon: params.sillon });
    if (sillon.tipo === "pregunta") return { ...vacio, doctor: doctor.valor, preguntas: [sillon.pregunta] };
    if (sillon.tipo === "no") return { ...vacio, estado: "no_se_puede", doctor: doctor.valor, frase: sillon.frase };

    const franja =
      params.desdeHora || params.hastaHora
        ? { desde: params.desdeHora ? minutosDe(params.desdeHora) : null, hasta: params.hastaHora ? minutosDe(params.hastaHora) : null }
        : null;

    const ahora = new Date();
    const resumenDias: ResumenDia[] = [];
    const candidatos: HuecoConFecha[] = [];
    let totalGeneral = 0;
    let algunDiaAbierto = false;
    let algunDiaFuturo = false;
    let horarioUnico: { abre: string; cierra: string } | null = null;

    // Secuencial y no en paralelo a propósito: un tramo de 14 días son hasta
    // 14 idas a la base, y "menos de 7 por Promise.all" (CLAUDE.md) es por
    // día, no por tramo entero.
    for (let i = 0; i < fechas.length; i++) {
      const fecha = fechas[i];
      const ocupacion = i === 0 ? primeraOcupacion : await leerOcupacion(ctx, db, { fecha, doctorId: doctor.valor.id, timezone: clinica.timezone });
      const { huecos, total, ventana } = buscarHuecos({
        fecha,
        duracion,
        clinica,
        ocupacion,
        sillonId: sillon.valor?.id ?? null,
        ahora,
        horaPreferida: params.horaPreferida ?? null,
        franja,
        tope: esTramo ? TOPE_HUECOS_RANGO : TOPE_HUECOS,
      });

      if (ventana) algunDiaAbierto = true;
      const finDelDia = tzLocalToUtc(fecha, 23, 59, clinica.timezone);
      const esPasado = fecha < hoyEnClinica(clinica.timezone) || finDelDia.getTime() < ahora.getTime();
      if (!esPasado) algunDiaFuturo = true;

      resumenDias.push({
        fecha,
        estado: !ventana ? "dia_cerrado" : total > 0 ? "con_huecos" : esPasado ? "pasado" : "sin_huecos",
        totalHuecos: total,
        primeraHora: huecos[0]?.hora ?? null,
      });
      totalGeneral += total;
      if (!esTramo) horarioUnico = ventana;
      for (const h of huecos) candidatos.push({ ...h, fecha });
    }

    // Cronológico: fecha antes que hora. Así "el jueves" (un día) y "lo antes
    // posible" (varios) comparten el mismo orden — el primer candidato YA es
    // el más próximo — y dentro de cada día manda `horaPreferida`, igual que
    // antes de que existiera el tramo.
    candidatos.sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? -1 : 1));
    const huecosFinal = candidatos.slice(0, esTramo ? TOPE_HUECOS_RANGO : TOPE_HUECOS);

    const estado: DatosProponerHorarios["estado"] = !algunDiaAbierto
      ? "dia_cerrado"
      : totalGeneral > 0
        ? "con_huecos"
        : !algunDiaFuturo
          ? "pasado"
          : "sin_huecos";

    const frase =
      estado === "dia_cerrado"
        ? esTramo
          ? `La clínica está cerrada todo ese tramo (del ${params.fecha} al ${hastaISO}).`
          : `La clínica cierra el ${fechaLarga(tzLocalToUtc(params.fecha, 12, 0, clinica.timezone), clinica.timezone)}.`
        : truncado
          ? `Busqué hasta el ${hastaISO} nomás (el tope de un vistazo son ${MAX_DIAS_PROPONER} días); pide otro tramo si hace falta más adelante.`
          : null;

    return {
      ...vacio,
      estado,
      hasta: hastaISO,
      doctor: doctor.valor,
      sillon: sillon.valor,
      horario: horarioUnico,
      huecos: huecosFinal,
      totalHuecos: totalGeneral,
      resumenDias,
      frase,
    };
  },

  vacio: () => false,

  resumir(d) {
    const esTramo = d.fecha !== d.hasta;
    const conQuien = d.doctor ? ` con ${d.doctor.nombre}` : "";
    const enSillon = d.sillon ? ` en ${d.sillon.nombre}` : "";
    const franja = franjaTexto(d.desdeHora, d.hastaHora);
    const aviso = d.puedeAgendar ? "" : " OJO: quien pregunta NO tiene permiso para agendar citas; dilo si ofreces horas.";

    switch (d.estado) {
      case "pregunta":
        return `FALTA INFORMACIÓN: ${d.preguntas.map((p) => p.texto).join(" ")} Pregúntaselo al usuario; no elijas tú.`;
      case "no_se_puede":
        return `NO SE PUEDE: ${d.frase ?? "no pude resolver los datos."}`;
      case "dia_cerrado":
        return `${d.frase ?? `La clínica cierra el ${d.fecha}.`} No hay horas que ofrecer.${aviso}`;
      case "pasado":
        return esTramo
          ? `Del ${d.fecha} al ${d.hasta} ya pasó: no hay horas que ofrecer.`
          : `El ${d.fecha} ya pasó: no hay horas que ofrecer.`;
      case "sin_huecos":
        return esTramo
          ? `Del ${d.fecha} al ${d.hasta}${conQuien} no queda ningún hueco de ${d.duracionMinutos} min${enSillon}${franja}.${aviso}`
          : `El ${d.fecha}${conQuien} ya no quedan huecos de ${d.duracionMinutos} min${franja} dentro del horario (${d.horario?.abre}–${d.horario?.cierra}).${aviso}`;
      case "con_huecos": {
        if (!esTramo) {
          return (
            `${d.totalHuecos} horas libres de ${d.duracionMinutos} min el ${d.fecha}${conQuien}${enSillon}${franja}; ` +
            `las primeras: ${d.huecos.map((h) => h.hora).join(", ")}.${aviso}`
          );
        }
        const porDia = d.resumenDias
          .filter((rd) => rd.estado === "con_huecos")
          .map((rd) => `${rd.fecha}: ${rd.totalHuecos} desde las ${rd.primeraHora}`)
          .join("; ");
        const primero = d.huecos[0];
        return (
          `${d.totalHuecos} horas libres de ${d.duracionMinutos} min entre el ${d.fecha} y el ${d.hasta}${conQuien}${enSillon}${franja}. ` +
          `Por día — ${porDia}. La más próxima: ${primero.fecha} a las ${primero.hora}.` +
          `${d.frase ? ` ${d.frase}` : ""}${aviso}`
        );
      }
    }
  },
});
