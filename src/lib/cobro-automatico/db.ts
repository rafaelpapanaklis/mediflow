// Cobro automático (ws1-t6) — las tablas, por SQL crudo.
//
// Tablas NUEVAS (sql/ws1-t6-cobro-automatico-mp.sql), fuera de schema.prisma a
// propósito: el código se despliega antes de que Rafael pegue el SQL y un modelo
// de Prisma sin su tabla tumba cualquier consulta. Mientras no existan:
//   · se pregunta con `to_regclass` (nunca falla, no ensucia los logs de
//     Postgres de producción con «relation does not exist»);
//   · la respuesta vive en `globalThis` (sobrevive a las recargas de `next dev`):
//     «sí existen» para siempre, «no existen» se vuelve a preguntar cada 10 min;
//   · sin tablas no se consulta ninguna: la función entera está apagada y oculta.
//
// Multi-tenant: toda lectura/escritura lleva `clinicId`, salvo las dos que usa el
// webhook para ENCONTRAR la fila por el id de Mercado Pago (después se trabaja
// con el `clinicId` de esa fila, nunca con uno del cuerpo).

import { randomUUID } from "crypto";
import type { prisma } from "@/lib/prisma";
import { normalizarEstado, type EstadoCobro } from "./core";

export type Db = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

/* ── ¿Existen las tablas? ─────────────────────────────────────────────── */

const CLAVE = Symbol.for("dalecontrol.cobro-automatico.tablas");
const REPREGUNTAR_MS = 10 * 60 * 1000;
type Memoria = { existen: boolean; at: number };
const g = globalThis as unknown as Record<symbol, Memoria | undefined>;

/**
 * true = las tres tablas existen · false = falta alguna · null = no se pudo
 * preguntar (la base no contesta, o un doble de pruebas que no conoce la consulta).
 * `forzar` vuelve a preguntar aunque se recuerde «no» (quien está usando justo
 * esta función, p. ej. Configuración).
 */
export async function tablasListas(db: Db, forzar = false): Promise<boolean | null> {
  const m = g[CLAVE];
  if (m && (m.existen || (!forzar && Date.now() - m.at < REPREGUNTAR_MS))) return m.existen;
  try {
    const filas = await db.$queryRaw<{ existen: boolean }[]>`
      SELECT (to_regclass('public.mp_cobro_automatico_config') IS NOT NULL
          AND to_regclass('public.mp_cobros_automaticos') IS NOT NULL
          AND to_regclass('public.mp_cobros_automaticos_intentos') IS NOT NULL) AS existen`;
    const existen = filas?.[0]?.existen === true;
    g[CLAVE] = { existen, at: Date.now() };
    return existen;
  } catch {
    return null;
  }
}

/** Solo para las pruebas. */
export function _olvidarTablas(valor?: boolean): void {
  g[CLAVE] = valor === undefined ? undefined : { existen: valor, at: Date.now() };
}

/* ── Filas ────────────────────────────────────────────────────────────── */

