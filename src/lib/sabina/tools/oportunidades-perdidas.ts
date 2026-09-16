/**
 * `oportunidades_perdidas` — lo que la clínica ya ganó o ya vendió y se le está
 * escapando.
 *
 * Es la única herramienta del catálogo que devuelve DINERO y no tiempo: lo que
 * saca de aquí no es una métrica, es una lista de a quién llamar hoy.
 *
 * ── UNA SOLA HERRAMIENTA, CINCO COSAS (regla 2 del contrato) ───────────
 * Las cinco fugas —trabajo aceptado sin agendar, presupuestos sin respuesta,
 * facturas envejeciendo, citas caídas sin reagendar y pacientes que no vuelven—
 * contestan LA MISMA pregunta («¿qué se me está escapando?») y se ordenan con
 * EL MISMO criterio. Cinco herramientas habrían multiplicado por cinco el peso
 * fijo de cada llamada al modelo para servir un menú, no cinco respuestas. Va
 * una sola, con `tipo` para pedir una lista concreta y sin `tipo` para la foto.
 *
 * Y los pacientes que no vuelven NO se reimplementan: el resumen llama a
 * `pacientes_inactivos`, que ya lleva el criterio del barrido de reactivación
 * (`sweepClinic`). Dos herramientas con dos definiciones de «paciente perdido»
 * es la forma de que Sabina se contradiga sola. Por eso tampoco hay un
 * `tipo: "enfriados"`: para eso ya está aquella, entera.
 *
 * ── 🔴 EL DINERO NO SE INFLA ───────────────────────────────────────────
 * Una cifra que suma presupuestos que el paciente nunca va a aceptar es humo, y
 * el humo se nota a la primera. Por eso el dinero viaja en TRES cubos que no se
 * solapan, y solo dos se suman:
 *
 *   · `porCobrar`          — facturas EMITIDAS con saldo (ni borrador ni
 *                            cancelada). Criterio `receivableInvoiceWhere` de
 *                            @/lib/caja, el MISMO de Finanzas → Saldos. Es
 *                            dinero devengado: la clínica ya pasó la nota.
 *   · `aceptadoSinAgendar` — trabajo que el paciente ACEPTÓ (presupuesto
 *                            firmado o plan de tratamiento en marcha) y que
 *                            nadie puso en la agenda. Solo la parte que NO está
 *                            ya dentro de `porCobrar`.
 *   · `enElAire`           — presupuestos presentados sin contestar. **NO se
 *                            suma a nada**: el paciente no dijo que sí.
 *
 * 🔴 REGLA DE ORO CONTRA EL DOBLE CONTEO: cada peso se cuenta UNA vez, en la
 * etapa MÁS AVANZADA en que aparece. Un presupuesto aceptado genera factura
 * (`quote.invoiceId`) y puede generar plan (`quote.treatmentPlanId`); si esa
 * factura ya está viva y por cobrar, ese dinero YA está en `porCobrar`, y la
 * fila sale igual —el trabajo sigue sin agendar— pero con `yaFacturado: true` y
 * valiendo 0. De un plan solo se cuenta la parte pendiente. El detalle de cada
 * cruce está en ./oportunidades-fuentes.
 *
 * ── EL ORDEN ───────────────────────────────────────────────────────────
 * `(valor + 1) × 0.5^(días / semivida)`: manda el dinero, y el dinero se
 * descuenta según se enfría. La fórmula, las semividas y el porqué de que la
 * prioridad NO viaje en la fila están en ./oportunidades-criterio.
 *
 * ── PERMISOS: SE ENSEÑA LO QUE SÍ Y SE DICE LO QUE NO ──────────────────
 * Misma forma que `resumen_clinica`: la herramienta declara `today.view` (la
 * tiene todo rol, READONLY incluido) y cada sección se vuelve a gatear con SU
 * key —`billing.view` el dinero, `treatments.view` los planes, `agenda.view`
 * las citas, `patients.view` los pacientes fríos—. Lo que no se puede dar sale
 * en `omitidas` y el motor lo DICE (regla 3). Ver deuda no es ver el
 * expediente: quien solo tiene facturación recibe el dinero y se entera de que
 * le falta lo demás, en vez de recibir media foto con tono de foto entera.
 *
 * ── PACIENTES ARCHIVADOS (hallazgo N19) ────────────────────────────────
 * `canViewPatient` no mira `deletedAt`, así que aquí se filtra a mano: un
 * paciente cancelado por ARCO NO sale en ninguna lista —esto es una lista de a
 * quién llamar, y a ése no se le llama—. Lo que sí sale es CUÁNTOS quedaron
 * fuera y por cuánto (`archivados`), para que nadie tenga que adivinar por qué
 * la suma de la lista no es el total de Finanzas.
 */

