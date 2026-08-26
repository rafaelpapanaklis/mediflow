import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { getAccessibleOfficeIds } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { leadScopeWhere } from "@/lib/realty/leads";
import { getCollectionsBoard } from "@/lib/realty/leases";
import {
  chargeBalance,
  daysBetween,
  monthLabel,
  toCents,
  todayInTimezone,
} from "@/lib/realty/rent-charges";
import {
  REALTY_DEFAULT_TZ,
  currentPeriodKey,
  periodRange,
  zonedMidnightUtc,
} from "@/lib/realty/commissions";
import {
  duracionCorta,
  minutosDesde,
  urgenciaPrimerContacto,
  type RealtyInicioContratoFila,
  type RealtyInicioData,
  type RealtyInicioDeudorFila,
  type RealtyInicioExclusivaFila,
  type RealtyInicioMantenimientoFila,
  type RealtyInicioProspectoFila,
  type RealtyInicioRankingFila,
  type RealtyInicioVisitaFila,
} from "@/lib/realty/inicio-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL INICIO — lo PRIMERO que ve quien entra, y lo único que cambia entero
 * según el MODO de la cuenta.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── AISLAMIENTO, que es lo que no se puede equivocar ───────────────────
 *
 * 🔴 `accountId` sale SIEMPRE de `ctx`, nunca de un parámetro, y va en
 * TODAS las consultas de este archivo sin una sola excepción. En Prisma un
 * `accountId: undefined` no filtra por undefined: BORRA el filtro y
 * devuelve la tabla entera de todas las inmobiliarias. Por eso no hay aquí
 * ninguna función que reciba un accountId suelto — reciben el contexto.
 *
 * 🔴 Y el segundo recorte, el de OFICINA: `getAccessibleOfficeIds(ctx)`.
 * `RealtyProperty.officeId` es NULLABLE, así que un `{ in: ids }` a secas
 * DESCARTA los inmuebles sin oficina asignada —cartera "de la casa"— y el
 * tablero se quedaría corto sin que nadie lo note. La forma correcta, la
 * misma que usa el resto del vertical, es
 * `OR: [{ officeId: { in: ids } }, { officeId: null }]` SIEMPRE junto al
 * accountId. Está en `alcanceInmuebles()`, una sola vez.
 *
 * Los modelos que NO tienen officeId (prospectos, visitas, tareas, cargos,
 * contratos, mantenimientos) se recortan por rol —`leadScopeWhere` y
 * `soloMio`— o atravesando la propiedad. Cada consulta dice cuál usa.
 *
 * ── RENDIMIENTO ────────────────────────────────────────────────────────
 *
 * El Inicio se abre decenas de veces al día. Ningún `Promise.all` de este
 * archivo pasa de 7 lecturas, y las que dependen de un permiso o de una
 * feature se cortocircuitan con `Promise.resolve(null)` para no pagarlas:
 * la posición del arreglo se conserva y la consulta no se hace.
 *
 * ── LA CONVENCIÓN DEL null ─────────────────────────────────────────────
 *
 * `null` = no lo puede ver (modo, plan o permiso) → la tarjeta no se pinta.
 * `0`/`[]` = lo ve y está vacío → la tarjeta se pinta con su vacío útil.
 * Ver la nota larga en inicio-shared.ts.
 */

/** Tope de lectura del embudo sin atender. Más que esto ya no es un tablero. */
const TOPE_PROSPECTOS = 200;
const TOPE_FILAS = 20;
/** Ventanas que pidió el negocio. */
const DIAS_EXCLUSIVA = 30;
const DIAS_CONTRATO = 60;

type PermUser = { role: RealtyContext["role"]; permissionsOverride: string[] };

