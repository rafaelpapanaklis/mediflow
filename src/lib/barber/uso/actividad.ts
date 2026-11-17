// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — USO DEL PANEL: lo que ve el ADMIN (ws6-t4).
//
// Por mes (cortes en la medianoche de Mérida, como el resto de /admin):
// días activos, sesiones, pantallas vistas, clics, usuarios activos; la tabla
// por usuario; las pantallas y los botones más usados; y la serie por día.
// Para la LISTA de barberías: último uso y clics del mes de cada una.
//
// SQL crudo (la tabla no está en el cliente de Prisma) y TODO degrada: sin
// la tabla → { disponible: false } y la ficha lo dice, sin tronar.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ZONA_ADMIN, diaAdmin, inicioDelMes } from "@/lib/admin/zona-horaria";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BARBER_NAV_ITEMS } from "@/lib/barber/types";
import { olvidarSiFaltaTabla, usoListo, type UsoDb } from "./registro";
import { barberiasEnLinea, desdeEnLinea, estaEnLinea } from "./en-linea-core";

/** Cuántos meses hacia atrás ofrece el selector. */
export const MESES_EN_SELECTOR = 12;
/** «Último uso» de la LISTA: solo se mira esta ventana (la tabla crece cada día). */
export const DIAS_ULTIMO_USO_LISTA = 90;

const NOMBRE_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface MesUso {
  clave: string; // "2026-11"
  etiqueta: string; // "noviembre 2026"
  desde: Date;
  hasta: Date; // abierto (lt)
}

function partesMes(ahora: Date): { anio: number; mes: number } {
  const [a, m] = diaAdmin(ahora).split("-").map(Number);
  return { anio: a, mes: m };
}

function mesDe(anio: number, mes: number): MesUso {
  // Día 15 al mediodía UTC: cae dentro del mes en cualquier zona de México.
  const desde = inicioDelMes(new Date(Date.UTC(anio, mes - 1, 15, 12)));
  const hasta = inicioDelMes(new Date(Date.UTC(anio, mes, 15, 12)));
  return {
    clave: `${anio}-${String(mes).padStart(2, "0")}`,
    etiqueta: `${NOMBRE_MES[mes - 1]} ${anio}`,
    desde,
    hasta,
  };
}

/** Los meses del selector, el actual primero. */
export function mesesDelSelector(ahora = new Date(), n = MESES_EN_SELECTOR): MesUso[] {
  const { anio, mes } = partesMes(ahora);
  const out: MesUso[] = [];
  for (let i = 0; i < n; i++) {
    const m0 = mes - 1 - i; // 0-based, puede ser negativo
    const a = anio + Math.floor(m0 / 12);
    const m = ((m0 % 12) + 12) % 12;
    out.push(mesDe(a, m + 1));
  }
  return out;
}

/** «2026-11» → ese mes; cualquier otra cosa (o un mes futuro) → el mes en curso. */
export function resolverMes(clave: string | null | undefined, ahora = new Date()): MesUso {
  const actual = mesesDelSelector(ahora, 1)[0];
  const m = /^(\d{4})-(\d{2})$/.exec(clave ?? "");
  if (!m) return actual;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || anio < 2024) return actual;
  const pedido = mesDe(anio, mes);
  return pedido.desde.getTime() > actual.desde.getTime() ? actual : pedido;
}

/** Todos los días del mes como «YYYY-MM-DD» (hasta hoy si es el mes en curso). */
export function diasDelMes(mes: MesUso, ahora = new Date()): string[] {
  const [a, m] = mes.clave.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const hoy = diaAdmin(ahora);
  const out: string[] = [];
  for (let d = 1; d <= ultimo; d++) {
    const k = `${mes.clave}-${String(d).padStart(2, "0")}`;
    if (k > hoy) break;
    out.push(k);
  }
  return out;
}

/**
 * La pantalla en palabras: la entrada del menú que la contiene («Caja»), y lo
 * que sigue de la ruta («Clientes · [id]»). Sin entrada → la ruta tal cual.
 */