export interface FilaCobro {
  id: string;
  clinicId: string;
  invoiceId: string;
  patientId: string | null;
  treatmentPlanId: string | null;
  mpPreapprovalId: string | null;
  mpCollectorId: string | null;
  status: EstadoCobro;
  amount: number;
  payerEmail: string;
  initPoint: string | null;
  startDate: string | null;
  endDate: string | null;
  nextPaymentDate: Date | null;
  cancelReason: string | null;
  lastSyncAt: Date | null;
  /** Día en que una pausa «del ciclo» se reanuda sola ("YYYY-MM-DD"). */
  reanudarEl: string | null;
  /** "manual" (la pausó alguien desde el caso) · "ciclo" (la mensualidad ya se pagó a mano) · null. */
  pausaMotivo: "manual" | "ciclo" | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilaIntento {
  id: string;
  clinicId: string;
  cobroId: string;
  mpAuthorizedPaymentId: string;
  mpPaymentId: string | null;
  status: string | null;
  paymentStatus: string | null;
  statusDetail: string | null;
  amount: number | null;
  paymentRowId: string | null;
  /** Fila de patient_credits si el dinero (o parte) quedó a favor del paciente (F12). */
  creditoId: string | null;
  /** Fecha del cobro según MP (debit_date). */
  debitDate: string | null;
  avisoRecepcion: boolean;
  /** Por qué se avisa a recepción cuando no es un rechazo (p. ej. dinero que quedó a favor). */
  avisoMotivo: string | null;
  revisadoAt: Date | null;
  createdAt: Date;
}

function dia(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function fecha(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aCobro(f: Record<string, unknown>): FilaCobro {
  return {
    id: String(f.id),
    clinicId: String(f.clinicId),
    invoiceId: String(f.invoiceId),
    patientId: (f.patientId as string) ?? null,
    treatmentPlanId: (f.treatmentPlanId as string) ?? null,
    mpPreapprovalId: (f.mpPreapprovalId as string) ?? null,
    mpCollectorId: (f.mpCollectorId as string) ?? null,
    status: normalizarEstado(f.status),
    amount: num(f.amount),
    payerEmail: String(f.payerEmail ?? ""),
    initPoint: (f.initPoint as string) ?? null,
    startDate: dia(f.startDate),
    endDate: dia(f.endDate),
    nextPaymentDate: fecha(f.nextPaymentDate),
    cancelReason: (f.cancelReason as string) ?? null,
    lastSyncAt: fecha(f.lastSyncAt),
    reanudarEl: dia(f.reanudarEl),
    pausaMotivo: f.pausaMotivo === "manual" || f.pausaMotivo === "ciclo" ? f.pausaMotivo : null,
    createdById: (f.createdById as string) ?? null,
    createdAt: fecha(f.createdAt) ?? new Date(0),
    updatedAt: fecha(f.updatedAt) ?? new Date(0),
  };
}

function aIntento(f: Record<string, unknown>): FilaIntento {
  return {
    id: String(f.id),
    clinicId: String(f.clinicId),
    cobroId: String(f.cobroId),
    mpAuthorizedPaymentId: String(f.mpAuthorizedPaymentId),
    mpPaymentId: (f.mpPaymentId as string) ?? null,
    status: (f.status as string) ?? null,
    paymentStatus: (f.paymentStatus as string) ?? null,
    statusDetail: (f.statusDetail as string) ?? null,
    amount: f.amount == null ? null : num(f.amount),
    paymentRowId: (f.paymentRowId as string) ?? null,
    creditoId: (f.creditoId as string) ?? null,
    debitDate: f.debitDate ? (f.debitDate instanceof Date ? f.debitDate.toISOString() : String(f.debitDate)) : null,
    avisoRecepcion: f.avisoRecepcion === true,
    avisoMotivo: (f.avisoMotivo as string) ?? null,
    revisadoAt: fecha(f.revisadoAt),
    createdAt: fecha(f.createdAt) ?? new Date(0),
  };
}

/* ── El repositorio ───────────────────────────────────────────────────── */

export interface RepoCobros {
  leerInterruptor(clinicId: string): Promise<boolean>;
  guardarInterruptor(clinicId: string, enabled: boolean, userId: string | null): Promise<void>;
  contarVivos(clinicId: string): Promise<number>;
  /** El más reciente de la factura (vivo o no), para pintar el estado. */
  ultimoDeFactura(clinicId: string, invoiceId: string): Promise<FilaCobro | null>;
  vivoDeFactura(clinicId: string, invoiceId: string): Promise<FilaCobro | null>;
  porId(clinicId: string, id: string): Promise<FilaCobro | null>;
  /** Webhook: SIN clinicId (aún no se sabe); después se usa el de la fila. */
  porPreapproval(mpPreapprovalId: string): Promise<FilaCobro | null>;
  /** Inserta en `creating`. null = ya hay uno vivo para esa factura (índice único). */
  crear(f: {
    clinicId: string; invoiceId: string; patientId: string | null; treatmentPlanId: string | null;
    mpCollectorId: string; amount: number; payerEmail: string; startDate: string; endDate: string; createdById: string | null;
  }): Promise<FilaCobro | null>;
  actualizar(clinicId: string, id: string, c: Partial<Pick<FilaCobro,
    "mpPreapprovalId" | "status" | "amount" | "initPoint" | "nextPaymentDate" | "cancelReason" | "lastSyncAt" | "reanudarEl" | "pausaMotivo">>): Promise<void>;
  /** Solo una fila `creating` cuyo alta en MP falló. */
  borrarCreando(clinicId: string, id: string): Promise<void>;
  intentoPorMp(clinicId: string, mpAuthorizedPaymentId: string): Promise<FilaIntento | null>;
  guardarIntento(i: {
    clinicId: string; cobroId: string; mpAuthorizedPaymentId: string; mpPaymentId: string | null;
    status: string | null; paymentStatus: string | null; statusDetail: string | null; amount: number | null;
    paymentRowId?: string | null; avisoRecepcion?: boolean;
    debitDate?: string | null; creditoId?: string | null; avisoMotivo?: string | null;
  }): Promise<FilaIntento>;
  /** Los cobros de MP de una suscripción (para saber qué cargos ya hizo). */
  intentosDeCobro(clinicId: string, cobroId: string): Promise<FilaIntento[]>;
  /** El cron: las suscripciones que cobran o están pausadas, de TODAS las clínicas (después se trabaja con el clinicId de cada fila). */
  listarParaCron(limite: number): Promise<FilaCobro[]>;
  porRevisar(clinicId: string): Promise<Array<FilaIntento & { paciente: string; invoiceNumber: string | null; invoiceId: string }>>;
  marcarRevisado(clinicId: string, intentoId: string, userId: string): Promise<boolean>;
}

export function repoSql(db: Db): RepoCobros {
  return {
    async leerInterruptor(clinicId) {
      if (!clinicId) return false;
      const f = await db.$queryRaw<{ enabled: boolean }[]>`
        SELECT "enabled" FROM "mp_cobro_automatico_config" WHERE "clinicId" = ${clinicId} LIMIT 1`;
      return f?.[0]?.enabled === true;
    },
    async guardarInterruptor(clinicId, enabled, userId) {
      if (!clinicId) return;
      await db.$executeRaw`
        INSERT INTO "mp_cobro_automatico_config" ("clinicId","enabled","updatedById","updatedAt")
        VALUES (${clinicId}, ${enabled}, ${userId}, now())
        ON CONFLICT ("clinicId") DO UPDATE SET "enabled" = EXCLUDED."enabled",
          "updatedById" = EXCLUDED."updatedById", "updatedAt" = now()`;
    },
    async contarVivos(clinicId) {
      if (!clinicId) return 0;
      const f = await db.$queryRaw<{ n: unknown }[]>`
        SELECT count(*)::int AS n FROM "mp_cobros_automaticos"
         WHERE "clinicId" = ${clinicId} AND "status" IN ('pending','authorized','paused')`;
      return num(f?.[0]?.n);
    },
    async ultimoDeFactura(clinicId, invoiceId) {
      if (!clinicId || !invoiceId) return null;
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos"
         WHERE "clinicId" = ${clinicId} AND "invoiceId" = ${invoiceId}
         ORDER BY "createdAt" DESC LIMIT 1`;
      return f?.[0] ? aCobro(f[0]) : null;
    },
    async vivoDeFactura(clinicId, invoiceId) {
      if (!clinicId || !invoiceId) return null;
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos"
         WHERE "clinicId" = ${clinicId} AND "invoiceId" = ${invoiceId}
           AND "status" IN ('creating','pending','authorized','paused')
         ORDER BY "createdAt" DESC LIMIT 1`;
      return f?.[0] ? aCobro(f[0]) : null;
    },
    async porId(clinicId, id) {
      if (!clinicId || !id) return null;
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos" WHERE "clinicId" = ${clinicId} AND "id" = ${id} LIMIT 1`;
      return f?.[0] ? aCobro(f[0]) : null;
    },
    async porPreapproval(mpPreapprovalId) {
      if (!mpPreapprovalId) return null;
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos" WHERE "mpPreapprovalId" = ${mpPreapprovalId} LIMIT 1`;
      return f?.[0] ? aCobro(f[0]) : null;
    },
    async crear(c) {
      if (!c.clinicId || !c.invoiceId) return null;
      const id = randomUUID();
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        INSERT INTO "mp_cobros_automaticos"
          ("id","clinicId","invoiceId","patientId","treatmentPlanId","mpCollectorId","status","amount",
           "payerEmail","startDate","endDate","createdById","createdAt","updatedAt")
        VALUES (${id}, ${c.clinicId}, ${c.invoiceId}, ${c.patientId}, ${c.treatmentPlanId}, ${c.mpCollectorId},
                'creating', ${c.amount}, ${c.payerEmail}, ${c.startDate}::date, ${c.endDate}::date, ${c.createdById}, now(), now())
        ON CONFLICT DO NOTHING
        RETURNING *`;
      return f?.[0] ? aCobro(f[0]) : null;
    },
    async actualizar(clinicId, id, c) {
      if (!clinicId || !id) return;
      // Un UPDATE por campo presente: SQL crudo sin armar texto a mano.
      if (c.mpPreapprovalId !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "mpPreapprovalId" = ${c.mpPreapprovalId}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.initPoint !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "initPoint" = ${c.initPoint}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.status !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "status" = ${c.status}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.amount !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "amount" = ${c.amount}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.nextPaymentDate !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "nextPaymentDate" = ${c.nextPaymentDate}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.cancelReason !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "cancelReason" = ${c.cancelReason}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.lastSyncAt !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "lastSyncAt" = ${c.lastSyncAt} WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.reanudarEl !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "reanudarEl" = ${c.reanudarEl}::date, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
      if (c.pausaMotivo !== undefined)
        await db.$executeRaw`UPDATE "mp_cobros_automaticos" SET "pausaMotivo" = ${c.pausaMotivo}, "updatedAt" = now() WHERE "clinicId" = ${clinicId} AND "id" = ${id}`;
    },
    async borrarCreando(clinicId, id) {
      if (!clinicId || !id) return;
      await db.$executeRaw`DELETE FROM "mp_cobros_automaticos" WHERE "clinicId" = ${clinicId} AND "id" = ${id} AND "status" = 'creating'`;
    },
    async intentoPorMp(clinicId, mpAuthorizedPaymentId) {
      if (!clinicId || !mpAuthorizedPaymentId) return null;
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos_intentos"
         WHERE "clinicId" = ${clinicId} AND "mpAuthorizedPaymentId" = ${mpAuthorizedPaymentId} LIMIT 1`;
      return f?.[0] ? aIntento(f[0]) : null;
    },
    async guardarIntento(i) {
      const id = randomUUID();
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        INSERT INTO "mp_cobros_automaticos_intentos"
          ("id","clinicId","cobroId","mpAuthorizedPaymentId","mpPaymentId","status","paymentStatus","statusDetail",
           "amount","paymentRowId","creditoId","debitDate","avisoRecepcion","avisoMotivo","createdAt","updatedAt")
        VALUES (${id}, ${i.clinicId}, ${i.cobroId}, ${i.mpAuthorizedPaymentId}, ${i.mpPaymentId}, ${i.status},
                ${i.paymentStatus}, ${i.statusDetail}, ${i.amount}, ${i.paymentRowId ?? null}, ${i.creditoId ?? null},
                ${i.debitDate ?? null}::timestamptz, ${i.avisoRecepcion ?? false}, ${i.avisoMotivo ?? null}, now(), now())
        ON CONFLICT ("mpAuthorizedPaymentId") DO UPDATE SET
          "mpPaymentId" = COALESCE(EXCLUDED."mpPaymentId", "mp_cobros_automaticos_intentos"."mpPaymentId"),
          "status" = EXCLUDED."status",
          "paymentStatus" = EXCLUDED."paymentStatus",
          "statusDetail" = EXCLUDED."statusDetail",
          "amount" = COALESCE(EXCLUDED."amount", "mp_cobros_automaticos_intentos"."amount"),
          "paymentRowId" = COALESCE("mp_cobros_automaticos_intentos"."paymentRowId", EXCLUDED."paymentRowId"),
          "creditoId" = COALESCE("mp_cobros_automaticos_intentos"."creditoId", EXCLUDED."creditoId"),
          "debitDate" = COALESCE(EXCLUDED."debitDate", "mp_cobros_automaticos_intentos"."debitDate"),
          "avisoMotivo" = COALESCE(EXCLUDED."avisoMotivo", "mp_cobros_automaticos_intentos"."avisoMotivo"),
          -- El aviso se ENCIENDE con un rechazo y se APAGA solo si el cobro termina aprobado.
          "avisoRecepcion" = EXCLUDED."avisoRecepcion",
          "updatedAt" = now()
        WHERE "mp_cobros_automaticos_intentos"."clinicId" = EXCLUDED."clinicId"
        RETURNING *`;
      if (!f?.[0]) throw new Error("el intento pertenece a otra clínica");
      return aIntento(f[0]);
    },
    async intentosDeCobro(clinicId, cobroId) {
      if (!clinicId || !cobroId) return [];
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos_intentos"
         WHERE "clinicId" = ${clinicId} AND "cobroId" = ${cobroId}
         ORDER BY "createdAt" ASC LIMIT 200`;
      return (f ?? []).map(aIntento);
    },
    async listarParaCron(limite) {
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "mp_cobros_automaticos"
         WHERE "status" IN ('authorized','paused')
         ORDER BY "reanudarEl" ASC NULLS LAST, "updatedAt" ASC
         LIMIT ${Math.max(1, Math.min(2000, Math.floor(limite)))}`;
      return (f ?? []).map(aCobro);
    },
    async porRevisar(clinicId) {
      if (!clinicId) return [];
      const f = await db.$queryRaw<Record<string, unknown>[]>`
        SELECT i.*, c."invoiceId" AS "invoiceIdCobro", inv."invoiceNumber",
               trim(coalesce(p."firstName",'') || ' ' || coalesce(p."lastName",'')) AS "paciente"
          FROM "mp_cobros_automaticos_intentos" i
          JOIN "mp_cobros_automaticos" c ON c."id" = i."cobroId" AND c."clinicId" = i."clinicId"
          LEFT JOIN "invoices" inv ON inv."id" = c."invoiceId" AND inv."clinicId" = c."clinicId"
          LEFT JOIN "patients" p ON p."id" = c."patientId" AND p."clinicId" = c."clinicId"
         WHERE i."clinicId" = ${clinicId} AND i."avisoRecepcion" = true AND i."revisadoAt" IS NULL
         ORDER BY i."createdAt" DESC LIMIT 20`;
      return (f ?? []).map((x) => ({
        ...aIntento(x),
        paciente: String(x.paciente ?? "").trim() || "Paciente",
        invoiceNumber: (x.invoiceNumber as string) ?? null,
        invoiceId: String(x.invoiceIdCobro ?? ""),
      }));
    },
    async marcarRevisado(clinicId, intentoId, userId) {
      if (!clinicId || !intentoId) return false;
      const n = await db.$executeRaw`
        UPDATE "mp_cobros_automaticos_intentos" SET "revisadoAt" = now(), "revisadoById" = ${userId}, "updatedAt" = now()
         WHERE "clinicId" = ${clinicId} AND "id" = ${intentoId} AND "revisadoAt" IS NULL`;
      return Number(n) > 0;
    },
  };
}