function permUserDe(ctx: RealtyContext): PermUser {
  return { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
}

/**
 * ¿Esta persona puede abrir la pantalla que hay detrás de la tarjeta?
 *
 * Es el MISMO AND de tres que resuelve el sidebar en el layout del panel,
 * leído del MISMO `REALTY_NAV_ITEMS`. Si se copiara aquí como ifs, el día
 * que una feature cambie de plan el Inicio seguiría ofreciendo una puerta
 * cerrada.
 */
function puedeVer(ctx: RealtyContext, navKey: string): boolean {
  const item = REALTY_NAV_ITEMS.find((i) => i.key === navKey);
  if (!item) return false;
  if (!navItemAllowsMode(item, ctx.mode)) return false;
  if (item.featureKey && ctx.plan.features[item.featureKey] !== true) return false;
  if (
    item.permission &&
    !hasRealtyPermission(permUserDe(ctx), item.permission as RealtyPermissionKey)
  ) {
    return false;
  }
  return true;
}

/** El recorte de cartera: cuenta + oficinas accesibles + la cartera sin oficina. */
async function alcanceInmuebles(ctx: RealtyContext): Promise<Prisma.RealtyPropertyWhereInput> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  return {
    accountId: ctx.accountId,
    OR: [{ officeId: { in: officeIds } }, { officeId: null }],
  };
}

/** Nombre de una persona del equipo, sin dobles espacios si falta el apellido. */
function nombreDe(u: { firstName: string | null; lastName: string | null } | null): string | null {
  if (!u) return null;
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}

/**
 * "Hoy" DE VERDAD, en la zona de la cuenta.
 *
 * 🔴 AQUÍ HABÍA UN BUG Y ERA DE LOS CAROS. `todayInTimezone` ancla el día a
 * MEDIODÍA UTC justamente para que ningún offset lo corra un día; hacerle
 * `setUTCHours(0,0,0,0)` tira esa ancla y deja una ventana UTC, no local.
 * En `America/Mexico_City` (UTC−6) el día real es [06:00Z, 06:00Z+1) y la
 * ventana quedaba en [00:00Z, 24:00Z): las visitas de AYER de 6 a 12 de la
 * noche entraban y las de HOY de 6 a 12 de la noche se perdían. En
 * inmuebles esa franja es la de más visitas, y en Tijuana el corrimiento es
 * de siete horas.
 *
 * `zonedMidnightUtc` es el punto único del vertical para esto y ya se
 * importaba de este mismo módulo.
 */
function ventanaDelDia(timezone: string, ahora: Date): { desde: Date; hasta: Date } {
  const hoy = todayInTimezone(timezone, ahora);
  const y = hoy.getUTCFullYear();
  const m = hoy.getUTCMonth() + 1;
  const d = hoy.getUTCDate();
  const desde = zonedMidnightUtc(y, m, d, timezone);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60_000);
  return { desde, hasta };
}

/**
 * Medianoche UTC del día de calendario de `hoyCal`, más N días.
 *
 * 🔴 POR QUÉ NO SIRVE `hoyCal` A SECAS PARA LOS VENCIMIENTOS. En este
 * vertical conviven DOS anclas de fecha y nadie las unificó:
 *   · `RealtyExclusive.endsAt` se guarda con `new Date(<input type=date>)`
 *     → MEDIANOCHE UTC.
 *   · `RealtyLease.endsAt` pasa por `toCalendarDate` → MEDIODÍA UTC.
 * Comparando contra `hoyCal` (mediodía), una exclusiva que vence HOY queda
 * fuera del `gte` por doce horas — y esa tarjeta existe precisamente para
 * gritar por la que se está cayendo. Con ventanas ancladas a medianoche y
 * de día completo, las dos anclas entran correctamente.
 */
function medianocheUTC(hoyCal: Date, masDias = 0): Date {
  const x = new Date(
    Date.UTC(hoyCal.getUTCFullYear(), hoyCal.getUTCMonth(), hoyCal.getUTCDate()),
  );
  x.setUTCDate(x.getUTCDate() + masDias);
  return x;
}

/* ═══════════════════════════════════════════════════════════════════════
 * LA FUNCIÓN QUE USA LA PANTALLA
 * ═══════════════════════════════════════════════════════════════════════ */

