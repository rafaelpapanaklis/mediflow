/**
 * Las cuatro fuentes de `oportunidades_perdidas`: una función por fuga, cada una
 * con SU criterio explicado y SU aislamiento.
 *
 * Vive aparte de la herramienta para que el archivo de arriba sea legible de un
 * tirón: allí está el QUÉ (el orden, el dinero, los permisos), aquí el CÓMO
 * (los `where`, los topes y los cruces).
 *
 * 🔴 Lo que se repite en las cuatro, y por qué:
 *
 *  · `clinicId` SIEMPRE de la sesión, nunca de un parámetro (regla 2).
 *  · La visibilidad por paciente, con el helper de relación que usan las rutas
 *    del panel (`relatedPatientVisibilityAnd`): un paciente restringido no sale
 *    por la puerta de atrás de los presupuestos ni de los planes.
 *  · `patient.deletedAt: null` A MANO. `canViewPatient` NO lo mira (hallazgo
 *    N19) y ninguno de estos helpers lo añade; esto es una lista de a quién
 *    llamar, y a un paciente cancelado por ARCO no se le llama. Lo excluido se
 *    cuenta y se devuelve (`archivados`), nunca se tira en silencio.
 *  · Un tope de candidatos, pidiendo SIEMPRE los más caros (o los más recientes
 *    donde no hay dinero) primero, para que lo que se pierda al recortar sea lo
 *    barato. Si se toca el tope, `aproximado: true`.
 */

import { buildAppointmentWhere } from "@/lib/auth-context";
import { overdueInvoiceWhere, receivableInvoiceWhere } from "@/lib/caja";
import { round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { comoAuthContext, recortar, tienePermiso, visorDe, type Lista } from "./base";
import { ESTADOS_ACTIVOS } from "./estados";
import { fechaDe, inicioDeHoy } from "./fechas";
import {
  DIA_MS,
  GRACIA_CAIDAS_DIAS,
  ordenarPorPrioridad,
  type EscapeDb,
  type FilaEscape,
  type TipoEscape,
} from "./oportunidades-criterio";
import type { SabinaCtx } from "../tipos";

/** Una sección ya resuelta: sus filas ordenadas, su dinero y si el total es un mínimo. */
export interface SeccionEscape {
  lista: Lista<FilaEscape>;
  /**
   * El dinero de la sección, ya redondeado.
   *
   * En `por_cobrar` y `sin_respuesta` sale de un `aggregate` sobre TODAS las
   * filas que cumplen el criterio, no solo sobre las que caben en el tope: es
   * exacto. En `sin_agendar` se suma en memoria —sus dos filtros no se pueden
   * escribir en el `where`— y las filas `yaFacturado` aportan 0, así que puede
   * quedarse CORTO si se tocó el tope; eso es lo que avisa `aproximado`. En
   * `sin_reagendar` es siempre 0: una cita caída no lleva dinero.
   */
  dinero: number;
  /** `true` si el total (y el dinero) son un MÍNIMO porque se tocó el tope de candidatos. */
  aproximado: boolean;
}

/** Lo que devuelve cada fuente: la sección ya armada y lo que dejó fuera ARCO. */
export interface Fuente {
  seccion: SeccionEscape;
  /**
   * Lo que se descartó por estar el paciente cancelado por ARCO.
   *
   * 🔴 `exacto: false` significa que ese contador es un MÍNIMO. Pasa en las tres
   * secciones que cuentan los archivados EN MEMORIA, recorriendo filas que ya
   * vienen recortadas por el tope de candidatos: si el archivado se quedó fuera
   * del recorte, nunca se le ve. `por_cobrar` y `sin_respuesta` no tienen ese
   * problema —cuentan con un `aggregate` sin tope— y son siempre exactas.
   *
   * El resto de la herramienta dice «al menos» cada vez que una cifra puede
   * quedarse corta; éste era el único contador que se presentaba como cerrado
   * sin serlo.
   */
  archivados: { filas: number; monto: number; exacto: boolean };
  /** Solo `por_cobrar`: de lo por cobrar, cuánto ya pasó de su fecha de vencimiento. */
  vencido?: number;
}

/** El `select` del paciente que necesita una fila: nombre, folio, teléfono y ARCO. */
const SELECT_PACIENTE = {
  select: { firstName: true, lastName: true, patientNumber: true, phone: true, deletedAt: true },
} as const;

/**
 * El teléfono, SOLO si quien pregunta tiene `patients.view`.
 *
 * Ver una deuda no es ver la ficha del paciente. `pacientes_con_deuda` —misma
 * llave `billing.view`— no devuelve teléfono; `pacientes_inactivos` sí, pero
 * pidiendo `patients.view`. Sin este corte, un usuario al que el Super Admin le
 * dejó solo facturación (el perfil «contable») se llevaba el teléfono de todos
 * los pacientes con saldo por una puerta que no es la suya. Los cinco roles
 * traen las dos llaves por default, así que esto solo muerde con un override —
 * que es exactamente para lo que existe el modal de Permisos.
 */
function telefonoDe(ctx: SabinaCtx, p: any): string | null {
  return tienePermiso(ctx, "patients.view") ? p?.phone ?? null : null;
}

function nombreDe(p: any): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim() || "Paciente sin nombre";
}

