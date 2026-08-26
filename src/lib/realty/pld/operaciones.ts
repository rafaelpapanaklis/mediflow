// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — LAS OPERACIONES contra el umbral.
//
// Aquí se juntan las tres piezas: la operación (RealtyDeal), el efectivo
// que se liquidó (RealtyPayment con method EFECTIVO) y el parámetro vigente.
// La comparación la hace evaluarOperacion() de umbrales.ts — este archivo
// solo trae los datos y guarda las decisiones.
//
// ── 🔴 DE DÓNDE SALE EL EFECTIVO ──────────────────────────────────────
// RealtyDeal no tiene columna de efectivo, y no se le agrega: el dinero
// real del vertical vive en RealtyPayment, con su `method`. Así que el
// efectivo de una operación es la SUMA de sus pagos en efectivo.
//
// Cuando la inmobiliaria no captura los pagos en DaleControl, esa suma es
// cero y la bandera roja nunca saltaría. Para eso existe `cashDeclared` en
// RealtyPldOperation: un número que alguien declara a mano.
//
// PRECEDENCIA: si `cashDeclared` está capturado, MANDA. No se suma a los
// pagos. Sumarlos contaría dos veces el mismo billete y levantaría una
// bandera roja falsa — y una bandera falsa es la forma más rápida de que
// dejen de creerle a las banderas.
//
// ── 🔴 QUÉ OPERACIONES CUENTAN ────────────────────────────────────────
// Solo las CERRADAS y con fecha de cierre. Una operación EN_PROCESO todavía
// no obliga a nada y una CANCELADA nunca obligó; meterlas en el aviso del
// mes sería reportar cosas que no pasaron.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { toCents } from "@/lib/realty/calc/money";
import type { EstadoExpediente, OperacionRow } from "./contrato";
// No hay ciclo: expedientes.ts no importa este archivo.
import { leerBeneficiarios } from "./expedientes";
import {
  estadoDeExpediente,
  evaluarOperacion,
  periodoDeFecha,
  sumarHoras,
  type PldParams,
} from "./umbrales";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export interface OperacionesCargadas {
  operaciones: OperacionRow[];
  /** contactId → tiene alguna operación por encima del umbral. */
  rebasa: Set<string>;
  /** contactId → tiene alguna operación con efectivo prohibido. */
  efectivo: Set<string>;
}

/**
 * Las operaciones cerradas de la cuenta, ya evaluadas contra el umbral.
 *
 * `desde` acota la ventana. El tablero pide los últimos meses; el archivo
 * de un aviso pide exactamente su periodo.
 *
 * 🔴 Sin parámetros vigentes (`params` null) NO se inventa una evaluación:
 * las operaciones salen con nivel NINGUNO y todas las banderas apagadas, y
 * la pantalla enseña arriba el aviso de "captura el parámetro". Rellenar
 * con un umbral "razonable" haría creer a la inmobiliaria que ya comparó.
 */