export async function getRealtyInicio(
  ctx: RealtyContext,
  ahora: Date = new Date(),
): Promise<RealtyInicioData> {
  const modo = ctx.mode;
  const perm = permUserDe(ctx);

  /**
   * "Solo lo mío": quien no puede ASIGNAR prospectos tampoco administra el
   * trabajo de nadie, así que su tablero es el suyo. Es el mismo criterio
   * que `leadScopeWhere` aplica al embudo — aquí se reusa para las tareas y
   * las visitas, que no tienen alcance propio. En una cuenta AGENT (asesor
   * solo) el rol es OWNER, así que esto sale false y ve todo… que es todo
   * suyo de todos modos.
   */
  const soloMio = !hasRealtyPermission(perm, "leads.assign");

  /**
   * 🔴 EL DINERO SE RECORTA CON EL PERMISO DEL DINERO, NO CON EL DEL CRM.
   *
   * Esto empezó siendo el mismo `soloMio` de arriba y era un agujero real:
   * `leads.assign` se le da a un asesor senior para que REPARTA PROSPECTOS,
   * y con eso el ranking le enseñaba el nombre y la comisión mensual EN
   * PESOS de todos sus compañeros. Un permiso de CRM abriendo la nómina.
   *
   * El punto único del repo para esto es `commissions.manage` (el mismo que
   * usa src/app/api/realty/deals/service.ts para decidir si alguien ve el
   * reparto entero o solo su parte).
   */
  const soloMisComisiones = !hasRealtyPermission(perm, "commissions.manage");

  const comercializa = modo === "AGENCY" || modo === "AGENT";
  // La zona SIEMPRE con nombre: sin ella, un cálculo de día o de mes se
  // corre y nadie lo relaciona con la zona horaria.
  const zona = ctx.account.timezone || REALTY_DEFAULT_TZ;
  const { desde: hoyDesde, hasta: hoyHasta } = ventanaDelDia(zona, ahora);
  const hoyCal = todayInTimezone(zona, ahora);
  const ahoraMs = ahora.getTime();

  const verProspectos = comercializa && puedeVer(ctx, "prospectos");
  const verVisitas = comercializa && puedeVer(ctx, "visitas");
  const verInmuebles = puedeVer(ctx, "inmuebles");
  const verExclusivas = comercializa && puedeVer(ctx, "propietarios");
  const verComisiones = comercializa && puedeVer(ctx, "comisiones");
  const verCobranza = puedeVer(ctx, "cobranza");
  const verRentas = puedeVer(ctx, "rentas");
  const verMantenimiento =
    verCobranza &&
    ctx.plan.features.maintenance === true &&
    hasRealtyPermission(perm, "maintenance.manage");

  /**
   * 🔴 EL ALCANCE DE CARTERA SE CALCULA SI LO NECESITA **CUALQUIERA** DE LAS
   * TARJETAS QUE LO USAN, no solo la de inmuebles.
   *
   * Comisiones y exclusivas recortan por oficina ATRAVESANDO la propiedad
   * (`property: { OR: alcanceProp.OR }`), así que si `alcanceProp` llegara
   * null esas dos consultas se quedarían sin ese recorte y le enseñarían a
   * quien solo tiene acceso a una sucursal las operaciones de todas. Pasaba
   * con un caso perfectamente posible: alguien con `commissions.view` pero
   * sin `properties.view`.
   *
   * Cuesta una lectura (los ids de oficina) y solo se paga si hace falta.
   */
  const alcanceProp =
    verInmuebles || verComisiones || verExclusivas || modo === "OWNER"
      ? await alcanceInmuebles(ctx)
      : null;

  /* ── LOTE 1 · el día de hoy (6 lecturas como mucho) ─────────────────── */

  const [leadsCrudos, hayAlgunProspecto, visitasCrudas, tareasVencidas, inmueblesPorEstado, sinFotos] =
    await Promise.all([
      verProspectos
        ? prisma.realtyLead.findMany({
            where: {
              accountId: ctx.accountId,
              ...leadScopeWhere({
                role: ctx.role,
                realtyUserId: ctx.realtyUserId,
                permissionsOverride: ctx.user.permissionsOverride,
              }),
              // "Sin atender" = NADIE le ha respondido todavía. Una nota
              // interna o un cambio de etapa no cuentan como contacto (la
              // regla la fija leads.ts y aquí no se reinventa).
              firstResponseAt: null,
              stage: { notIn: ["CIERRE", "PERDIDO"] },
            },
            select: {
              id: true,
              createdAt: true,
              contact: { select: { name: true } },
              assignedUser: { select: { firstName: true, lastName: true } },
            },
            orderBy: { createdAt: "asc" },
            // +1 para SABER que hay más, no para pintarlo.
            take: TOPE_PROSPECTOS + 1,
          })
        : Promise.resolve(null),

      // Distingue "no tienes prospectos" de "los tienes todos atendidos":
      // sin esto, el vacío diría "da de alta el primero" a quien ya tiene
      // cuarenta y los contestó todos.
      //
      // Lleva el MISMO leadScopeWhere que la consulta de arriba: sin él, a
      // un asesor nuevo sin nada asignado se le diría "ya los contestaste
      // todos" porque la CUENTA tiene prospectos — que es justo la
      // distinción que esta lectura existe para hacer bien.
      verProspectos
        ? prisma.realtyLead.count({
            where: {
              accountId: ctx.accountId,
              ...leadScopeWhere({
                role: ctx.role,
                realtyUserId: ctx.realtyUserId,
                permissionsOverride: ctx.user.permissionsOverride,
              }),
            },
          })
        : Promise.resolve(null),

      verVisitas
        ? prisma.realtyVisit.findMany({
            where: {
              accountId: ctx.accountId,
              scheduledAt: { gte: hoyDesde, lt: hoyHasta },
              status: { not: "CANCELADA" },
              // La rama `userId: null` NO sobra: RealtyVisit.userId es
              // nullable, y sin ella una visita de hoy SIN asesor asignado
              // sería invisible para todos los asesores — precisamente los
              // que podrían tomarla. Es la misma forma de leadScopeWhere.
              ...(soloMio
                ? { OR: [{ userId: ctx.realtyUserId }, { userId: null }] }
                : {}),
            },
            select: {
              id: true,
              scheduledAt: true,
              status: true,
              property: { select: { title: true, colonia: true, city: true } },
              user: { select: { firstName: true, lastName: true } },
            },
            orderBy: { scheduledAt: "asc" },
            take: TOPE_FILAS + 1,
          })
        : Promise.resolve(null),

      verProspectos
        ? prisma.realtyTask.count({
            where: {
              accountId: ctx.accountId,
              done: false,
              dueAt: { lt: ahora },
              ...(soloMio ? { userId: ctx.realtyUserId } : {}),
            },
          })
        : Promise.resolve(null),

      // Un solo groupBy da publicados y no publicados: dos counts para lo
      // mismo son una consulta de más en la pantalla que más se abre.
      // La reja es verInmuebles, NO "existe alcanceProp": ese objeto ahora
      // se calcula también para comisiones y exclusivas, y usarlo como reja
      // enseñaría la cartera a quien no tiene properties.view.
      verInmuebles && alcanceProp
        ? prisma.realtyProperty.groupBy({
            by: ["isPublished"],
            where: alcanceProp,
            _count: { _all: true },
          })
        : Promise.resolve(null),

      verInmuebles && alcanceProp
        ? prisma.realtyProperty.count({
            where: { ...alcanceProp, isPublished: true, photos: { none: {} } },
          })
        : Promise.resolve(null),
    ]);

  /* ── LOTE 2 · el mes y lo que vence (7 lecturas como mucho) ─────────── */

  const periodo = currentPeriodKey(zona, ahora);
  const { start: mesDesde, end: mesHasta } = periodRange(periodo, zona);
  // Ventanas de DÍA COMPLETO ancladas a medianoche (ver medianocheUTC):
  // así entra lo que vence HOY, con cualquiera de las dos anclas de fecha
  // que conviven en el vertical. El `+ 1` del final es lo que hace que el
  // último día de la ventana entre entero.
  const desdeHoy = medianocheUTC(hoyCal);
  const finExclusivas = medianocheUTC(hoyCal, DIAS_EXCLUSIVA + 1);
  const finContratos = medianocheUTC(hoyCal, DIAS_CONTRATO + 1);

  /**
   * 🔴 DOS LECTURAS VAN SUELTAS Y NO DENTRO DEL `Promise.all` DE ABAJO, y no
   * es estilo: es que TypeScript deja de inferir la TUPLA del `Promise.all`
   * cuando el arreglo mezcla demasiadas formas, y entonces TODAS las filas
   * destructuradas salen `unknown` — `s.amount` deja de existir y el
   * archivo no compila. Sacar las dos más pesadas a una promesa con nombre
   * le devuelve el tipo a cada una.
   *
   * No cuesta un viaje de más: se lanzan AQUÍ (así que corren en paralelo
   * con el lote) y se esperan después.
   *
   * De paso el lote se queda en cinco lecturas, bien por debajo del tope de
   * siete que se fijó para esta pantalla.
   */

  // Ranking (AGENCY) y comisiones propias (AGENT) salen de la MISMA
  // lectura: las partes de comisión de las operaciones cerradas del mes.
  // La reparten distinto la pantalla, no dos consultas.
  const splitsPromesa = verComisiones && alcanceProp
    ? prisma.realtyCommissionSplit.findMany({
        where: {
          accountId: ctx.accountId,
          ...(modo === "AGENT" || soloMisComisiones ? { realtyUserId: ctx.realtyUserId } : {}),
          deal: {
            accountId: ctx.accountId,
            status: "CERRADO",
            closedAt: { gte: mesDesde, lt: mesHasta },
            // `property: alcanceProp` ENTERO, no `{ OR: alcanceProp.OR }`.
            // Copiar solo el `.OR` tira el accountId del filtro anidado y,
            // peor, se rompe en silencio el día que alcanceInmuebles cambie
            // de forma: si pasara a expresarse con AND, `.OR` sería
            // undefined y Prisma BORRARÍA el filtro. El accountId repetido
            // no cuesta nada y es a prueba de refactor.
            property: alcanceProp,
          },
        },
        select: {
          amount: true,
          paidAt: true,
          dealId: true,
          realtyUserId: true,
          realtyUser: { select: { firstName: true, lastName: true } },
        },
        take: 500,
      })
    : Promise.resolve(null);

  const vaciasPromesa =
    modo === "OWNER" && alcanceProp && verRentas && verInmuebles
      ? prisma.realtyProperty.count({
          where: {
            ...alcanceProp,
            operation: { in: ["RENTA", "AMBAS"] },
            leases: { none: { status: "ACTIVO" } },
          },
        })
      : Promise.resolve(null);

  const [exclusivasCrudas, tablero, deudoresCrudos, contratosCrudos, mantCrudos] =
    await Promise.all([
      verExclusivas && alcanceProp
        ? prisma.realtyExclusive.findMany({
            where: {
              accountId: ctx.accountId,
              endsAt: { gte: desdeHoy, lt: finExclusivas },
              // El where COMPLETO, por lo mismo que en comisiones.
              property: alcanceProp,
            },
            select: { id: true, endsAt: true, property: { select: { id: true, title: true } } },
            orderBy: { endsAt: "asc" },
            take: TOPE_FILAS + 1,
          })
        : Promise.resolve(null),

      // El tablero de cobranza del mes YA existe y ya resuelve lo difícil
      // (una sola moneda por periodo, pagos parciales, antigüedad). No se
      // reimplementa aquí: dos aritméticas del mismo dinero es una que se
      // va a quedar atrás.
      verCobranza ? getCollectionsBoard(ctx, {}) : Promise.resolve(null),

      // Quién debe y DESDE CUÁNDO: esto sí cruza meses, así que no puede
      // salir del tablero (que es de un periodo). Vencido = con saldo y con
      // fecha pasada.
      verCobranza
        ? prisma.realtyRentCharge.findMany({
            where: {
              accountId: ctx.accountId,
              dueAt: { lt: hoyCal },
              status: { in: ["PENDIENTE", "PARCIAL", "VENCIDO"] },
            },
            select: {
              id: true,
              dueAt: true,
              amount: true,
              payments: { select: { amount: true } },
              lease: {
                select: {
                  currency: true,
                  property: { select: { title: true } },
                  parties: { select: { role: true, contact: { select: { name: true } } } },
                },
              },
            },
            orderBy: { dueAt: "asc" },
            take: TOPE_FILAS,
          })
        : Promise.resolve(null),

      verRentas
        ? prisma.realtyLease.findMany({
            where: {
              accountId: ctx.accountId,
              status: "ACTIVO",
              endsAt: { gte: desdeHoy, lt: finContratos },
            },
            select: { id: true, endsAt: true, property: { select: { title: true } } },
            orderBy: { endsAt: "asc" },
            take: TOPE_FILAS + 1,
          })
        : Promise.resolve(null),

      verMantenimiento
        ? prisma.realtyMaintenance.findMany({
            where: { accountId: ctx.accountId, status: { in: ["ABIERTO", "EN_PROCESO"] } },
            select: {
              id: true,
              status: true,
              createdAt: true,
              property: { select: { title: true } },
            },
            orderBy: { createdAt: "asc" },
            take: TOPE_FILAS + 1,
          })
        : Promise.resolve(null),
    ]);

  const splitsCrudos = await splitsPromesa;
  const vacias = await vaciasPromesa;

  /* ── De filas crudas a lo que la pantalla pinta ─────────────────────── */

  const primeros: RealtyInicioProspectoFila[] = (leadsCrudos ?? []).map((l) => {
    const minutos = minutosDesde(l.createdAt, ahoraMs);
    return {
      id: l.id,
      nombre: l.contact?.name ?? "Sin nombre",
      minutos,
      urgencia: urgenciaPrimerContacto(minutos),
      asesor: nombreDe(l.assignedUser),
    };
  });

  const prospectos =
    leadsCrudos === null
      ? null
      : {
          total: Math.min(primeros.length, TOPE_PROSPECTOS),
          truncado: primeros.length > TOPE_PROSPECTOS,
          verde: primeros.filter((p) => p.urgencia === "VERDE").length,
          amarillo: primeros.filter((p) => p.urgencia === "AMARILLO").length,
          rojo: primeros.filter((p) => p.urgencia === "ROJO").length,
          primeros: primeros.slice(0, 4),
          hayAlguno: (hayAlgunProspecto ?? 0) > 0,
        };

  const proximas: RealtyInicioVisitaFila[] = (visitasCrudas ?? []).map((v) => ({
    id: v.id,
    hora: v.scheduledAt.toISOString(),
    inmueble: v.property?.title ?? "Inmueble",
    donde: [v.property?.colonia, v.property?.city].filter(Boolean).join(", ") || null,
    asesor: nombreDe(v.user),
    confirmada: v.status === "CONFIRMADA" || v.status === "REALIZADA",
  }));

  const visitas =
    visitasCrudas === null
      ? null
      : {
          // 🔴 El total sale del arreglo YA RECORTADO por `take`, así que se
          // dice explícitamente si se topó. Un tope disfrazado de total es
          // peor que no dar el número: una agencia con 33 visitas hoy leía
          // "20" y decidía con eso.
          total: Math.min(proximas.length, TOPE_FILAS),
          truncado: proximas.length > TOPE_FILAS,
          porConfirmar: proximas.slice(0, TOPE_FILAS).filter((v) => !v.confirmada).length,
          // Al navegador van SOLO las filas que se pintan.
          proximas: proximas.slice(0, 5),
        };

  const publicados =
    inmueblesPorEstado?.find((g) => g.isPublished === true)?._count._all ?? 0;
  const noPublicados =
    inmueblesPorEstado?.find((g) => g.isPublished === false)?._count._all ?? 0;
  const inmuebles =
    inmueblesPorEstado === null
      ? null
      : { total: publicados + noPublicados, publicados, sinFotos: sinFotos ?? 0 };

  // Ranking: se agrupa por asesor. Las partes de la casa (oficina,
  // franquicia, externo) llevan realtyUserId NULL y NO son de nadie del
  // equipo, así que no entran en un ranking de personas.
  let ranking: RealtyInicioRankingFila[] | null = null;
  if (splitsCrudos && modo === "AGENCY") {
    const porAsesor = new Map<string, RealtyInicioRankingFila>();
    const dealsPorAsesor = new Map<string, Set<string>>();
    for (const s of splitsCrudos) {
      if (!s.realtyUserId) continue;
      const fila =
        porAsesor.get(s.realtyUserId) ??
        {
          userId: s.realtyUserId,
          nombre: nombreDe(s.realtyUser) ?? "Sin nombre",
          operaciones: 0,
          comisionCents: 0,
        };
      fila.comisionCents += toCents(s.amount);
      porAsesor.set(s.realtyUserId, fila);
      const deals = dealsPorAsesor.get(s.realtyUserId) ?? new Set<string>();
      deals.add(s.dealId);
      dealsPorAsesor.set(s.realtyUserId, deals);
    }
    // Array.from y no un for-of directo sobre el Map: el `target` de este
    // repo no permite iterar Map/Set sin --downlevelIteration.
    for (const [id, deals] of Array.from(dealsPorAsesor.entries())) {
      const fila = porAsesor.get(id);
      // Una operación con DOS partes del mismo asesor (captó y colocó) es
      // UNA operación, no dos: por eso el conteo va por dealId único.
      if (fila) fila.operaciones = deals.size;
    }
    ranking = Array.from(porAsesor.values())
      .sort((a, b) => b.comisionCents - a.comisionCents || a.nombre.localeCompare(b.nombre))
      .slice(0, 5);
  }

  let comisiones = null;
  if (splitsCrudos && modo === "AGENT") {
    const mias = splitsCrudos.filter((s) => s.realtyUserId === ctx.realtyUserId);
    // Se suma con toCents fila por fila y no con el genérico sumCentsBy: con
    // el tipo que sale del `select` de Prisma, la inferencia del genérico se
    // rinde y deja el parámetro en `unknown`. El resultado es el mismo —
    // enteros de centavos, un solo redondeo — y aquí sí se lee el tipo.
    const centsDe = (filas: typeof mias) =>
      filas.reduce((total, s) => total + toCents(s.amount), 0);
    comisiones = {
      periodoLabel: monthLabel(periodo),
      cobradoCents: centsDe(mias.filter((s) => s.paidAt !== null)),
      porCobrarCents: centsDe(mias.filter((s) => s.paidAt === null)),
      operaciones: new Set(mias.map((s) => s.dealId)).size,
    };
  }

  const exclusivas: RealtyInicioExclusivaFila[] | null =
    exclusivasCrudas === null
      ? null
      : exclusivasCrudas.slice(0, TOPE_FILAS).map((e) => ({
          id: e.id,
          inmueble: e.property?.title ?? "Inmueble",
          dias: Math.max(0, daysBetween(hoyCal, e.endsAt)),
        }));

  const cobranza =
    tablero === null
      ? null
      : {
          periodoLabel: tablero.periodLabel,
          moneda: tablero.currency,
          porCobrarCents: tablero.totals.balanceCents,
          cargadoCents: tablero.totals.chargedCents,
          vencidoCents: tablero.totals.overdueCents,
          vencidos: tablero.totals.overdueCount,
        };

  const deudores: RealtyInicioDeudorFila[] | null =
    deudoresCrudos === null
      ? null
      : deudoresCrudos
          .map((c) => {
            // `c.payments` sin `?? []`: el select SIEMPRE trae el arreglo, y
            // el `?? []` no defendía de nada — lo que hacía era volver el
            // tipo `never[] | Pago[]` y dejar la suma en `unknown`.
            const saldo = chargeBalance({
              amount: c.amount,
              paidCents: c.payments.reduce((total, p) => total + toCents(p.amount), 0),
              dueAt: c.dueAt,
              today: hoyCal,
            });
            const inquilino = (c.lease?.parties ?? []).find((p) => p.role === "INQUILINO");
            return {
              id: c.id,
              quien: inquilino?.contact?.name ?? "Sin inquilino",
              inmueble: c.lease?.property?.title ?? "Inmueble",
              desde: c.dueAt.toISOString(),
              diasTarde: saldo.daysLate,
              saldoCents: saldo.balanceCents,
              moneda: c.lease?.currency ?? "MXN",
            };
          })
          // Un cargo marcado PENDIENTE pero ya cubierto por un pago no es
          // una deuda: lo que debe es el SALDO, no el estado de la columna.
          .filter((d) => d.saldoCents > 0)
          .slice(0, 6);

  const contratos: RealtyInicioContratoFila[] | null =
    contratosCrudos === null
      ? null
      : contratosCrudos.slice(0, TOPE_FILAS).map((l) => ({
          id: l.id,
          inmueble: l.property?.title ?? "Inmueble",
          dias: Math.max(0, daysBetween(hoyCal, l.endsAt)),
        }));

  const mantenimientos: RealtyInicioMantenimientoFila[] | null =
    mantCrudos === null
      ? null
      : mantCrudos.slice(0, TOPE_FILAS).map((m) => ({
          id: m.id,
          inmueble: m.property?.title ?? "Inmueble",
          dias: Math.max(0, daysBetween(m.createdAt, hoyCal)),
          enProceso: m.status === "EN_PROCESO",
        }));

  /**
   * "Recién llegado": la cuenta no tiene NADA. Es distinto de "todo al
   * corriente" y merece otra pantalla — una lista de arranque, no un
   * tablero de ceros que parece un producto roto.
   */
  /**
   * 🔴 Y AQUÍ EL `??` ERA UN BUG, no un atajo. Colapsaba `null` ("no lo
   * puede ver") en el mismo valor que `0` ("no lo tiene") — el cero mudo
   * que este archivo prohíbe, aplicado justo a la bandera que cambia la
   * PANTALLA ENTERA. Un asistente con permisos recortados en una
   * inmobiliaria con 500 inmuebles y 40 contratos aterrizaba en el
   * onboarding de "empieza por aquí".
   *
   * "Recién llegado" solo se puede afirmar de lo que SE VE: si una de las
   * cuatro señales no es visible, no dice nada — ni a favor ni en contra.
   */
  const señales = [
    inmuebles === null ? null : inmuebles.total === 0,
    prospectos === null ? null : !prospectos.hayAlguno,
    cobranza === null ? null : cobranza.cargadoCents === 0,
    contratos === null ? null : contratos.length === 0,
  ].filter((v): v is boolean => v !== null);
  const recienLlegado = señales.length > 0 && señales.every(Boolean);

  return {
    modo,
    nombre: (ctx.user.firstName ?? "").trim(),
    recienLlegado,
    prospectos,
    visitas,
    tareasVencidas,
    ranking,
    exclusivas,
    exclusivasTruncado: (exclusivasCrudas?.length ?? 0) > TOPE_FILAS,
    contratosTruncado: (contratosCrudos?.length ?? 0) > TOPE_FILAS,
    mantenimientosTruncado: (mantCrudos?.length ?? 0) > TOPE_FILAS,
    /**
     * Lo que esta persona PUEDE HACER, para la lista de arranque. Sin esto,
     * la pantalla que ve una cuenta nueva ofrecía "invita a tu equipo" y
     * "prende tu web" a quien no tiene el permiso: un clic hasta la puerta
     * cerrada, en la única pantalla donde no hay nada más que hacer.
     */
    puede: {
      inmuebleNuevo:
        verInmuebles && hasRealtyPermission(perm, "properties.edit"),
      web: puedeVer(ctx, "mi-web"),
      equipo: puedeVer(ctx, "equipo"),
      rentas: verRentas,
    },
    comisiones,
    inmuebles,
    cobranza,
    deudores,
    contratos,
    mantenimientos,
    vacias,
  };
}

/** Reexport para que la pantalla no tenga que importar de dos sitios. */
export { duracionCorta };