function dias(desde: Date | string | null | undefined, ahora: Date): number {
  if (!desde) return 0;
  const t = desde instanceof Date ? desde.getTime() : new Date(desde).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / DIA_MS));
}

/**
 * «Lleva parado desde antes del corte», mirando una fecha de hito que EN TEORÍA
 * siempre existe (las dos rutas que aceptan un presupuesto escriben `acceptedAt`,
 * y la que lo presenta escribe `presentedAt`) pero que una importación o una fila
 * vieja puede traer vacía.
 *
 * 🔴 No es prudencia decorativa. Con `campo: { lt: corte }` a secas, Prisma
 * DESCARTA las filas con la fecha nula (lógica de tres valores de SQL), y en
 * `sin_agendar` eso no sería solo perder una fila: el presupuesto desaparecido
 * es el que dice si el plan que nació de él YA ESTÁ FACTURADO, así que ese plan
 * volvería a contar un dinero que ya está en `por_cobrar`. Un dato a medias se
 * convertiría en una cifra inflada, que es lo único que esta herramienta no se
 * puede permitir. Con el respaldo en `createdAt` la fila sigue entrando.
 */
function paradoDesde(campo: string, corte: Date): Record<string, any> {
  return {
    OR: [{ [campo]: { lt: corte } }, { AND: [{ [campo]: null }, { createdAt: { lt: corte } }] }],
  };
}

