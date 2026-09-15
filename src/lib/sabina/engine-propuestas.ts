import "server-only";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { extractAuditMeta } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  fraseSinPermisoAccion,
  type LlaveEscritura,
  type PeticionEndpoint,
  type PropuestaPreparada,
  type RespuestaEndpoint,
  type SabinaAccion,
} from "./engine-acciones";
import {
  ENTIDAD_PROPUESTA,
  EVENTO,
  FRASE,
  SABINA_CUERPO_RASTRO_MAX_CHARS,
  SABINA_PEDIDO_MAX_CHARS,
  SABINA_PROPUESTA_TTL_MS,
  esIdDePropuesta,
  leerEnlace,
  vistaDePropuesta,
  type EventoPropuesta,
  type ResultadoVista,
  type SabinaPropuestaVista,
} from "./engine-propuestas-core";
import { EscrituraBloqueada, enSoloLectura, soloLectura } from "./engine-solo-lectura";
import { causaSinPermiso } from "./permisos-sabina";
import { conPermisosDeSabina } from "./recorte-en-curso";
import { tienePermiso } from "./tools/base";
import type { SabinaCtx } from "./tipos";

/**
 * Sabina — la fase 2: guardar la propuesta, reclamarla UNA vez y ejecutarla.
 *
 * Las reglas puras (estados, frases, duración) viven en
 * `engine-propuestas-core.ts`, con la explicación de por qué la propuesta se
 * guarda en `audit_logs`. Aquí está lo que toca base y handlers.
 *
 * 🔴 LO QUE GARANTIZA ESTE ARCHIVO
 *
 *  1. Solo `confirmarPropuesta` acuña una `LlaveEscritura`, y solo después de
 *     escribir `sabina_confirmar` bajo candado de Postgres habiendo comprobado que
 *     la propuesta es de esta clínica y de este usuario, que no caducó y que no
 *     tiene otro evento final. Dos toques simultáneos, un reintento de red o una
 *     segunda pestaña: uno ejecuta, los demás reciben el resultado del primero.
 *  2. Antes de ejecutar se vuelven a mirar el permiso (se lo pudieron quitar), los
 *     datos (contra el zod de la acción) y la huella (bajo el candado de solo
 *     lectura). Cualquier diferencia → no se escribe.
 *  3. Todo deja rastro, también lo que NO se hizo.
 *
 * Y lo que NO hace: no importa el motor ni es importado por él. El bucle del
 * modelo no tiene ningún camino hasta aquí; lo llama solo
 * `POST /api/sabina/propuestas/:id/confirmar`.
 */

/* ── La base, con la forma mínima que se usa (las pruebas inyectan un doble) ── */

export interface TxPropuestas {
  auditLog: {
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
  };
  $executeRaw(consulta: TemplateStringsArray, ...valores: unknown[]): Promise<number>;
}

export interface DbPropuestas extends TxPropuestas {
  $transaction<T>(fn: (tx: TxPropuestas) => Promise<T>, opciones?: { timeout?: number; maxWait?: number }): Promise<T>;
}

function dbDe(db?: DbPropuestas): DbPropuestas {
  return db ?? (prisma as unknown as DbPropuestas);
}

/** Lo que se necesita de la petición: cabeceras para el rastro y la URL para llamar handlers. */
export type PeticionOrigen = Pick<NextRequest, "headers" | "url">;

function meta(req?: PeticionOrigen): { ipAddress: string | null; userAgent: string | null } {
  if (!req) return { ipAddress: null, userAgent: null };
  const m = extractAuditMeta(req as NextRequest);
  return { ipAddress: m.ipAddress ?? null, userAgent: m.userAgent ?? null };
}

function fila(ctx: SabinaCtx, id: string, action: string, changes: Record<string, unknown>, req?: PeticionOrigen) {
  return {
    data: {
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: ENTIDAD_PROPUESTA,
      entityId: id,
      action,
      changes: { v: 1, ...changes },
      ...meta(req),
      actorType: "staff",
    },
  };
}