export async function cargarOperaciones(
  ctx: RealtyContext,
  params: PldParams | null,
  opciones: {
    desde?: Date | null;
    periodMonth?: string | null;
    /** Acota a un cliente. Lo usa el detalle de UN expediente. */
    contactId?: string | null;
    take?: number;
  } = {},
): Promise<OperacionesCargadas> {
  const take = Math.min(1000, Math.max(1, opciones.take ?? 400));
  const timeZone = ctx.account.timezone || "America/Mexico_City";

  const where: Prisma.RealtyDealWhereInput = {
    accountId: ctx.accountId,
    status: "CERRADO",
    // NOT null y no `{ gte: … }` a secas: una operación cerrada sin fecha no
    // cae en ningún periodo y no se puede avisar.
    closedAt: opciones.desde ? { gte: opciones.desde } : { not: null },
  };
  // 🔴 A MANO y nunca `contactId: opciones.contactId ?? undefined`: un
  // `undefined` en el where BORRA el filtro, y en el detalle de un
  // expediente eso significaría evaluar la cartera entera para pintar el
  // riesgo de una sola persona.
  if (opciones.contactId) where.contactId = opciones.contactId;

  const filas = await prisma.realtyDeal.findMany({
    where,
    orderBy: { closedAt: "desc" },
    take,
    select: {
      id: true,
      propertyId: true,
      kind: true,
      status: true,
      closedAt: true,
      amount: true,
      contactId: true,
      property: { select: { title: true } },
      contact: {
        select: {
          id: true,
          name: true,
          // El expediente del cliente, para saber si está integrado. Un
          // include NO es un JOIN: Prisma lanza su propia consulta, pero
          // aquí son 400 filas como mucho y evita una segunda vuelta.
          pldFiles: {
            select: {
              id: true,
              personKind: true,
              rfc: true,
              curp: true,
              occupation: true,
              address: true,
              pep: true,
              pepAskedAt: true,
              beneficialOwners: true,
              documents: { select: { kind: true, expiresAt: true, archivedAt: true } },
            },
          },
        },
      },
      // Pagos EN EFECTIVO de la operación. Los demás métodos no importan
      // para el tope: la ley limita el efectivo, no el SPEI.
      payments: {
        where: { method: "EFECTIVO" },
        select: { amount: true },
      },
      pldOps: {
        select: {
          cashDeclared: true,
          cashAckAt: true,
          cashAckNote: true,
          urgentFlaggedAt: true,
          urgentReason: true,
          urgentDueAt: true,
          urgentDoneAt: true,
          noticeId: true,
          notice: { select: { status: true } },
        },
      },
    },
  });

  const hoy = new Date();
  const rebasa = new Set<string>();
  const efectivo = new Set<string>();
  const operaciones: OperacionRow[] = [];

  for (const d of filas) {
    if (!d.closedAt) continue;
    const periodo = periodoDeFecha(d.closedAt, timeZone);
    if (opciones.periodMonth && periodo !== opciones.periodMonth) continue;

    const pld = d.pldOps[0] ?? null;
    const pagosEfectivoCents = d.payments.reduce((acc, p) => acc + toCents(Number(p.amount)), 0);
    // Ver la cabecera: lo declarado MANDA, no se suma.
    const efectivoCents =
      pld?.cashDeclared != null ? toCents(Number(pld.cashDeclared)) : pagosEfectivoCents;
    const montoCents = toCents(Number(d.amount));

    const ev = params
      ? evaluarOperacion({ montoCents, efectivoCents }, params)
      : null;

    let estadoExpediente: EstadoExpediente | null = null;
    let expedienteId: string | null = null;
    const file = d.contact?.pldFiles?.[0] ?? null;
    if (file) {
      expedienteId = file.id;
      estadoExpediente = estadoDeExpediente(
        {
          personKind: file.personKind,
          rfc: file.rfc,
          curp: file.curp,
          occupation: file.occupation,
          address: file.address,
          pep: file.pep,
          pepAskedAt: file.pepAskedAt,
          beneficialOwnersCount: leerBeneficiarios(file.beneficialOwners).length,
        },
        file.documents,
        hoy,
      ).estado;
    }

    if (d.contactId && ev?.requiereExpediente) rebasa.add(d.contactId);
    if (d.contactId && ev?.efectivoProhibido) efectivo.add(d.contactId);

    operaciones.push({
      dealId: d.id,
      propertyId: d.propertyId,
      propertyTitle: d.property?.title ?? "Inmueble sin título",
      contactId: d.contactId,
      contactName: d.contact?.name ?? null,
      kind: d.kind,
      status: d.status,
      closedAt: iso(d.closedAt),
      amount: montoCents / 100,
      efectivo: efectivoCents / 100,
      periodMonth: periodo,
      nivel: ev?.nivel ?? "NINGUNO",
      requiereExpediente: ev?.requiereExpediente ?? false,
      requiereAviso: ev?.requiereAviso ?? false,
      efectivoProhibido: ev?.efectivoProhibido ?? false,
      estadoExpediente,
      expedienteId,
      cashAckAt: iso(pld?.cashAckAt ?? null),
      cashAckNote: pld?.cashAckNote ?? null,
      urgentFlaggedAt: iso(pld?.urgentFlaggedAt ?? null),
      urgentReason: pld?.urgentReason ?? null,
      urgentDueAt: iso(pld?.urgentDueAt ?? null),
      urgentDoneAt: iso(pld?.urgentDoneAt ?? null),
      noticeId: pld?.noticeId ?? null,
      presentada: pld?.notice?.status === "PRESENTADO",
    });
  }

  return { operaciones, rebasa, efectivo };
}

// ── Escritura: las decisiones de una persona ───────────────────────────