import { z } from "zod";
import {
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  pesos,
  pesosDeLista,
  plural,
  tienePermiso,
} from "./base";
import { hoyEnClinica } from "./fechas";
import { round2 } from "@/lib/invoice-totals";
import { prisma } from "@/lib/prisma";
import {
  DIAS_POR_DEFECTO,
  DIA_MS,
  ETIQUETA_ESCAPE,
  TIPOS_ESCAPE,
  TOPE_CAIDAS,
  TOPE_CANDIDATOS,
  TOPE_RESUMEN,
  VENTANA_CAIDAS_DIAS,
  ordenarMezcla,
  type EscapeDb,
  type FilaEscape,
  type TipoEscape,
} from "./oportunidades-criterio";
import {
  pacientesConCitaFutura,
  seccionPorCobrar,
  seccionSinAgendar,
  seccionSinContestar,
  seccionSinReagendar,
  seccionSinRespuesta,
  type SeccionEscape,
} from "./oportunidades-fuentes";
import { pacientesInactivos } from "./pacientes-inactivos";
import type { SeccionOmitida } from "./resumen-clinica";
import { causaSinPermiso } from "../permisos-sabina";
import type { PermissionKey, SabinaCtx } from "../tipos";

export type { EscapeDb, FilaEscape, TipoEscape } from "./oportunidades-criterio";
export type { SeccionEscape } from "./oportunidades-fuentes";

/** `ctx.db` en las pruebas (el doble de dos clínicas), el `prisma` del repo en producción. */
function dbEscapeDe(ctx: SabinaCtx): EscapeDb {
  return (ctx.db ?? prisma) as unknown as EscapeDb;
}

export interface DatosEscape {
  /** Hoy, en el calendario de la clínica. */
  fecha: string;
  /** Días parada que se exigieron para entrar. */
  dias: number;
  /** `null` = se pidieron todas (modo resumen). */
  tipo: TipoEscape | null;
  dinero: {
    /** Facturado y sin cobrar. Dinero DEVENGADO: criterio de Finanzas → Saldos. */
    porCobrar: number;
    /** De eso, lo que ya pasó de su fecha de vencimiento. */
    vencido: number;
    /** Trabajo aceptado y sin agendar, quitando lo que ya está en `porCobrar`. */
    aceptadoSinAgendar: number;
    /** Presupuestos presentados sin contestar. NO se suma: el paciente no dijo que sí. */
    enElAire: number;
    /** `porCobrar + aceptadoSinAgendar`. La ÚNICA cifra que se puede decir en voz alta. */
    total: number;
  };
  /** Qué cuenta y qué no. Viaja SIEMPRE pegado al dinero. */
  notaDinero: string;
  secciones: Partial<Record<TipoEscape, SeccionEscape>>;
  /** Lo primero que hay que perseguir, de todas las secciones juntas y ya ordenado. */
  primero: FilaEscape[];
  /**
   * Lo que quedó FUERA de las listas por estar el paciente cancelado por ARCO.
   * `filas` cuenta FILAS —facturas, presupuestos, citas, solicitudes—, no
   * personas: un mismo paciente con tres facturas cuenta tres. `monto` es solo
   * el saldo YA FACTURADO de esas filas; lo que se le vendió y no se facturó no
   * es dinero devengado y no se mezcla aquí.
   *
   * `exacto: false` = el contador es un MÍNIMO porque alguna sección tocó su
   * tope de candidatos y un archivado pudo quedarse fuera del recorte sin que
   * nadie lo viera. Entonces la frase dice «al menos».
   */
  archivados: { filas: number; monto: number; exacto: boolean };
  /** Los que no vuelven, delegado en `pacientes_inactivos`. `null` si no se pidió o falta permiso. */
  enfriados: { total: number; dias: number; elMasViejo: string | null } | null;
  /** Lo que no se pudo dar, y por qué. Nunca se omite en silencio (regla 3). */
  omitidas: SeccionOmitida[];
}