async function eventosDe(tx: TxPropuestas, clinicId: string, id: string): Promise<EventoPropuesta[]> {
  return tx.auditLog.findMany({
    where: { clinicId, entityType: ENTIDAD_PROPUESTA, entityId: id },
    select: { action: true, userId: true, createdAt: true, changes: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * El candado de UNA propuesta, del tamaño de la transacción. Mismo patrón que
 * `src/lib/barber/payments.ts`. Serializa confirmar, descartar y reemplazar sobre
 * el mismo id: entre leer «no tiene evento final» y escribirlo no cabe nadie.
 */
async function candado(tx: TxPropuestas, id: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sabina-propuesta:${id}`}))`;
}

/* ═══════════════════════════════════════════════════════════════════════
   GUARDAR (desde POST /api/sabina, DESPUÉS del bucle, fuera del candado de
   solo lectura)
   ═══════════════════════════════════════════════════════════════════════ */

export async function guardarPropuesta(args: {
  ctx: SabinaCtx;
  propuesta: PropuestaPreparada;
  pedido: string;
  conversacionId: string | null;
  modelo: string;
  req?: PeticionOrigen;
  db?: DbPropuestas;
  ahora?: () => number;
}): Promise<SabinaPropuestaVista> {
  const db = dbDe(args.db);
  const ahora = args.ahora ?? Date.now;
  const { ctx, propuesta } = args;

  // Solo vale la última propuesta: las pendientes de antes se retiran, cada una
  // bajo su candado (si alguien la está confirmando en este instante, gana esa
  // confirmación y aquí no se toca).
  await reemplazarPendientes({ ctx, db, ahora, req: args.req });

  const id = randomUUID();
  const expiraEn = ahora() + SABINA_PROPUESTA_TTL_MS;
  const creada = await db.auditLog.create(
    fila(
      ctx,
      id,
      EVENTO.proponer,
      {
        accion: propuesta.accion,
        titulo: propuesta.titulo,
        boton: propuesta.boton,
        queHace: propuesta.queHace,
        deshacer: propuesta.deshacer,
        tarjeta: propuesta.tarjeta,
        datos: propuesta.datos,
        huella: propuesta.huella,
        pedido: String(args.pedido ?? "").slice(0, SABINA_PEDIDO_MAX_CHARS),
        conversacionId: args.conversacionId,
        modelo: args.modelo,
        expiraEn: new Date(expiraEn).toISOString(),
      },
      args.req,
    ),
  );

  const creadaEn = creada?.createdAt instanceof Date ? creada.createdAt.getTime() : ahora();
  return {
    id,
    accion: propuesta.accion,
    titulo: propuesta.titulo,
    boton: propuesta.boton,
    tarjeta: propuesta.tarjeta,
    deshacer: propuesta.deshacer,
    creadaEn,
    expiraEn,
    estado: "pendiente",
    resultado: null,
  };
}

async function reemplazarPendientes(args: {
  ctx: SabinaCtx;
  db: DbPropuestas;
  ahora: () => number;
  req?: PeticionOrigen;
}): Promise<void> {
  const { ctx, db, ahora } = args;
  const recientes = await db.auditLog.findMany({
    where: {
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: ENTIDAD_PROPUESTA,
      createdAt: { gte: new Date(ahora() - SABINA_PROPUESTA_TTL_MS - 60_000) },
    },
    select: { entityId: true, action: true, userId: true, createdAt: true, changes: true },
    // Las más recientes primero: si hubiera más de 200 filas, lo que se corta es
    // lo viejo (ya caducado), no la última propuesta.
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const porId = new Map<string, EventoPropuesta[]>();
  for (const e of recientes) {
    const lista = porId.get(e.entityId) ?? [];
    lista.push(e);
    porId.set(e.entityId, lista);
  }
  for (const [id, eventos] of Array.from(porId.entries())) {
    if (vistaDePropuesta(id, eventos, ctx.userId, ahora())?.estado !== "pendiente") continue;
    await descartarBajoCandado({ ctx, db, id, motivo: "reemplazada", ahora, req: args.req });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   DESCARTAR
   ═══════════════════════════════════════════════════════════════════════ */

async function descartarBajoCandado(args: {
  ctx: SabinaCtx;
  db: DbPropuestas;
  id: string;
  motivo: "usuario" | "reemplazada";
  ahora: () => number;
  req?: PeticionOrigen;
}): Promise<SabinaPropuestaVista | null> {
  const { ctx, db, id } = args;
  return db.$transaction(async (tx) => {
    await candado(tx, id);
    const eventos = await eventosDe(tx, ctx.clinicId, id);
    const vista = vistaDePropuesta(id, eventos, ctx.userId, args.ahora());
    if (!vista || vista.estado !== "pendiente") return vista;
    await tx.auditLog.create(fila(ctx, id, EVENTO.descartar, { motivo: args.motivo }, args.req));
    return { ...vista, estado: args.motivo === "reemplazada" ? "reemplazada" : "descartada" } as SabinaPropuestaVista;
  });
}

export async function descartarPropuesta(args: {
  ctx: SabinaCtx;
  id: string;
  req?: PeticionOrigen;
  db?: DbPropuestas;
  ahora?: () => number;
}): Promise<{ http: number; vista: SabinaPropuestaVista | null }> {
  if (!esIdDePropuesta(args.id)) return { http: 404, vista: null };
  const vista = await descartarBajoCandado({
    ctx: args.ctx,
    db: dbDe(args.db),
    id: args.id,
    motivo: "usuario",
    ahora: args.ahora ?? Date.now,
    req: args.req,
  });
  if (!vista) return { http: 404, vista: null };
  return { http: vista.estado === "descartada" ? 200 : 409, vista };
}

/** ¿Esta persona tiene en esta clínica una propuesta creada DESPUÉS de esta? */
async function hayOtraMasNueva(tx: TxPropuestas, ctx: SabinaCtx, id: string, creadaEn: number): Promise<boolean> {
  const nuevas = await tx.auditLog.findMany({
    where: {
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: ENTIDAD_PROPUESTA,
      action: EVENTO.proponer,
      createdAt: { gt: new Date(creadaEn) },
    },
    select: { entityId: true },
    take: 2,
  });
  return nuevas.some((n) => n.entityId !== id);
}

/* ═══════════════════════════════════════════════════════════════════════
   CONSULTAR (solo lectura: «¿qué pasó con esta propuesta?»)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * La vista de una propuesta, sin tocar nada. Es lo que usa la pantalla cuando no
 * sabe qué pasó (se cortó la red al confirmar) o cuando su copia local puede
 * estar vieja (llegó otra propuesta, venció el plazo): así nunca dice «no se hizo
 * nada» de algo que se confirmó desde otra pestaña.
 */
export async function consultarPropuesta(args: {
  ctx: Pick<SabinaCtx, "clinicId" | "userId">;
  id: string;
  db?: DbPropuestas;
  ahora?: () => number;
}): Promise<SabinaPropuestaVista | null> {
  if (!esIdDePropuesta(args.id) || !args.ctx?.clinicId || !args.ctx?.userId) return null;
  const eventos = await eventosDe(dbDe(args.db), args.ctx.clinicId, args.id);
  return vistaDePropuesta(args.id, eventos, args.ctx.userId, (args.ahora ?? Date.now)());
}

/* ═══════════════════════════════════════════════════════════════════════
   CONFIRMAR
   ═══════════════════════════════════════════════════════════════════════ */

export interface RegistroLlamada {
  metodo: string;
  ruta: string;
  status: number;
  cuerpo: unknown;
  ms: number;
}

export interface DesenlaceConfirmacion {
  http: number;
  vista: SabinaPropuestaVista | null;
}

const METODOS_ESCRITURA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function paraRastro(valor: unknown): unknown {
  let texto: string;
  try {
    texto = JSON.stringify(valor ?? null);
  } catch {
    return "(no serializable)";
  }
  if (texto.length <= SABINA_CUERPO_RASTRO_MAX_CHARS) return valor ?? null;
  return { recortado: true, inicio: texto.slice(0, SABINA_CUERPO_RASTRO_MAX_CHARS) };
}

/**
 * Acuña la llave de UNA propuesta ya reclamada. No se exporta: fuera de este
 * archivo no hay forma de fabricar una llave que `llamar` acepte, y la que existe
 * muere al terminar `ejecutar`.
 */
function acunarLlave(
  propuestaId: string,
  req: PeticionOrigen,
  registro: RegistroLlamada[],
  ctx: Pick<SabinaCtx, "role" | "permissionsOverride">,
) {
  let viva = true;
  const llave: LlaveEscritura = Object.freeze({
    propuestaId,
    async llamar(manejador: Parameters<LlaveEscritura["llamar"]>[0], peticion: PeticionEndpoint): Promise<RespuestaEndpoint> {
      if (!viva) throw new Error("sabina_llave_revocada: la ejecución de esta propuesta ya terminó");
      // Cinturón: una llave que se colara al bucle del modelo tampoco escribe.
      if (enSoloLectura()) throw new EscrituraBloqueada("llave.llamar", "fase de solo lectura");
      const metodo = String(peticion?.metodo ?? "").toUpperCase();
      if (!METODOS_ESCRITURA.has(metodo)) throw new Error(`sabina_llamada_invalida: método ${metodo}`);
      const ruta = String(peticion?.ruta ?? "");
      if (!ruta.startsWith("/api/") || ruta.includes("://")) throw new Error(`sabina_llamada_invalida: ruta ${ruta}`);

      const headers = new Headers(req.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      const interna = new NextRequest(new URL(ruta, new URL(req.url).origin), {
        method: metodo,
        headers,
        body: peticion.cuerpo === undefined ? undefined : JSON.stringify(peticion.cuerpo),
      });

      const t0 = Date.now();
      let res: Response;
      try {
        // El handler mira los permisos de la sesión (los del usuario); con esto
        // mira además los de Sabina, que ya vienen recortados en el ctx.
        res = await conPermisosDeSabina(ctx, async () => manejador(interna, { params: peticion.params ?? {} }));
      } catch (e) {
        registro.push({ metodo, ruta, status: 0, cuerpo: e instanceof Error ? e.message : "excepcion", ms: Date.now() - t0 });
        throw e;
      }
      const texto = await res.text().catch(() => "");
      let cuerpo: unknown = null;
      try {
        cuerpo = texto ? JSON.parse(texto) : null;
      } catch {
        cuerpo = null;
      }
      registro.push({ metodo, ruta, status: res.status, cuerpo: paraRastro(cuerpo ?? texto), ms: Date.now() - t0 });
      return { status: res.status, cuerpo };
    },
  });
  return { llave, revocar: () => { viva = false; } };
}

export async function confirmarPropuesta(args: {
  ctx: SabinaCtx;
  id: string;
  req: PeticionOrigen;
  acciones: readonly SabinaAccion[];
  db?: DbPropuestas;
  ahora?: () => number;
}): Promise<DesenlaceConfirmacion> {
  const { ctx, id } = args;
  const db = dbDe(args.db);
  const ahora = args.ahora ?? Date.now;
  if (!esIdDePropuesta(id)) return { http: 404, vista: null };

  /* ── 1. Reclamar, bajo candado ───────────────────────────────────── */
  const reclamo = await db.$transaction(async (tx) => {
    await candado(tx, id);
    const eventos = await eventosDe(tx, ctx.clinicId, id);
    let vista = vistaDePropuesta(id, eventos, ctx.userId, ahora());
    if (!vista) return { tipo: "no_encontrada" as const };
    if (vista.estado === "pendiente" && (await hayOtraMasNueva(tx, ctx, id, vista.creadaEn))) {
      // Solo vale la última. `guardarPropuesta` ya retira las pendientes, pero dos
      // preguntas a la vez (dos pestañas) pueden dejar dos vivas: aquí, bajo el
      // candado, la vieja se da por sustituida y no se ejecuta.
      await tx.auditLog.create(fila(ctx, id, EVENTO.descartar, { motivo: "reemplazada" }, args.req));
      vista = { ...vista, estado: "reemplazada" };
      return { tipo: "no_pendiente" as const, vista };
    }
    if (vista.estado !== "pendiente") {
      await tx.auditLog.create(fila(ctx, id, EVENTO.rechazo, { motivo: vista.estado }, args.req));
      return { tipo: "no_pendiente" as const, vista };
    }
    await tx.auditLog.create(
      fila(ctx, id, EVENTO.confirmar, { accion: vista.accion, frase: vista.tarjeta.frase }, args.req),
    );
    const proponer = eventos.find((e) => e.action === EVENTO.proponer)!;
    return { tipo: "reclamada" as const, vista, cambios: (proponer.changes ?? {}) as Record<string, unknown> };
  });

  if (reclamo.tipo === "no_encontrada") return { http: 404, vista: null };
  if (reclamo.tipo === "no_pendiente") {
    const v = reclamo.vista;
    const frase =
      v.estado === "caducada"
        ? FRASE.caducada
        : v.estado === "descartada"
          ? FRASE.descartada
          : v.estado === "reemplazada"
            ? FRASE.reemplazada
            : v.estado === "en_curso"
              ? FRASE.enCurso
              : v.resultado?.frase ?? FRASE.enCurso;
    const resultado: ResultadoVista = v.resultado ?? { ok: false, tipo: v.estado, frase };
    return { http: v.estado === "caducada" ? 410 : 409, vista: { ...v, resultado } };
  }

  /* ── 2. Recomprobar y ejecutar ───────────────────────────────────── */
  const { vista, cambios } = reclamo;
  const t0 = ahora();
  const llamadas: RegistroLlamada[] = [];
  let resultado: ResultadoVista;
  let entidad: { tipo: string; id: string } | undefined;

  const accion = args.acciones.find((a) => a.nombre === vista.accion);
  if (!accion) {
    resultado = { ok: false, tipo: "error", frase: FRASE.accionDesconocida };
  } else if (!tienePermiso(ctx, accion.permiso)) {
    resultado = {
      ok: false,
      tipo: "sin_permiso",
      frase: fraseSinPermisoAccion(accion.queHace, causaSinPermiso(ctx, accion.permiso)),
    };
  } else {
    const datos = accion.datos.safeParse(cambios.datos);
    if (!datos.success) {
      resultado = { ok: false, tipo: "error", frase: FRASE.errorInterno };
    } else {
      let huella: string | null = null;
      try {
        huella = String((await soloLectura(`huella de ${accion.nombre}`, () => accion.huella(ctx, datos.data))) ?? "");
      } catch (e) {
        console.error("[sabina] no se pudo recalcular la huella", {
          clinicId: ctx.clinicId,
          propuestaId: id,
          accion: accion.nombre,
          err: e instanceof Error ? e.message : "desconocido",
        });
      }
      if (huella === null) {
        resultado = { ok: false, tipo: "cambio", frase: FRASE.noComprobable };
      } else if (huella !== String(cambios.huella ?? "")) {
        resultado = { ok: false, tipo: "cambio", frase: FRASE.cambio };
      } else {
        const { llave, revocar } = acunarLlave(id, args.req, llamadas, ctx);
        try {
          const ej = await accion.ejecutar(llave, ctx, datos.data);
          if (ej && ej.ok === true) {
            // El enlace pasa por el mismo filtro que al leerlo: solo rutas de la app.
            const enlace = leerEnlace((ej as { enlace?: unknown }).enlace);
            resultado = { ok: true, tipo: "hecha", frase: ej.frase, ...(enlace ? { enlace } : {}) };
            entidad = ej.entidad;
          } else {
            const fallo = ej as { tipo?: string; frase?: string } | null;
            resultado = { ok: false, tipo: fallo?.tipo ?? "error", frase: fallo?.frase || FRASE.errorInterno };
          }
        } catch (e) {
          console.error("[sabina] la acción confirmada lanzó", {
            clinicId: ctx.clinicId,
            propuestaId: id,
            accion: accion.nombre,
            err: e instanceof Error ? e.message : "desconocido",
          });
          resultado = { ok: false, tipo: "error", frase: FRASE.errorInterno };
        } finally {
          revocar();
        }
      }
    }
  }

  /* ── 3. El rastro de lo que pasó ─────────────────────────────────── */
  try {
    await db.auditLog.create(
      fila(
        ctx,
        id,
        EVENTO.resultado,
        { accion: vista.accion, ok: resultado.ok, tipo: resultado.tipo, frase: resultado.frase, enlace: resultado.enlace ?? null, entidad: entidad ?? null, llamadas, ms: ahora() - t0 },
        args.req,
      ),
    );
  } catch (e) {
    // La acción ya corrió: no se le quita al usuario su resultado. Queda el
    // `sabina_confirmar` y la bitácora propia del endpoint.
    console.error("[sabina] no se pudo guardar el resultado de la propuesta", {
      clinicId: ctx.clinicId,
      propuestaId: id,
      err: e instanceof Error ? e.message : "desconocido",
    });
  }

  console.info("[sabina] propuesta confirmada", {
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    propuestaId: id,
    accion: vista.accion,
    ok: resultado.ok,
    tipo: resultado.tipo,
    llamadas: llamadas.map((l) => `${l.metodo} ${l.ruta} ${l.status}`),
    ms: ahora() - t0,
  });

  return {
    http: 200,
    vista: { ...vista, estado: resultado.ok ? "hecha" : "fallida", resultado },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LEER (para volver a pintar las tarjetas al abrir una conversación)
   ═══════════════════════════════════════════════════════════════════════ */

export async function propuestasDeConversacion(args: {
  /** clinicId y userId de la SESIÓN. */
  ctx: Pick<SabinaCtx, "clinicId" | "userId">;
  conversacionId: string;
  db?: DbPropuestas;
  ahora?: () => number;
}): Promise<SabinaPropuestaVista[]> {
  const db = dbDe(args.db);
  const { ctx } = args;
  if (!ctx?.clinicId || !ctx?.userId || !args.conversacionId) return [];
  const ahora = (args.ahora ?? Date.now)();
  const propuestas = await db.auditLog.findMany({
    where: {
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: ENTIDAD_PROPUESTA,
      action: EVENTO.proponer,
      changes: { path: ["conversacionId"], equals: args.conversacionId },
    },
    select: { entityId: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const ids = propuestas.map((p) => p.entityId).filter(esIdDePropuesta);
  if (ids.length === 0) return [];
  const eventos = await db.auditLog.findMany({
    where: { clinicId: ctx.clinicId, entityType: ENTIDAD_PROPUESTA, entityId: { in: ids } },
    select: { entityId: true, action: true, userId: true, createdAt: true, changes: true },
    orderBy: { createdAt: "asc" },
  });
  return ids
    .map((id) => vistaDePropuesta(id, eventos.filter((e) => e.entityId === id), ctx.userId, ahora))
    .filter((v): v is SabinaPropuestaVista => v !== null)
    .sort((a, b) => a.creadaEn - b.creadaEn);
}