export interface ParcheOperacion {
  /** Efectivo declarado a mano, en PESOS. null lo borra y vuelve a mandar la suma de pagos. */
  cashDeclared?: number | null;
  /** Marcar la bandera roja del efectivo como revisada, con su justificación. */
  cashAckNote?: string | null;
  /** Levantar la alerta de 24 horas, con el motivo. */
  urgentReason?: string | null;
  /** Cerrar la alerta de 24 horas (ya se presentó). */
  urgentDone?: boolean;
}

/**
 * Crea o actualiza la fila PLD de una operación.
 *
 * 🔴 El dealId se comprueba contra la cuenta ANTES de escribir. Y el upsert
 * va por el índice COMPLETO (accountId, dealId): un upsert por un índice
 * parcial no compila, y uno por `dealId` solo permitiría que otra cuenta
 * pisara la fila.
 */
export async function guardarOperacion(
  ctx: RealtyContext,
  dealId: string,
  parche: ParcheOperacion,
  params: PldParams | null,
): Promise<{ ok: true } | { error: string }> {
  const deal = await prisma.realtyDeal.findFirst({
    where: { id: dealId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!deal) return { error: "Esa operación ya no existe." };

  const ahora = new Date();
  // Objeto de VALORES planos, no un UncheckedUpdateInput: así el mismo
  // objeto sirve para el `create` y para el `update` del upsert sin que uno
  // de los dos deje de compilar por los envoltorios `{ set: … }`.
  const data: {
    cashDeclared?: Prisma.Decimal | null;
    cashAckAt?: Date | null;
    cashAckById?: string | null;
    cashAckNote?: string | null;
    urgentFlaggedAt?: Date | null;
    urgentReason?: string | null;
    urgentDueAt?: Date | null;
    urgentDoneAt?: Date | null;
  } = {};

  if (parche.cashDeclared !== undefined) {
    if (parche.cashDeclared === null) {
      data.cashDeclared = null;
    } else {
      const n = Number(parche.cashDeclared);
      if (!Number.isFinite(n) || n < 0) return { error: "Ese monto en efectivo no se entiende." };
      data.cashDeclared = new Prisma.Decimal(n.toFixed(2));
    }
  }

  if (parche.cashAckNote !== undefined) {
    const nota = typeof parche.cashAckNote === "string" ? parche.cashAckNote.trim() : "";
    if (nota) {
      // 🔴 La bandera roja NO se apaga: se deja constancia de que alguien la
      // miró. La operación sigue saliendo marcada en el tablero.
      data.cashAckAt = ahora;
      data.cashAckById = ctx.realtyUserId;
      data.cashAckNote = nota.slice(0, 1200);
    } else {
      data.cashAckAt = null;
      data.cashAckById = null;
      data.cashAckNote = null;
    }
  }

  if (parche.urgentReason !== undefined) {
    const motivo = typeof parche.urgentReason === "string" ? parche.urgentReason.trim() : "";
    if (motivo) {
      if (!params) {
        // Sin el parámetro no se sabe de cuántas horas es el plazo. Poner
        // 24 aquí sería justo el número escrito en código que no puede haber.
        return {
          error:
            "No podemos calcular el plazo del aviso urgente: falta capturar el parámetro de horas en el panel de DaleControl.",
        };
      }
      data.urgentFlaggedAt = ahora;
      data.urgentReason = motivo.slice(0, 1200);
      data.urgentDueAt = sumarHoras(ahora, params.horasAvisoUrgente);
      data.urgentDoneAt = null;
    } else {
      data.urgentFlaggedAt = null;
      data.urgentReason = null;
      data.urgentDueAt = null;
      data.urgentDoneAt = null;
    }
  }

  if (parche.urgentDone !== undefined) {
    data.urgentDoneAt = parche.urgentDone ? ahora : null;
  }

  if (Object.keys(data).length === 0) {
    // 🔴 Un updateMany con data vacío devuelve count 0 y parece un fallo de
    // permisos. Se corta antes y se dice la verdad.
    return { error: "No mandaste ningún cambio." };
  }

  await prisma.realtyPldOperation.upsert({
    where: { accountId_dealId: { accountId: ctx.accountId, dealId } },
    create: { accountId: ctx.accountId, dealId, ...data },
    update: data,
  });
  return { ok: true };
}