/** La etiqueta de una sección cuando abre frase. */
function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Viaja pegada al dinero en CADA respuesta, y la descripción le dice al modelo que
 * la diga. Es la frase que convierte una cifra en una cifra defendible.
 */
const NOTA_DINERO =
  "Cuenta: facturas emitidas con saldo (ni borrador ni cancelada) y trabajo aceptado sin agendar, " +
  "restándole a cada paciente lo que ya se le facturó y no ha pagado, para no contar el mismo dinero " +
  "dos veces. NO cuenta: presupuestos sin respuesta, facturas en borrador, citas caídas, solicitudes " +
  "sin contestar ni pacientes sin volver.";

const parametros = z.object({
  /** Qué lista se quiere completa. Sin él, el resumen de todas. */
  tipo: z.enum(["sin_agendar", "sin_respuesta", "por_cobrar", "sin_reagendar", "sin_contestar"]).optional(),
  /** Días parado que tiene que llevar algo para contar. Por defecto 7. */
  dias: z.number().int().min(0).max(3650).optional(),
});

export type ParamsEscape = z.infer<typeof parametros>;

export const oportunidadesPerdidas = definirHerramienta<ParamsEscape, DatosEscape>({
  nombre: "oportunidades_perdidas",
  descripcion:
    "Lo que la clínica ya ganó o ya vendió y se le está escapando: facturas emitidas sin cobrar, " +
    "trabajo que el paciente aceptó y nadie agendó, presupuestos presentados sin respuesta, citas " +
    "caídas que nadie reagendó, gente que pidió cita y nadie le contestó, y pacientes que no " +
    "vuelven. Viene YA ORDENADO por lo que más dinero " +
    "vale y más fácil es de recuperar: respeta ese orden. Úsala para «¿qué se me está escapando?», " +
    "«¿a quién llamo hoy?», «¿dónde estoy perdiendo dinero?». Sin `tipo`, el resumen de todo; con " +
    "`tipo`, esa lista completa. Al dar la cifra di también qué cuenta y qué no (`notaDinero`): " +
    "`enElAire` NO se suma.",
  parametros,
  // La misma key que `resumen_clinica` y por el mismo motivo: la tiene todo rol
  // (READONLY incluido) y cada sección se vuelve a gatear con la suya, así que
  // nadie se queda sin poder preguntar y ningún dato sale sin su permiso.
  permiso: "today.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosEscape> {
    const db = dbEscapeDe(ctx);
    const ahora = new Date();
    const dias = params.dias ?? DIAS_POR_DEFECTO;
    const corte = new Date(ahora.getTime() - dias * DIA_MS);
    const pedidas: TipoEscape[] = params.tipo ? [params.tipo] : TIPOS_ESCAPE;
    const esResumen = !params.tipo;

    const omitidas: SeccionOmitida[] = [];
    const puede = (seccion: string, permiso: PermissionKey): boolean => {
      if (tienePermiso(ctx, permiso)) return true;
      const causa = causaSinPermiso(ctx, permiso);
      omitidas.push(causa === "usuario" ? { seccion, permiso } : { seccion, permiso, causa });
      return false;
    };

    // 🔴 Los permisos se resuelven ANTES de consultar: sin la key no sale ni un
    // dato de esa tabla. Y solo se pregunta por las keys que hacen falta para lo
    // que se ha pedido: pedir `por_cobrar` no puede hacer que Sabina se queje de
    // que le falta `agenda.view`.
    //
    // ⚠️ UNA EXCEPCIÓN, y hay que saberla: `pacientesConCitaFutura` lee la tabla
    // de citas SIN exigir `agenda.view`. No es un descuido: es un cruce de
    // EXISTENCIA («¿este paciente ya está agendado?») del que no sale ni una
    // fila, ni una fecha ni un nombre — solo decide si una fila de `sin_agendar`
    // se muestra o no. Gatearlo con `agenda.view` no protegería nada y, peor,
    // haría la respuesta FALSA: sin ese cruce Sabina diría que hay que llamar a
    // gente que ya viene el jueves. Mismo criterio y mismo lugar que
    // `pacientes_inactivos`, que hace esa misma lectura bajo `patients.view`.
    const quiereDinero = pedidas.some((t) => t === "por_cobrar" || t === "sin_respuesta" || t === "sin_agendar");
    const verDinero = quiereDinero ? puede("el dinero (facturas y presupuestos)", "billing.view") : false;
    const verPlanes = pedidas.includes("sin_agendar") ? puede("los planes de tratamiento", "treatments.view") : false;
    // `sin_reagendar` y `sin_contestar` comparten llave (las dos son agenda), así
    // que se pregunta UNA vez: si falta, se anota una sola vez y no dos.
    const quiereAgenda = pedidas.includes("sin_reagendar") || pedidas.includes("sin_contestar");
    const verAgenda = quiereAgenda ? puede("la agenda (citas caídas y solicitudes sin contestar)", "agenda.view") : false;
    const verPacientes = esResumen ? puede("los pacientes que no vuelven", "patients.view") : false;

    // 🔴 EL POOLER MANDA EN EL ORDEN DE LO QUE SIGUE.
    //
    // La regla de la casa es MENOS DE 7 consultas por `Promise.all`, y aquí cada
    // sección lanza las suyas dentro: `por_cobrar` 4, `sin_respuesta` 3,
    // `sin_agendar` 2 (+1), `sin_reagendar` 2 y `sin_contestar` 2. Poner las cinco
    // secciones en un solo `Promise.all` no serían cinco cosas en paralelo: serían TRECE
    // consultas a la vez contra el pooler de Supabase, que es exactamente cómo
    // empiezan los timeouts. Así que las tandas se arman por CONSULTAS, no por
    // secciones, y ninguna pasa de 5.
    const necesitaCitas = pedidas.includes("sin_agendar") && (verDinero || verPlanes);

    // ── Tanda 1 (≤5): las facturas (4) y el cruce de cita futura (1).
    const [porCobrar, conCita] = await Promise.all([
      verDinero && pedidas.includes("por_cobrar")
        ? seccionPorCobrar(db, ctx, ahora, corte, TOPE_CANDIDATOS)
        : Promise.resolve(null),
      necesitaCitas ? pacientesConCitaFutura(db, ctx, ahora) : Promise.resolve({}),
    ]);

    // ── Tanda 2 (≤5): los presupuestos en el aire (3) y las citas caídas (2).
    const [sinRespuesta, sinReagendar] = await Promise.all([
      verDinero && pedidas.includes("sin_respuesta")
        ? seccionSinRespuesta(db, ctx, ahora, corte, TOPE_CANDIDATOS)
        : Promise.resolve(null),
      verAgenda && pedidas.includes("sin_reagendar")
        ? seccionSinReagendar(db, ctx, ahora, dias, VENTANA_CAIDAS_DIAS, TOPE_CAIDAS)
        : Promise.resolve(null),
    ]);

    // ── Tanda 3 (≤4): el trabajo aceptado (2, luego 1) y la gente esperando
    // respuesta (2). El trabajo aceptado va aquí y no antes porque necesita
    // `conCita`, que salió de la tanda 1.
    const [sinAgendar, sinContestar] = await Promise.all([
      necesitaCitas
        ? seccionSinAgendar(db, ctx, ahora, corte, conCita, { verDinero, verPlanes }, TOPE_CANDIDATOS)
        : Promise.resolve(null),
      verAgenda && pedidas.includes("sin_contestar")
        ? // Sin espera: una solicitud sin contestar cuenta desde el primer día
          // (ver la fuente). `dias` solo ensancha la ventana hacia atrás.
          seccionSinContestar(db, ctx, ahora, dias, VENTANA_CAIDAS_DIAS, TOPE_CANDIDATOS)
        : Promise.resolve(null),
    ]);

    // ── Tanda 4 — los que no vuelven. Es la consulta MÁS CARA del catálogo (un
    // groupBy sobre toda la historia de citas de la clínica), así que va sola, la
    // última y SOLO en el resumen: para pedirla a secas ya está
    // `pacientes_inactivos`, con sus 50 filas y su teléfono.
    const inactivos = verPacientes ? await pacientesInactivos.ejecutar(ctx, {}) : null;

    const secciones: Partial<Record<TipoEscape, SeccionEscape>> = {};
    if (porCobrar) secciones.por_cobrar = porCobrar.seccion;
    if (sinRespuesta) secciones.sin_respuesta = sinRespuesta.seccion;
    if (sinAgendar) secciones.sin_agendar = sinAgendar.seccion;
    if (sinReagendar) secciones.sin_reagendar = sinReagendar.seccion;
    if (sinContestar) secciones.sin_contestar = sinContestar.seccion;

    // Lo primero que hay que perseguir, mezclando secciones: cada fila se pesa
    // con la semivida de SU tipo. Se calcula ANTES de recortar el resumen para
    // que la mezcla vea todas las candidatas, no solo las cinco de cada una.
    const todas: FilaEscape[] = [];
    for (const t of TIPOS_ESCAPE) {
      const s = secciones[t];
      if (s) todas.push(...s.lista.filas);
    }
    // 🔴 UNA EXCEPCIÓN al orden, y una sola: si hay alguien esperando respuesta,
    // su fila va la PRIMERA aunque valga 0. No es una grieta en el criterio: el
    // criterio ordena por VALOR y esto es URGENCIA, que es otra cosa. Una
    // persona que pidió cita y no recibe respuesta se va a la clínica de al lado
    // esta semana, y contestarle cuesta cinco minutos; decir «hay 3 esperando» y
    // no dar ni un nombre deja al doctor sin poder hacer lo más barato del día.
    // El resto de la lista sigue el orden de siempre, sin tocar.
    const urgente = secciones.sin_contestar?.lista.filas[0];
    const resto = ordenarMezcla(urgente ? todas.filter((f) => f !== urgente) : todas);
    const primero = urgente
      ? [urgente, ...resto.slice(0, TOPE_RESUMEN - 1)]
      : resto.slice(0, TOPE_RESUMEN);

    // El recorte a 5 por sección se hace DESPUÉS de sumar el dinero: la cifra es
    // la de TODAS las filas, no la de las cinco que se enseñan.
    if (esResumen) {
      for (const t of TIPOS_ESCAPE) {
        const s = secciones[t];
        if (s) secciones[t] = { ...s, lista: { ...s.lista, filas: s.lista.filas.slice(0, TOPE_RESUMEN) } };
      }
    }

    const archivados = {
      filas:
        (porCobrar?.archivados.filas ?? 0) +
        (sinRespuesta?.archivados.filas ?? 0) +
        (sinAgendar?.archivados.filas ?? 0) +
        (sinReagendar?.archivados.filas ?? 0) +
        (sinContestar?.archivados.filas ?? 0),
      // Solo el saldo YA FACTURADO, y por eso sale de una sola sección: es el
      // único dinero devengado que existe. Lo que se le vendió a un archivado y
      // no se le facturó, o lo que tenía en el aire, no es dinero que la clínica
      // haya ganado, y sumarlo aquí mezclaría dos clases de peso en una cifra
      // que el doctor va a leer como «esto es lo que dejé fuera».
      monto: round2(porCobrar?.archivados.monto ?? 0),
      // Basta con que UNA sección haya contado a ciegas para que el total sea un
      // mínimo. Es la misma regla que el dinero: si puede quedarse corto, se dice.
      exacto: [porCobrar, sinRespuesta, sinAgendar, sinReagendar, sinContestar].every(
        (f) => !f || f.archivados.exacto,
      ),
    };

    const aCobrar = porCobrar?.seccion.dinero ?? 0;
    const aceptado = sinAgendar?.seccion.dinero ?? 0;

    return {
      fecha: hoyEnClinica(ctx.timezone),
      dias,
      tipo: params.tipo ?? null,
      dinero: {
        porCobrar: aCobrar,
        vencido: porCobrar?.vencido ?? 0,
        aceptadoSinAgendar: aceptado,
        enElAire: sinRespuesta?.seccion.dinero ?? 0,
        total: round2(aCobrar + aceptado),
      },
      notaDinero: NOTA_DINERO,
      secciones,
      primero,
      archivados,
      enfriados: inactivos
        ? {
            total: inactivos.inactivos.total,
            dias: inactivos.dias,
            elMasViejo: inactivos.inactivos.filas[0]?.paciente ?? null,
          }
        : null,
      omitidas,
    };
  },

  /**
   * NUNCA es «sin datos». «No se te está escapando nada» es la mejor respuesta
   * que puede dar esta herramienta, y el runner la convertiría en «no tengo
   * datos», que es otra cosa muy distinta. Y si todo quedó omitido por permisos,
   * eso también hay que poder decirlo (regla 3).
   */
  vacio: () => false,

  resumir(d) {
    const partes: string[] = [];

    // 🔴 Los que esperan respuesta van los PRIMEROS de la frase aunque valgan 0
    // en el orden. Urgencia y valor no son lo mismo: esto se arregla en cinco
    // minutos y mañana ya no está.
    const esperando = d.secciones.sin_contestar?.lista.total ?? 0;
    if (esperando > 0) {
      partes.push(
        `${plural(esperando, "persona está esperando", "personas están esperando")} respuesta ` +
          "(pidieron cita o pidieron mover la suya y nadie les ha contestado)",
      );
    }

    // `por_cobrar` y `enElAire` salen de un `aggregate` y son exactos. El único
    // que puede quedarse corto es `sin_agendar`, cuyos dos filtros se resuelven
    // en memoria sobre un tope de candidatos: si se tocó, la cifra es un MÍNIMO
    // y se dice «al menos». Redondear hacia abajo y avisar es la única forma
    // honesta de equivocarse aquí.
    const minimo = d.secciones.sin_agendar?.aproximado ? "al menos " : "";
    if (d.dinero.total > 0) {
      const trozos: string[] = [];
      if (d.dinero.porCobrar > 0) {
        const venc = d.dinero.vencido > 0 ? ` (${pesos(d.dinero.vencido)} ya vencidos)` : "";
        trozos.push(`${pesos(d.dinero.porCobrar)} facturados sin cobrar${venc}`);
      }
      if (d.dinero.aceptadoSinAgendar > 0) {
        trozos.push(`${minimo}${pesos(d.dinero.aceptadoSinAgendar)} de trabajo aceptado que nadie agendó`);
      }
      partes.push(`se te escapan ${minimo}${pesos(d.dinero.total)}: ${trozos.join(" y ")}`);
    }
    if (d.dinero.enElAire > 0) {
      const n = d.secciones.sin_respuesta?.lista.total ?? 0;
      // "aparte" solo si hay algo aparte de lo que sea: si esto es lo único que
      // se pidió, la frase tiene que sostenerse sola.
      const prefijo = d.dinero.total > 0 ? "aparte, " : "hay ";
      partes.push(
        `${prefijo}${pesos(d.dinero.enElAire)} en ${plural(n, "presupuesto presentado sin respuesta", "presupuestos presentados sin respuesta")}` +
          " (nadie ha dicho que sí: NO se suma)",
      );
    }
    // Es UNA fila por paciente, no por cita: decir "3 citas caídas" cuando son
    // tres de la misma persona convierte una llamada en tres.
    const caidas = d.secciones.sin_reagendar?.lista.total ?? 0;
    if (caidas > 0) {
      partes.push(plural(caidas, "paciente con cita caída sin reagendar", "pacientes con citas caídas sin reagendar"));
    }
    if (d.enfriados && d.enfriados.total > 0) {
      const quien = d.enfriados.elMasViejo ? `, el más antiguo ${d.enfriados.elMasViejo}` : "";
      partes.push(`${plural(d.enfriados.total, "paciente", "pacientes")} sin volver en ${d.enfriados.dias} días${quien}`);
    }

    // La lista de «a quién llamo hoy»: una línea por fila y con su teléfono. Sin
    // ella el modelo copia la forma del resumen y lo suelta todo en una línea
    // separado por comas (lo que le pasó a Rafael el 14-sep-2026).
    const seccionPedida = d.tipo ? d.secciones[d.tipo] : undefined;
    const filas = d.tipo ? seccionPedida?.lista.filas ?? [] : d.primero;

    // 🔴 «No se te está escapando nada» solo se puede decir si DE VERDAD no hay
    // nada. Había un caso en que la frase salía con una lista de nombres justo
    // debajo: se pide una sección concreta, todas sus filas están ya facturadas
    // (valen 0, su dinero está contado en las facturas por cobrar) y ninguna
    // otra sección aporta cifra. `partes` quedaba vacío —el dinero es 0— pero
    // las filas seguían ahí. La cabecera afirmaba que no había a quién llamar y
    // la línea siguiente daba nombre y teléfono. Cada fila que se enseña tiene
    // que estar representada en la frase de arriba.
    const todasFacturadas = filas.length > 0 && filas.every((f) => f.yaFacturado);
    const cabecera =
      partes.length > 0
        ? `${d.fecha}: ${partes.join("; ")}.`
        : filas.length === 0
          ? `${d.fecha}: no se te está escapando nada de lo que sé mirar.`
          : todasFacturadas
            ? `${d.fecha}: no hay dinero NUEVO que sumar aquí —lo que sale ya está contado en tus facturas ` +
              `por cobrar—, pero ese trabajo sigue sin agendar y hay que llamar.`
            : `${d.fecha}: sin dinero que sumar, pero sí ${plural(filas.length, "cosa que perseguir", "cosas que perseguir")}.`;
    const monto = pesosDeLista(filas.map((f) => f.valor));
    const lista = lineasDeLista(filas, (f) => {
      const importe = f.valor > 0 ? `${monto(f.valor)} — ` : f.yaFacturado ? "ya facturado — " : "";
      const tel = f.telefono ? `, tel. ${f.telefono}` : "";
      return `${f.paciente} — ${importe}${f.detalle}, ${plural(f.dias, "día", "días")} parado${tel}`;
    });
    const encabeza = lista
      ? d.tipo && seccionPedida
        ? ` ${mayuscula(ETIQUETA_ESCAPE[d.tipo])}${fraseRecorte(seccionPedida.lista, "filas")}, de lo más recuperable a lo menos:`
        : " Primero esto, de lo más recuperable a lo menos:"
      : "";
    const unaSola =
      !lista && filas[0]
        ? ` Lo primero: ${filas[0].paciente} — ${filas[0].detalle}${filas[0].valor > 0 ? ` (${pesos(filas[0].valor)})` : ""}.`
        : "";

    // Detrás de una lista, las coletillas van en su propia línea: pegadas al
    // último «- …» el modelo las lee como parte de esa fila y se las cuelga a un
    // paciente que no tiene nada que ver.
    const aparte = lista ? "\n" : " ";

    // 🔴 Cuenta FILAS (facturas, presupuestos, citas, solicitudes), no personas:
    // un mismo paciente archivado con tres facturas son tres. Decir «3 pacientes
    // archivados» sería falso, y contar personas exigiría cruzar cinco
    // consultas distintas. Así que se dice lo que es.
    const arco =
      d.archivados.filas > 0
        ? `${aparte}Dejé fuera ${d.archivados.exacto ? "" : "al menos "}${plural(d.archivados.filas, "cosa", "cosas")} de pacientes cancelados por ARCO` +
          `${d.archivados.monto > 0 ? `, ${pesos(d.archivados.monto)} de saldo entre ellas` : ""}: a esos pacientes no se les llama.`
        : "";

    const falta =
      d.omitidas.length > 0
        ? `${aparte}NO tienes acceso a: ${d.omitidas.map((o) => `${o.seccion} (falta ${o.permiso})`).join(", ")} — dilo, no lo presentes como que no hay nada.`
        : "";

    return `${cabecera}${encabeza}${lista}${unaSola}${arco}${falta}`;
  },
});