function num(x: unknown): number {
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

/** El fragmento de visibilidad por paciente, listo para meter en un `AND`. */
function visibilidad(ctx: SabinaCtx): Record<string, any>[] {
  return relatedPatientVisibilityAnd(visorDe(ctx));
}

/** Arma la sección a partir de las filas ya construidas y ordenadas. */
function armar(filas: FilaEscape[], tipo: TipoEscape, total: number, aproximado: boolean, dinero: number): SeccionEscape {
  return { lista: recortar(ordenarPorPrioridad(filas, tipo), total), dinero: round2(dinero), aproximado };
}

/* ═══════════════════════════════════════════════════════════════════════
   QUIÉN TIENE CITA FUTURA — el cruce que comparten dos fuentes
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Los pacientes de la clínica con al menos una cita futura no cancelada.
 *
 * 🔴 Va por `clinicId` pelado y NO por `buildAppointmentWhere`, a propósito y al
 * revés de lo habitual: a un DOCTOR ese builder le deja solo SUS citas, y
 * entonces un paciente agendado con la doctora de al lado parecería «sin
 * agendar». Eso fabricaría una oportunidad FALSA, que es peor que esconder una
 * verdadera: el doctor llama a alguien que ya viene el jueves y deja de creerse
 * la lista. Es la misma decisión —y el mismo comentario— que `pacientes_inactivos`.
 */
export async function pacientesConCitaFutura(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
): Promise<Record<string, true>> {
  const filas = await db.appointment.findMany({
    where: {
      clinicId: ctx.clinicId,
      startsAt: { gte: ahora },
      status: { notIn: [...ESTADOS_ACTIVOS] },
    },
    select: { patientId: true },
    distinct: ["patientId"],
  });
  const out: Record<string, true> = {};
  for (const a of filas as any[]) if (a.patientId) out[a.patientId] = true;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   1 · FACTURAS POR COBRAR — el dinero que la clínica YA GANÓ
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * `receivableInvoiceWhere` de @/lib/caja: emitida (ni DRAFT ni CANCELLED) y con
 * saldo. Es el criterio del KPI de Finanzas → Saldos, no uno nuevo.
 *
 * ── POR QUÉ NO ES `pacientes_con_deuda` OTRA VEZ ───────────────────────
 * Aquella agrupa POR PACIENTE y cuenta también los BORRADORES (es el where de
 * la columna «Saldo» de /dashboard/patients). Ésta va POR FACTURA y deja los
 * borradores fuera: un borrador no se le ha pasado al paciente, así que no es
 * dinero que se esté escapando — es dinero que aún no se ha pedido. Contarlo
 * inflaría la cifra, que es justo lo que no puede pasar aquí.
 *
 * La antigüedad se mide desde que se EMITIÓ (`createdAt`), que siempre existe, y
 * no desde `dueDate`, que es opcional. El vencimiento sí sale del `dueDate` y con
 * el criterio canónico (`overdueInvoiceWhere`), para no inventar un tercer
 * número que no esté en ninguna pantalla.
 */
/**
 * 🔴 El `where` de «facturado y sin cobrar», en UNA sola función.
 *
 * Lo usan DOS sitios: la sección `por_cobrar` y el tope por paciente de
 * `sin_agendar`. Que sea literalmente el mismo `where` es lo que hace que la
 * cuenta cuadre: lo que se resta allí es EXACTAMENTE lo que se suma aquí, ni un
 * peso más ni uno menos. Si los dos criterios se separaran, aparecería dinero
 * contado dos veces (si el de allí fuera más estrecho) o dinero desaparecido de
 * las dos cifras (si fuera más ancho).
 */
function wherePorCobrar(ctx: SabinaCtx, corte: Date): Record<string, any> {
  const vis = visibilidad(ctx);
  return {
    ...receivableInvoiceWhere(ctx.clinicId),
    // `dias` como «antigüedad mínima»: una factura de anteayer todavía no se
    // está escapando. Con `dias: 0` el total coincide exactamente con Finanzas.
    createdAt: { lt: corte },
    ...(vis.length ? { AND: vis } : {}),
  };
}

export async function seccionPorCobrar(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
  corte: Date,
  tope: number,
): Promise<Fuente> {
  const vis = visibilidad(ctx);
  const base = wherePorCobrar(ctx, corte);
  const llamables = { ...base, patient: { is: { deletedAt: null } } };
  const archivadas = { ...base, patient: { is: { deletedAt: { not: null } } } };

  const [resumen, vencidas, arco, filasCrudas] = await Promise.all([
    db.invoice.aggregate({ _sum: { balance: true }, _count: true, where: llamables }),
    db.invoice.aggregate({
      _sum: { balance: true },
      where: {
        ...overdueInvoiceWhere(ctx.clinicId, inicioDeHoy(ctx.timezone)),
        createdAt: { lt: corte },
        patient: { is: { deletedAt: null } },
        ...(vis.length ? { AND: vis } : {}),
      },
    }),
    db.invoice.aggregate({ _sum: { balance: true }, _count: true, where: archivadas }),
    db.invoice.findMany({
      where: llamables,
      select: {
        invoiceNumber: true,
        balance: true,
        dueDate: true,
        createdAt: true,
        patient: SELECT_PACIENTE,
      },
      orderBy: { balance: "desc" },
      take: tope,
    }),
  ]);

  const hoy = inicioDeHoy(ctx.timezone).getTime();
  const filas: FilaEscape[] = (filasCrudas as any[]).map((f) => {
    const vencidaEl = f.dueDate ? new Date(f.dueDate) : null;
    const vencida = vencidaEl !== null && vencidaEl.getTime() < hoy;
    return {
      tipo: "por_cobrar" as const,
      paciente: nombreDe(f.patient),
      folio: f.patient?.patientNumber ?? null,
      telefono: telefonoDe(ctx, f.patient),
      valor: round2(num(f.balance)),
      dias: dias(f.createdAt, ahora),
      detalle:
        // `invoiceNumber` es obligatorio en el esquema; el `??` es para que una
        // fila a medias (un doble de prueba, una importación) no imprima "null"
        // donde el doctor espera un folio con el que buscar la factura.
        `factura ${f.invoiceNumber ?? "sin folio"}` +
        (vencidaEl ? `, ${vencida ? "vencida" : "vence"} el ${fechaDe(vencidaEl, ctx.timezone)}` : ", sin fecha de vencimiento"),
    };
  });

  const total = num((resumen as any)?._count);
  return {
    // `aproximado: false` SIEMPRE, y no es un descuido: este dinero sale de un
    // `aggregate` sobre todas las filas, así que es exacto aunque la LISTA venga
    // recortada. Lo del recorte ya lo dice `lista.truncado` («van 50 de 300»).
    // `aproximado` significa una sola cosa en toda la herramienta: «el DINERO es
    // un suelo». Marcar aquí un recorte de lista haría que el resumen dijera «al
    // menos $X» de una cifra que es exacta.
    seccion: armar(filas, "por_cobrar", total, false, num((resumen as any)?._sum?.balance)),
    archivados: { filas: num((arco as any)?._count), monto: round2(num((arco as any)?._sum?.balance)), exacto: true },
    vencido: round2(num((vencidas as any)?._sum?.balance)),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   2 · PRESUPUESTOS SIN RESPUESTA — lo que está EN EL AIRE
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Presentados y sin contestar: `status` PRESENTED o EXPIRED, `presentedAt`
 * anterior al corte. Ni aceptados ni rechazados: esos dos tienen su fecha y ya
 * no están en el aire.
 *
 * EXPIRED entra porque es EXACTAMENTE la misma situación —nadie contestó—, solo
 * que además se le pasó la vigencia. Y porque el paso a EXPIRED es PEREZOSO: lo
 * hace `GET /api/quotes` cuando alguien abre la pestaña de ese paciente, así que
 * la base está llena de PRESENTED con la vigencia pasada. Mirar solo el `status`
 * daría dos poblaciones distintas según quién hubiera abierto qué pantalla. El
 * `vencido` de cada fila se calcula aquí, contra `validUntil`, y no se cree el
 * status.
 *
 * 🔴 Su dinero NO se suma al total: el paciente no ha dicho que sí. Va en un
 * cubo aparte (`enElAire`) y la herramienta obliga a decirlo.
 */
export async function seccionSinRespuesta(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
  corte: Date,
  tope: number,
): Promise<Fuente> {
  const vis = visibilidad(ctx);
  const base: Record<string, any> = {
    clinicId: ctx.clinicId,
    status: { in: ["PRESENTED", "EXPIRED"] },
    ...paradoDesde("presentedAt", corte),
    ...(vis.length ? { AND: vis } : {}),
  };
  const llamables = { ...base, patient: { is: { deletedAt: null } } };
  const archivados = { ...base, patient: { is: { deletedAt: { not: null } } } };

  // El dinero y el total salen de un `aggregate` sobre TODAS las filas, no de
  // las que caben en el tope: `enElAire` es una cifra que el doctor va a repetir
  // en voz alta, y «$10,200,000 en 3,200 presupuestos» cuando los $10,200,000
  // son solo los 500 mayores es una mentira aritmética aunque los dos números
  // sean ciertos por separado.
  const [resumen, arco, filasCrudas] = await Promise.all([
    db.quote.aggregate({ _sum: { total: true }, _count: true, where: llamables }),
    db.quote.aggregate({ _sum: { total: true }, _count: true, where: archivados }),
    db.quote.findMany({
      where: llamables,
      select: {
        folio: true,
        title: true,
        total: true,
        presentedAt: true,
        createdAt: true,
        validUntil: true,
        patient: SELECT_PACIENTE,
      },
      orderBy: { total: "desc" },
      take: tope,
    }),
  ]);

  const filas: FilaEscape[] = (filasCrudas as any[]).map((q) => {
    const valor = round2(num(q.total));
    // Contra el INICIO DE HOY en la clínica, igual que «vencida» en por_cobrar:
    // con `ahora` a secas, un presupuesto que vence hoy salía «ya caducado»
    // durante todo su último día válido. Dos criterios de vencimiento en la
    // misma respuesta es una contradicción que el doctor sí nota.
    const vence = q.validUntil ? new Date(q.validUntil) : null;
    const caducado = vence !== null && vence.getTime() < inicioDeHoy(ctx.timezone).getTime();
    return {
      tipo: "sin_respuesta" as const,
      paciente: nombreDe(q.patient),
      folio: q.patient?.patientNumber ?? null,
      telefono: telefonoDe(ctx, q.patient),
      valor,
      dias: dias(q.presentedAt ?? q.createdAt, ahora),
      detalle: `presupuesto ${q.folio} «${String(q.title ?? "").slice(0, 60)}»${caducado ? ", ya caducado" : ""}`,
    };
  });

  const total = num((resumen as any)?._count);
  return {
    seccion: armar(filas, "sin_respuesta", total, false, num((resumen as any)?._sum?.total)),
    // `monto: 0` a propósito: `archivados.monto` explica lo que se cayó del
    // TOTAL, y lo que está en el aire nunca estuvo en el total. Sumar aquí el
    // valor de unos presupuestos sin contestar mezclaría dos clases de dinero
    // en una sola cifra. El paciente archivado sí se CUENTA.
    archivados: { filas: num((arco as any)?._count), monto: 0, exacto: true },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   3 · TRABAJO ACEPTADO SIN AGENDAR — lo más caro que se pierde
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Dos poblaciones que son la misma cosa vista por sus dos caras, y por eso van
 * juntas y DEDUPLICADAS:
 *
 *  · el PLAN DE TRATAMIENTO ACTIVO con sesiones pendientes cuya próxima sesión
 *    ya debía haber caído (`nextExpectedDate` pasada) y cuyo paciente no tiene
 *    ninguna cita futura;
 *  · el PRESUPUESTO ACEPTADO que nunca llegó a plan (`treatmentPlanId` vacío) y
 *    cuyo paciente tampoco tiene cita.
 *
 * La deduplicación es por `quote.treatmentPlanId`: si el presupuesto ya parió su
 * plan, manda el PLAN (que sabe cuántas sesiones faltan) y el presupuesto no se
 * cuenta. Efecto lateral buscado: si ese plan se marcó COMPLETED o ABANDONED, el
 * presupuesto tampoco vuelve por la puerta de atrás — se dio por cerrado, y
 * resucitarlo aquí sería inventar dinero.
 *
 * De un plan solo se cuenta la parte PENDIENTE: `totalCost × faltan ÷ totales`.
 * Lo ya hecho o está cobrado o está en una factura.
 *
 * ═══ 🔴 EL TOPE POR PACIENTE: POR QUÉ NINGÚN PESO SE CUENTA DOS VECES ═══
 *
 * Éste es el corazón de la honestidad de la cifra, y costó dos intentos.
 *
 * El primero fue seguir el enlace `presupuesto → factura` y poner a cero la fila
 * cuando esa factura estaba viva. Se rompía por los dos lados:
 *
 *  · si la clínica tiene más presupuestos aceptados que el tope de candidatos,
 *    el presupuesto que dice «este plan ya está facturado» puede caerse de la
 *    consulta, y entonces el plan volvía a sumar un dinero que ya estaba en
 *    `por_cobrar`. Contado dos veces;
 *  · y un plan creado A MANO no tiene presupuesto detrás, así que no había nada
 *    que mirar. En ortodoncia lo normal es emitir la factura del tratamiento
 *    ENTERO y cobrarlo en parcialidades: el saldo está íntegro en `por_cobrar` y
 *    el plan sumaba otra vez su parte pendiente.
 *
 * Lo que hay ahora no depende de ningún enlace. Es aritmética: **por cada
 * paciente, de lo que se le ha vendido y no está agendado se RESTA lo que ya se
 * le facturó y no ha pagado.**
 *
 *     aporta(paciente) = max(0, pendiente(paciente) − saldoYaFacturado(paciente))
 *
 * Y `saldoYaFacturado` se pide con EXACTAMENTE el mismo `where` que la sección
 * `por_cobrar` (`wherePorCobrar`). Eso da las dos garantías a la vez:
 *
 *  · ningún peso se cuenta dos veces — lo que está en `porCobrar` se resta aquí;
 *  · ningún peso desaparece — lo que NO entra en `porCobrar` (una factura recién
 *    emitida, más nueva que el corte) tampoco se resta, así que sigue contando
 *    aquí. Las dos cifras se reparten el dinero; no se solapan ni dejan hueco.
 *
 * La fila se marca `yaFacturado` cuando el tope se comió su importe entero: sale
 * igual —el trabajo SIGUE sin agendar y hay que llamar— pero valiendo 0.
 *
 * El precio de esta honestidad es que la cifra puede quedarse CORTA: si el
 * paciente debe $500 de una limpieza que no tiene nada que ver, esos $500 se
 * restan igual de su plan de $30,000. Se prefiere quedarse corto: es el lado por
 * el que hay que equivocarse cuando lo que está en juego es la confianza.
 *
 * ── PERMISOS ───────────────────────────────────────────────────────────
 * Cada mitad con su key: los planes con `treatments.view`, los presupuestos con
 * `billing.view`. Quien solo tenga una recibe esa mitad y se entera de la otra.
 * Y a un DOCTOR se le acotan SUS planes, igual que `GET /api/treatments`.
 *
 * ⚠️ El tope por paciente necesita leer facturas, así que **solo se aplica si
 * quien pregunta tiene `billing.view`**. Sin esa llave no hay `por_cobrar` con
 * el que solapar —no se le está enseñando ninguna cifra de facturas— así que no
 * hay nada que restar y la cuenta sigue siendo correcta.
 */
export async function seccionSinAgendar(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
  corte: Date,
  conCita: Record<string, true>,
  puede: { verDinero: boolean; verPlanes: boolean },
  tope: number,
): Promise<Fuente> {
  const vis = visibilidad(ctx);
  const auth = comoAuthContext(ctx);

  const [planes, presupuestos] = await Promise.all([
    puede.verPlanes
      ? db.treatmentPlan.findMany({
          where: {
            clinicId: ctx.clinicId,
            status: "ACTIVE",
            // Mismo scope que GET /api/treatments: el doctor ve SUS planes.
            ...(auth.isDoctor ? { doctorId: ctx.userId } : {}),
            // 🔴 Los archivados NO se filtran aquí: se descartan abajo para poder
            // CONTARLOS. Tirarlos en el `where` era lo que hacía que el trabajo
            // aceptado de un paciente cancelado por ARCO —la sección que más
            // dinero mueve— se evaporara sin dejar rastro en `archivados`.
            ...(vis.length ? { AND: vis } : {}),
          },
          select: {
            id: true,
            name: true,
            totalCost: true,
            totalSessions: true,
            startDate: true,
            nextExpectedDate: true,
            patientId: true,
            sessions: { select: { completedAt: true } },
            patient: SELECT_PACIENTE,
          },
          orderBy: { totalCost: "desc" },
          take: tope,
        })
      : Promise.resolve([]),
    puede.verDinero
      ? db.quote.findMany({
          where: {
            clinicId: ctx.clinicId,
            status: "ACCEPTED",
            ...paradoDesde("acceptedAt", corte),
            ...(vis.length ? { AND: vis } : {}),
          },
          select: {
            folio: true,
            title: true,
            total: true,
            acceptedAt: true,
            createdAt: true,
            patientId: true,
            treatmentPlanId: true,
            patient: SELECT_PACIENTE,
          },
          orderBy: { total: "desc" },
          take: tope,
        })
      : Promise.resolve([]),
  ]);

  /* ── 1ª pasada: qué se le ha vendido a cada paciente y no está agendado ── */

  interface Candidata {
    fila: FilaEscape;
    patientId: string;
    bruto: number;
  }
  const candidatas: Candidata[] = [];
  let archivados = 0;

  for (const p of planes as any[]) {
    if (p.patient?.deletedAt) {
      archivados++;
      continue;
    }
    if (conCita[p.patientId]) continue; // ya viene: no se ha perdido nada
    const totales = Math.max(0, num(p.totalSessions));
    const hechas = ((p.sessions ?? []) as any[]).filter((s) => s?.completedAt).length;
    const faltan = totales > 0 ? totales - hechas : 0;
    if (faltan <= 0) continue;

    // La referencia es la fecha en que DEBÍA haber sido la próxima sesión. Si
    // aún no ha llegado, no se ha caído nada todavía.
    const referencia = p.nextExpectedDate ? new Date(p.nextExpectedDate) : p.startDate ? new Date(p.startDate) : null;
    if (!referencia || referencia.getTime() > corte.getTime()) continue;

    const pendiente = totales > 0 ? round2((num(p.totalCost) * faltan) / totales) : 0;
    candidatas.push({
      patientId: p.patientId,
      bruto: pendiente,
      fila: {
        tipo: "sin_agendar",
        paciente: nombreDe(p.patient),
        folio: p.patient?.patientNumber ?? null,
        telefono: telefonoDe(ctx, p.patient),
        valor: pendiente,
        dias: dias(referencia, ahora),
        detalle: `plan «${String(p.name ?? "").slice(0, 60)}», ${faltan} de ${totales} sesiones sin hacer y sin cita`,
      },
    });
  }

  for (const q of presupuestos as any[]) {
    if (q.patient?.deletedAt) {
      archivados++;
      continue;
    }
    // 🔴 Si el presupuesto ya parió un plan, lo representa EL PLAN y este
    // presupuesto no vuelve a salir. Se mira su propia columna y no si ese plan
    // apareció arriba, y eso es a propósito: cuando el plan NO aparece es porque
    // se dio por COMPLETED o ABANDONED, porque ya tiene cita, o porque a quien
    // pregunta le falta `treatments.view`. En los tres casos dejar pasar el
    // presupuesto SUMARÍA un dinero que no se está escapando. Se prefiere
    // quedarse corto, y la falta de permiso se dice en `omitidas`.
    if (q.treatmentPlanId) continue;
    if (conCita[q.patientId]) continue;
    const valor = round2(num(q.total));
    candidatas.push({
      patientId: q.patientId,
      bruto: valor,
      fila: {
        tipo: "sin_agendar",
        paciente: nombreDe(q.patient),
        folio: q.patient?.patientNumber ?? null,
        telefono: telefonoDe(ctx, q.patient),
        valor,
        dias: dias(q.acceptedAt ?? q.createdAt, ahora),
        detalle: `presupuesto ${q.folio} «${String(q.title ?? "").slice(0, 60)}» aceptado y sin agendar`,
      },
    });
  }

  /* ── 2ª pasada: restar lo que a ese paciente YA se le facturó ─────────── */

  // Solo los pacientes que de verdad salen, así que la consulta va acotada por
  // `in` y no barre la tabla. Si no hay candidatas, no se consulta nada.
  const ids = Array.from(new Set(candidatas.map((c) => c.patientId).filter(Boolean)));
  const yaFacturado: Record<string, number> = {};
  if (puede.verDinero && ids.length > 0) {
    const porPaciente = await db.invoice.groupBy({
      by: ["patientId"],
      where: { ...wherePorCobrar(ctx, corte), patientId: { in: ids } },
      _sum: { balance: true },
    });
    for (const g of porPaciente as any[]) {
      if (g.patientId) yaFacturado[g.patientId] = num(g._sum?.balance);
    }
  }

  const filas: FilaEscape[] = [];
  let dinero = 0;
  for (const c of candidatas) {
    const cupo = yaFacturado[c.patientId] ?? 0;
    // Lo que queda de su crédito tras descontar lo que ya está en `por_cobrar`.
    const descontado = Math.min(cupo, c.bruto);
    yaFacturado[c.patientId] = cupo - descontado;
    const neto = round2(c.bruto - descontado);
    dinero += neto;
    filas.push(neto > 0 ? { ...c.fila, valor: neto } : { ...c.fila, valor: 0, yaFacturado: true });
  }

  const tocoTope = (planes as any[]).length >= tope || (presupuestos as any[]).length >= tope;
  return {
    // El total es el de las filas de verdad: los filtros que las deciden
    // (sesiones pendientes y cita futura) se resuelven en memoria, así que aquí
    // NO hay un `count` honesto que pedir. Si se tocó el tope se dice.
    seccion: armar(filas, "sin_agendar", filas.length, tocoTope, dinero),
    // Sin importe: lo que se le vendió a un archivado no es dinero devengado, y
    // `archivados.monto` habla solo del saldo ya facturado (ver `por_cobrar`).
    // Y el contador es exacto SOLO si no se tocó el tope: los archivados se ven
    // recorriendo las filas traídas, así que uno que se cayera del recorte no se
    // contaría. Con el tope tocado, el número es un mínimo y se dice.
    archivados: { filas: archivados, monto: 0, exacto: !tocoTope },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   4 · CITAS CAÍDAS SIN REAGENDAR
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Una cancelación o una ausencia de los últimos 90 días de un paciente que NO
 * volvió a pisar la agenda después de aquel día.
 *
 * «Después de aquel día» y no «tiene cita futura» a propósito: quien canceló el
 * martes y vino el jueves no se perdió: se recuperó solo. El cruce es contra el
 * MÁXIMO `startsAt` de sus citas no canceladas dentro de la misma ventana — que
 * incluye el futuro, así que una reagenda para dentro de un mes también cuenta.
 *
 * Se devuelve UNA fila por paciente, la de la caída más reciente, con cuántas
 * lleva: cinco líneas del mismo paciente no son cinco llamadas, son una.
 *
 * Sin dinero. Una cita cancelada no es dinero ganado ni aceptado, y el `price`
 * de la cita es un campo opcional que casi nadie llena: ponerle un importe sería
 * exactamente el humo que esta herramienta no puede permitirse. Se ordenan por
 * lo reciente que es la caída, que es lo que las hace recuperables.
 */
export async function seccionSinReagendar(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
  esperaDias: number,
  ventanaDias: number,
  tope: number,
): Promise<Fuente> {
  const vis = visibilidad(ctx);
  const auth = comoAuthContext(ctx);
  // 🔴 LA VENTANA SE ENSANCHA CON `dias`, Y LA ESPERA SE ACOTA.
  //
  // Con la ventana fija en 90 días y `corte = ahora − dias`, un `dias` de 90 o
  // más daba «desde hace 90 días HASTA hace 365»: un rango imposible, cero
  // filas, y Sabina contestando «no hay ninguna cita caída sin reagendar» como
  // un hecho. Preguntar «¿qué se me escapó este año?» la volvía muda sin avisar.
  //
  // Ahora `dias` hace lo que el doctor quiere decir con él en esta sección:
  // ENSANCHAR la ventana. Y la espera mínima se queda en una semana como mucho,
  // porque lo único que hay que dejar madurar es que a la cancelación le dé
  // tiempo a ser reagendada.
  const ventana = Math.max(ventanaDias, esperaDias);
  const espera = Math.min(esperaDias, GRACIA_CAIDAS_DIAS);
  const desde = new Date(ahora.getTime() - ventana * DIA_MS);
  const corte = new Date(ahora.getTime() - espera * DIA_MS);

  const [caidas, buenas] = await Promise.all([
    db.appointment.findMany({
      // Aquí SÍ por `buildAppointmentWhere`: la cita caída es de alguien, y a un
      // DOCTOR le tocan las suyas, igual que en `ausencias` y `citas_del_dia`.
      // Los archivados por ARCO NO se filtran en el `where` aquí, al revés que
      // en las otras tres: se descartan abajo, en memoria, para poder CONTARLOS.
      // En aquéllas el contador sale de un `aggregate` aparte; aquí no hay
      // importe que agregar, así que un `count` extra sería una consulta para
      // un número que ya viene en estas filas.
      where: buildAppointmentWhere(auth, {
        startsAt: { gte: desde, lt: corte },
        status: { in: [...ESTADOS_ACTIVOS] },
        ...(vis.length ? { AND: vis } : {}),
      }),
      select: { patientId: true, startsAt: true, status: true, type: true, patient: SELECT_PACIENTE },
      orderBy: { startsAt: "desc" },
      take: tope,
    }),
    // 🔴 Por `clinicId` pelado, como el cruce de cita futura y por lo mismo: si
    // la reagenda quedó con otro doctor, el paciente NO se perdió.
    db.appointment.groupBy({
      by: ["patientId"],
      where: {
        clinicId: ctx.clinicId,
        startsAt: { gte: desde },
        status: { notIn: [...ESTADOS_ACTIVOS] },
      },
      _max: { startsAt: true },
    }),
  ]);

  const ultimaBuena: Record<string, number> = {};
  for (const g of buenas as any[]) {
    if (!g.patientId) continue;
    const t = g._max?.startsAt ? new Date(g._max.startsAt).getTime() : null;
    if (t !== null && isFinite(t)) ultimaBuena[g.patientId] = t;
  }

  // Una fila por paciente: la caída más reciente manda y las demás se cuentan.
  const porPaciente: Record<string, { fila: FilaEscape; veces: number }> = {};
  let archivadas = 0;
  for (const a of caidas as any[]) {
    if (!a.patientId) continue;
    if (a.patient?.deletedAt) {
      archivadas++;
      continue;
    }
    const cuando = new Date(a.startsAt).getTime();
    if ((ultimaBuena[a.patientId] ?? -Infinity) > cuando) continue; // se recuperó solo
    const ya = porPaciente[a.patientId];
    if (ya) {
      ya.veces++;
      continue;
    }
    porPaciente[a.patientId] = {
      veces: 1,
      fila: {
        tipo: "sin_reagendar",
        paciente: nombreDe(a.patient),
        folio: a.patient?.patientNumber ?? null,
        telefono: telefonoDe(ctx, a.patient),
        valor: 0,
        dias: dias(new Date(a.startsAt), ahora),
        detalle:
          `${a.status === "NO_SHOW" ? "no asistió" : "canceló"} ` +
          `${a.type ? `«${String(a.type).slice(0, 40)}» ` : ""}del ${fechaDe(new Date(a.startsAt), ctx.timezone)}`,
      },
    };
  }

  const filas = Object.keys(porPaciente).map((id) => {
    const { fila, veces } = porPaciente[id];
    return veces > 1 ? { ...fila, detalle: `${fila.detalle} (${veces} caídas)` } : fila;
  });

  return {
    seccion: armar(filas, "sin_reagendar", filas.length, (caidas as any[]).length >= tope, 0),
    // Mínimo, no total, si se tocó el tope: ver `Fuente.archivados`.
    archivados: { filas: archivadas, monto: 0, exacto: (caidas as any[]).length < tope },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   5 · GENTE ESPERANDO RESPUESTA — la fuga que nadie pidió y la más barata
       de tapar
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Alguien levantó la mano y nadie le contestó. Dos puertas, la misma situación:
 *
 *  · `BookingRequest` PENDIENTE — pidió cita desde la mini-web pública, SIN
 *    cuenta. Ni siquiera tiene expediente todavía: si nadie contesta, ese
 *    paciente no existe nunca.
 *  · `AppointmentChangeRequest` PENDING — ya es paciente y pidió mover o
 *    cancelar su cita desde el portal.
 *
 * ── POR QUÉ NO ESPERA LOS `dias` DE LAS DEMÁS ──────────────────────────
 * Porque aquí no hay nada que madurar. Una factura de anteayer no se está
 * escapando; una persona que pidió cita ayer y no ha recibido respuesta SÍ, y
 * mañana ya se fue a la clínica de al lado. Es la única sección que cuenta
 * desde el primer día, y por eso su semivida es la más corta (7 días).
 *
 * ── SIN DINERO, PERO PRIMERO EN LA FRASE ───────────────────────────────
 * Una solicitud no tiene importe, así que vale 0 y, por la fórmula, se ordena
 * por debajo de cualquier fila con pesos. El resumen la nombra igualmente ANTES
 * que el dinero: es lo que se arregla en cinco minutos. Urgencia y valor no son
 * lo mismo, y aquí conviene no confundirlos ni en un sentido ni en el otro.
 *
 * ── LA TABLA PUEDE NO EXISTIR ──────────────────────────────────────────
 * `booking_requests` llega con `sql/landing-v2.sql`, que puede no estar
 * aplicado. `GET /api/booking-requests` ya trata ese caso devolviendo la bandeja
 * vacía en vez de romper la agenda entera; aquí se hace lo mismo, y por lo
 * mismo: que a Sabina le falte una bandeja no puede tumbar la respuesta a «¿qué
 * se me está escapando?». El código de error se compara a mano (P2021 / 42P01)
 * porque el helper del repo lleva `server-only` y no carga fuera del bundle.
 *
 * ── LA MARCA «YA SE LE PASÓ» ───────────────────────────────────────────
 * El paso a EXPIRADA es PEREZOSO: lo hace la bandeja al abrirse. Así que hay
 * PENDIENTE cuya hora ya pasó. No se creen la etiqueta: se compara la fecha, y
 * la fila se marca «se le pasó la hora». Ésa duele más, no menos: la persona se
 * quedó esperando un día concreto.
 */
export async function seccionSinContestar(
  db: EscapeDb,
  ctx: SabinaCtx,
  ahora: Date,
  esperaDias: number,
  ventanaDias: number,
  tope: number,
): Promise<Fuente> {
  const vis = visibilidad(ctx);
  const auth = comoAuthContext(ctx);
  // Aquí NO hay espera mínima (ver arriba), pero la ventana se ensancha igual
  // con `dias`: «¿a quién dejé sin contestar este año?» tiene que poder mirar el
  // año entero, no los últimos noventa días.
  const desde = new Date(ahora.getTime() - Math.max(ventanaDias, esperaDias) * DIA_MS);

  const [solicitudes, cambios] = await Promise.all([
    // 🔴 `clinicId` de la sesión. No lleva visibilidad por paciente porque NO
    // HAY paciente: es gente sin expediente. Los datos que salen (nombre y
    // WhatsApp) son exactamente los que ya enseña la bandeja con `agenda.view`.
    db.bookingRequest
      .findMany({
        where: { clinicId: ctx.clinicId, status: "PENDIENTE", createdAt: { gte: desde } },
        select: { patientName: true, patientWhatsapp: true, serviceName: true, requestedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: tope,
      })
      .catch((e: unknown) => {
        const codigo = (e as { code?: string })?.code;
        if (codigo === "P2021" || codigo === "42P01") return []; // falta sql/landing-v2.sql
        throw e;
      }),
    db.appointmentChangeRequest.findMany({
      where: {
        clinicId: ctx.clinicId,
        status: "PENDING",
        createdAt: { gte: desde },
        // Mismo scope que GET /api/appointment-change-requests: el doctor ve las
        // peticiones sobre SUS citas.
        ...(auth.isDoctor ? { appointment: { is: { doctorId: ctx.userId } } } : {}),
        ...(vis.length ? { AND: vis } : {}),
      },
      select: {
        type: true,
        reason: true,
        createdAt: true,
        proposedStartsAt: true,
        appointment: { select: { startsAt: true, type: true } },
        patient: SELECT_PACIENTE,
      },
      orderBy: { createdAt: "desc" },
      take: tope,
    }),
  ]);

  const filas: FilaEscape[] = [];
  let archivados = 0;

  for (const s of solicitudes as any[]) {
    const cuando = s.requestedAt ? new Date(s.requestedAt) : null;
    const pasada = cuando !== null && cuando.getTime() < ahora.getTime();
    filas.push({
      tipo: "sin_contestar",
      paciente: String(s.patientName ?? "").trim() || "Sin nombre",
      // No es paciente todavía: no hay folio que dar, y eso también es un dato.
      folio: null,
      telefono: s.patientWhatsapp ?? null,
      valor: 0,
      dias: dias(s.createdAt, ahora),
      detalle:
        `pidió cita por la web${s.serviceName ? ` («${String(s.serviceName).slice(0, 40)}»)` : ""}` +
        (cuando ? ` para el ${fechaDe(cuando, ctx.timezone)}${pasada ? ", y se le pasó la hora" : ""}` : "") +
        ", sin expediente y sin contestar",
    });
  }

  for (const c of cambios as any[]) {
    if (c.patient?.deletedAt) {
      archivados++;
      continue;
    }
    const cita = c.appointment?.startsAt ? new Date(c.appointment.startsAt) : null;
    const quiere = c.type === "CANCEL" ? "cancelar" : "mover";
    filas.push({
      tipo: "sin_contestar",
      paciente: nombreDe(c.patient),
      folio: c.patient?.patientNumber ?? null,
      telefono: telefonoDe(ctx, c.patient),
      valor: 0,
      dias: dias(c.createdAt, ahora),
      detalle:
        `pidió ${quiere} desde el portal su cita${cita ? ` del ${fechaDe(cita, ctx.timezone)}` : ""}` +
        `${c.proposedStartsAt ? ` (propone el ${fechaDe(new Date(c.proposedStartsAt), ctx.timezone)})` : ""}` +
        ", sin contestar",
    });
  }

  const tocoTope = (solicitudes as any[]).length >= tope || (cambios as any[]).length >= tope;
  return {
    seccion: armar(filas, "sin_contestar", filas.length, tocoTope, 0),
    // Mínimo, no total, si se tocó el tope: ver `Fuente.archivados`.
    archivados: { filas: archivados, monto: 0, exacto: !tocoTope },
  };
}