export function pantallaLegible(screen: string): string {
  const t = getBarberT("es");
  const item = [...BARBER_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => screen === i.href || screen.startsWith(i.href + "/"));
  if (!item) return screen;
  const nombre = t(`barber.shell.nav.${item.key}`);
  const resto = screen.slice(item.href.length).replace(/^\//, "").replace(/\//g, " · ");
  return resto ? `${nombre} · ${resto}` : nombre;
}

export interface UsoTotales {
  diasActivos: number;
  sesiones: number;
  vistas: number;
  clics: number;
  usuarios: number;
}

export interface UsoDia {
  dia: string;
  sesiones: number;
  vistas: number;
  clics: number;
}

export interface UsoUsuario {
  userId: string;
  nombre: string;
  rol: string | null;
  activo: boolean;
  /** De SIEMPRE (no solo del mes). null = nunca registró uso. */
  ultimoAcceso: string | null;
  /** Usó el panel en los últimos MINUTOS_EN_LINEA (en-linea-core). */
  enLinea: boolean;
  sesiones: number;
  vistas: number;
  clics: number;
}

export interface ActividadBarberia {
  disponible: boolean;
  mes: { clave: string; etiqueta: string };
  meses: Array<{ clave: string; etiqueta: string }>;
  /** Barberías contadas: la sede, o la matriz y sus sucursales. */
  sedes: number;
  totales: UsoTotales;
  dias: UsoDia[];
  usuarios: UsoUsuario[];
  pantallas: Array<{ pantalla: string; nombre: string; vistas: number; usuarios: number }>;
  acciones: Array<{ accion: string; clics: number }>;
}

const VACIO: UsoTotales = { diasActivos: 0, sesiones: 0, vistas: 0, clics: 0, usuarios: 0 };

/** Etiqueta del botón para el admin. */
export function accionLegible(action: string | null, target: string | null): string {
  if (action?.startsWith("accion:")) return action.slice("accion:".length);
  if (action) return action;
  if (target === "externo") return "Enlace a fuera (WhatsApp, teléfono, web)";
  if (target) return `→ ${pantallaLegible(target)}`;
  return "Botón sin nombre del panel";
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * La actividad del mes de unas barberías (ids SIEMPRE resueltos por el
 * servidor a partir del id de la ficha; nunca del navegador).
 */
export async function actividadDeBarberias(
  shopIds: string[],
  claveMes: string | null | undefined,
  db: UsoDb & { barberUser: typeof prisma.barberUser } = prisma,
  ahora = new Date(),
): Promise<ActividadBarberia> {
  const mes = resolverMes(claveMes, ahora);
  const base: ActividadBarberia = {
    disponible: false,
    mes: { clave: mes.clave, etiqueta: mes.etiqueta },
    meses: mesesDelSelector(ahora).map((m) => ({ clave: m.clave, etiqueta: m.etiqueta })),
    sedes: shopIds.length,
    totales: { ...VACIO },
    dias: diasDelMes(mes, ahora).map((dia) => ({ dia, sesiones: 0, vistas: 0, clics: 0 })),
    usuarios: [],
    pantallas: [],
    acciones: [],
  };
  // ⛔ Sin ids no se consulta: un filtro vacío NO es «todas».
  if (shopIds.length === 0) return base;
  if (!(await usoListo(db))) return base;

  const ids = shopIds;
  const { desde, hasta } = mes;
  const enRango = Prisma.sql`"barbershopId" = ANY(${ids}::text[]) AND "createdAt" >= ${desde} AND "createdAt" < ${hasta}`;
  const dia = Prisma.sql`to_char(("createdAt" AT TIME ZONE ${ZONA_ADMIN}), 'YYYY-MM-DD')`;

  try {
    const [tot, porDia, porUsuario, ultimos, pantallas, acciones] = await Promise.all([
      db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT COUNT(DISTINCT "sessionId")::int AS "sesiones",
               (COUNT(*) FILTER (WHERE "type" = 'VIEW'))::int AS "vistas",
               (COUNT(*) FILTER (WHERE "type" = 'CLICK'))::int AS "clics",
               COUNT(DISTINCT "userId")::int AS "usuarios",
               COUNT(DISTINCT ${dia})::int AS "dias"
        FROM "barber_usage_events" WHERE ${enRango}`,
      db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT ${dia} AS "dia",
               COUNT(DISTINCT "sessionId")::int AS "sesiones",
               (COUNT(*) FILTER (WHERE "type" = 'VIEW'))::int AS "vistas",
               (COUNT(*) FILTER (WHERE "type" = 'CLICK'))::int AS "clics"
        FROM "barber_usage_events" WHERE ${enRango} GROUP BY 1`,
      db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT "userId",
               COUNT(DISTINCT "sessionId")::int AS "sesiones",
               (COUNT(*) FILTER (WHERE "type" = 'VIEW'))::int AS "vistas",
               (COUNT(*) FILTER (WHERE "type" = 'CLICK'))::int AS "clics"
        FROM "barber_usage_events" WHERE ${enRango} GROUP BY "userId"`,
      db.$queryRaw<Array<{ userId: string; ultimo: Date }>>`
        SELECT "userId", MAX("createdAt") AS "ultimo"
        FROM "barber_usage_events" WHERE "barbershopId" = ANY(${ids}::text[])
        GROUP BY "userId"`,
      db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT "screen", COUNT(*)::int AS "vistas", COUNT(DISTINCT "userId")::int AS "usuarios"
        FROM "barber_usage_events" WHERE ${enRango} AND "type" = 'VIEW'
        GROUP BY "screen" ORDER BY 2 DESC, 1 LIMIT 10`,
      db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT "action", "target", COUNT(*)::int AS "clics"
        FROM "barber_usage_events" WHERE ${enRango} AND "type" = 'CLICK'
        GROUP BY "action", "target" ORDER BY 3 DESC LIMIT 40`,
    ]);

    // El equipo de esas barberías (aunque no haya usado nada) + quien sí usó.
    const usoMes = new Map(porUsuario.map((r) => [String(r.userId), r]));
    const ultimoDe = new Map(ultimos.map((r) => [r.userId, r.ultimo]));
    const equipo = await db.barberUser.findMany({
      where: {
        OR: [{ barbershopId: { in: ids } }, { id: { in: [...ultimoDe.keys()] } }],
      },
      select: { id: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    const usuarios: UsoUsuario[] = equipo.map((u) => {
      const m = usoMes.get(u.id);
      const ult = ultimoDe.get(u.id);
      return {
        userId: u.id,
        nombre: `${u.firstName} ${u.lastName}`.trim() || "—",
        rol: u.role ?? null,
        activo: u.isActive,
        ultimoAcceso: ult ? new Date(ult).toISOString() : null,
        enLinea: estaEnLinea(ult ?? null, ahora),
        sesiones: n(m?.sesiones),
        vistas: n(m?.vistas),
        clics: n(m?.clics),
      };
    });
    usuarios.sort(
      (a, b) =>
        b.clics - a.clics ||
        b.sesiones - a.sesiones ||
        (b.ultimoAcceso ?? "").localeCompare(a.ultimoAcceso ?? "") ||
        a.nombre.localeCompare(b.nombre),
    );

    const porDiaMap = new Map(porDia.map((r) => [String(r.dia), r]));
    // Las acciones se agrupan por su ETIQUETA legible (dos destinos con el
    // mismo nombre de pantalla suman juntos).
    const accionesMap = new Map<string, number>();
    for (const r of acciones) {
      const k = accionLegible((r.action as string | null) ?? null, (r.target as string | null) ?? null);
      accionesMap.set(k, (accionesMap.get(k) ?? 0) + n(r.clics));
    }

    const t = tot[0] ?? {};
    return {
      ...base,
      disponible: true,
      totales: {
        diasActivos: n(t.dias),
        sesiones: n(t.sesiones),
        vistas: n(t.vistas),
        clics: n(t.clics),
        usuarios: n(t.usuarios),
      },
      dias: base.dias.map((d) => {
        const r = porDiaMap.get(d.dia);
        return r ? { dia: d.dia, sesiones: n(r.sesiones), vistas: n(r.vistas), clics: n(r.clics) } : d;
      }),
      usuarios,
      pantallas: pantallas.map((r) => ({
        pantalla: String(r.screen),
        nombre: pantallaLegible(String(r.screen)),
        vistas: n(r.vistas),
        usuarios: n(r.usuarios),
      })),
      acciones: [...accionesMap.entries()]
        .map(([accion, clics]) => ({ accion, clics }))
        .sort((a, b) => b.clics - a.clics || a.accion.localeCompare(b.accion))
        .slice(0, 10),
    };
  } catch (e) {
    if (olvidarSiFaltaTabla(e)) return base;
    throw e;
  }
}

export interface UsoEnLista {
  ultimoUso: string | null;
  clicsMes: number;
}

/**
 * Para la LISTA: último uso (en los últimos DIAS_ULTIMO_USO_LISTA días) y
 * clics del mes en curso de cada barbería, y cuáles están EN LÍNEA (uso en
 * los últimos MINUTOS_EN_LINEA; una matriz, si cualquiera de sus sedes lo
 * está, aunque la lista venga filtrada sin sus sucursales). Una sola
 * consulta agregada (índice barbershopId+createdAt). Sin la tabla (o si algo
 * falla) → { disponible: false } y nadie en línea: la lista enseña «—».
 */
export async function usoParaLista(
  ids: string[],
  db: UsoDb = prisma,
  ahora = new Date(),
): Promise<{ disponible: boolean; porBarberia: Map<string, UsoEnLista>; enLinea: Set<string> }> {
  const out = new Map<string, UsoEnLista>();
  if (ids.length === 0) return { disponible: false, porBarberia: out, enLinea: new Set() };
  try {
    if (!(await usoListo(db))) return { disponible: false, porBarberia: out, enLinea: new Set() };
    const desdeMes = inicioDelMes(ahora);
    const desdeVentana = new Date(ahora.getTime() - DIAS_ULTIMO_USO_LISTA * 86_400_000);
    // Las sedes pedidas MÁS las sucursales de las matrices pedidas: su uso
    // enciende el punto de la matriz. Cada fila sigue siendo de UNA sede
    // (último uso y clics no se mezclan entre sedes).
    const rows = await db.$queryRaw<
      Array<{ barbershopId: string; parentId: string | null; ultimo: Date | null; clics: number }>
    >`
      SELECT e."barbershopId", s."parentId", MAX(e."createdAt") AS "ultimo",
             (COUNT(*) FILTER (WHERE e."type" = 'CLICK' AND e."createdAt" >= ${desdeMes}))::int AS "clics"
      FROM "barber_usage_events" e
      JOIN "barber_shops" s ON s."id" = e."barbershopId"
      WHERE e."barbershopId" IN (
              SELECT "id" FROM "barber_shops"
              WHERE "id" = ANY(${ids}::text[]) OR "parentId" = ANY(${ids}::text[])
            )
        AND e."createdAt" >= ${desdeVentana}
      GROUP BY e."barbershopId", s."parentId"`;
    for (const r of rows) {
      out.set(r.barbershopId, {
        ultimoUso: r.ultimo ? new Date(r.ultimo).toISOString() : null,
        clicsMes: n(r.clics),
      });
    }
    return {
      disponible: true,
      porBarberia: out,
      enLinea: barberiasEnLinea(
        rows.map((r) => ({ barbershopId: r.barbershopId, parentId: r.parentId ?? null, ultimo: r.ultimo })),
        ahora,
      ),
    };
  } catch (e) {
    olvidarSiFaltaTabla(e);
    console.warn("[barber/uso] la lista sigue sin el uso:", e instanceof Error ? e.message : e);
    return { disponible: false, porBarberia: new Map(), enLinea: new Set() };
  }
}

/**
 * Para la FICHA: de estas personas, quién usó el panel en los últimos
 * MINUTOS_EN_LINEA (en cualquier sede). Una consulta (índice userId+createdAt).
 * Sin la tabla o si algo falla → nadie en línea, sin tronar.
 */
export async function usuariosEnLinea(
  userIds: string[],
  db: UsoDb = prisma,
  ahora = new Date(),
): Promise<Set<string>> {
  // ⛔ Sin ids no se consulta: un filtro vacío NO es «todos».
  if (userIds.length === 0) return new Set();
  try {
    if (!(await usoListo(db))) return new Set();
    const rows = await db.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "barber_usage_events"
      WHERE "userId" = ANY(${userIds}::text[]) AND "createdAt" >= ${desdeEnLinea(ahora)}
      GROUP BY "userId"`;
    return new Set(rows.map((r) => String(r.userId)));
  } catch (e) {
    olvidarSiFaltaTabla(e);
    console.warn("[barber/uso] la ficha sigue sin «en línea»:", e instanceof Error ? e.message : e);
    return new Set();
  }
}
