/**
 * Prueba de carga de `oportunidades_perdidas` contra una clínica GRANDE.
 * No es un test: es el instrumento con el que se midió lo que dice el reporte.
 *
 * Correr: npx tsx --test --experimental-test-module-mocks src/lib/sabina/tools/__tests__/escapa-carga.ts
 *
 * ⚠️ QUÉ MIDE Y QUÉ NO. El doble de base es un evaluador de `where` sobre arrays
 * en memoria: NO es Postgres. Así que estos números dicen dos cosas de verdad —
 *   (1) CUÁNTAS consultas se lanzan y contra qué tablas (las idas y vueltas al
 *       pooler son lo que se paga en red, y eso sí es igual en producción);
 *   (2) cuánto cuesta el trabajo en JS sobre resultados grandes (ordenar, cruzar
 *       planes con presupuestos, deduplicar caídas), que también es igual—
 * y NO dicen cuánto tarda Postgres en resolver cada `where`. Para eso está
 * sql/oportunidades-perdidas-indices.sql, que Rafael corre contra la base real.
 */

import "./preparar";
import { correrHerramienta } from "../base";
import { oportunidadesPerdidas } from "../oportunidades-perdidas";
import { crearBase, type Datos, type Fila } from "./doble-base";
import type { SabinaCtx } from "../../tipos";

const DIA_MS = 86_400_000;
const CL = "cl-grande";
const TZ = "America/Mexico_City";
const DOC = "u-doc-grande";

/** Siete años de clínica muy ocupada. Los tamaños son deliberadamente altos. */
const PACIENTES = 6_000;
const CITAS = 90_000;
const FACTURAS = 40_000;
const PRESUPUESTOS = 8_000;
const PLANES = 2_000;

function haceDias(n: number): Date {
  return new Date(Date.now() - n * DIA_MS);
}

function datosGrandes(): Datos {
  const patients: Fila[] = [];
  for (let i = 0; i < PACIENTES; i++) {
    patients.push({
      id: `p${i}`, clinicId: CL, firstName: "Pac", lastName: `N${i}`, patientNumber: `G${i}`,
      phone: `55${String(i).padStart(8, "0")}`, status: "ACTIVE", visibleUserIds: [],
      // Uno de cada cien, archivado por ARCO: el filtro tiene que costar poco.
      deletedAt: i % 100 === 0 ? haceDias(200) : null,
      primaryDoctorId: DOC, createdAt: haceDias(2500 - (i % 2500)),
    });
  }

  const appointments: Fila[] = [];
  for (let i = 0; i < CITAS; i++) {
    const hace = (i % 2555) - 30; // de hace siete años a dentro de un mes
    const estado = i % 9 === 0 ? "CANCELLED" : i % 17 === 0 ? "NO_SHOW" : "COMPLETED";
    appointments.push({
      id: `a${i}`, clinicId: CL, patientId: `p${i % PACIENTES}`, doctorId: DOC, type: "Consulta",
      status: estado, resourceId: null, startsAt: haceDias(hace), endsAt: haceDias(hace),
    });
  }

  const invoices: Fila[] = [];
  for (let i = 0; i < FACTURAS; i++) {
    const cobrada = i % 3 === 0;
    invoices.push({
      id: `i${i}`, invoiceNumber: `MF-${i}`, clinicId: CL, patientId: `p${i % PACIENTES}`,
      status: cobrada ? "PAID" : i % 11 === 0 ? "DRAFT" : i % 13 === 0 ? "CANCELLED" : "PENDING",
      total: 1000 + (i % 50) * 100, paid: cobrada ? 1000 + (i % 50) * 100 : 0,
      balance: cobrada ? 0 : 1000 + (i % 50) * 100, discount: 0,
      dueDate: i % 4 === 0 ? null : haceDias((i % 900) - 30),
      createdAt: haceDias(i % 2555), items: [],
    });
  }

  const quotes: Fila[] = [];
  for (let i = 0; i < PRESUPUESTOS; i++) {
    const estado = ["DRAFT", "PRESENTED", "ACCEPTED", "REJECTED", "EXPIRED"][i % 5];
    quotes.push({
      id: `q${i}`, clinicId: CL, patientId: `p${i % PACIENTES}`, folio: `P-${i}`,
      title: "Tratamiento", status: estado, total: 2000 + (i % 40) * 500,
      subtotal: 2000, discountAmount: 0,
      presentedAt: haceDias((i % 700) + 8), acceptedAt: estado === "ACCEPTED" ? haceDias((i % 700) + 8) : null,
      validUntil: haceDias((i % 700) - 30),
      invoiceId: i % 2 === 0 ? `i${i}` : null, treatmentPlanId: i % 7 === 0 ? `tp${i % PLANES}` : null,
      createdAt: haceDias((i % 700) + 10),
    });
  }

  const treatmentPlans: Fila[] = [];
  const treatmentSessions: Fila[] = [];
  for (let i = 0; i < PLANES; i++) {
    treatmentPlans.push({
      id: `tp${i}`, clinicId: CL, patientId: `p${i % PACIENTES}`, doctorId: DOC,
      name: "Plan", status: i % 4 === 0 ? "COMPLETED" : "ACTIVE",
      totalCost: 10_000 + (i % 30) * 1000, totalSessions: 4, sessionIntervalDays: 30,
      startDate: haceDias((i % 900) + 60), nextExpectedDate: haceDias((i % 900) - 30),
      createdAt: haceDias((i % 900) + 60),
    });
    for (let s = 0; s < (i % 4); s++) {
      treatmentSessions.push({ id: `ts${i}-${s}`, treatmentId: `tp${i}`, sessionNumber: s + 1, completedAt: haceDias(100), createdAt: haceDias(100) });
    }
  }

  const bookingRequests: Fila[] = [];
  for (let i = 0; i < 1_500; i++) {
    bookingRequests.push({
      id: `br${i}`, clinicId: CL, status: i % 3 === 0 ? "PENDIENTE" : "ACEPTADA",
      patientName: `Web ${i}`, patientWhatsapp: `52${String(i).padStart(8, "0")}`,
      serviceName: "Consulta", requestedAt: haceDias((i % 120) - 5), createdAt: haceDias((i % 120) + 1),
    });
  }
  const appointmentChangeRequests: Fila[] = [];
  for (let i = 0; i < 1_200; i++) {
    appointmentChangeRequests.push({
      id: `acr${i}`, clinicId: CL, appointmentId: `a${i}`, patientId: `p${i % PACIENTES}`,
      accountId: `acc${i}`, type: i % 4 === 0 ? "CANCEL" : "RESCHEDULE",
      status: i % 3 === 0 ? "PENDING" : "APPROVED", proposedStartsAt: null,
      createdAt: haceDias(i % 150), updatedAt: haceDias(i % 150),
    });
  }

  return {
    clinics: [{ id: CL, timezone: TZ, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" }],
    users: [{ id: DOC, clinicId: CL, role: "DOCTOR", firstName: "Doc", lastName: "Grande", isActive: true }],
    patients, appointments, invoices, quotes, treatmentPlans, treatmentSessions,
    bookingRequests, appointmentChangeRequests,
  };
}

async function main() {
  console.log(
    `clínica sembrada: ${PACIENTES} pacientes · ${CITAS} citas · ${FACTURAS} facturas · ` +
      `${PRESUPUESTOS} presupuestos · ${PLANES} planes · 2,700 solicitudes`,
  );
  const db = crearBase(datosGrandes());
  const ctx: SabinaCtx = {
    clinicId: CL, userId: "u-admin-grande", role: "ADMIN", permissionsOverride: [], timezone: TZ, db,
  };

  // Se cronometra POR SEPARADO lo que tarda el doble (que en producción es
  // Postgres y aquí es un escaneo de arrays, así que NO se parece en nada) y lo
  // que tarda el código de la herramienta (ordenar, cruzar, deduplicar), que sí
  // es el mismo trabajo en los dos sitios. Sin esa separación el número no dice
  // nada: el 97 % de estos milisegundos son del falso.
  // 🔴 Las consultas van EN PARALELO, así que sumar lo que tarda cada una da más
  // que el reloj de pared (y restarlo da negativo). Lo que se mide es la UNIÓN de
  // los tramos en que había al menos una consulta en vuelo: eso sí se puede
  // restar del total para quedarse con lo que es trabajo de la herramienta.
  let msBase = 0;
  let enVuelo = 0;
  let abrio = 0;
  const medido: any = { ...ctx.db };
  for (const clave of Object.keys(ctx.db as any)) {
    const modelo = (ctx.db as any)[clave];
    if (!modelo || typeof modelo !== "object" || clave === "contador") continue;
    const espejo: any = {};
    for (const op of Object.keys(modelo)) {
      const fn = modelo[op];
      if (typeof fn !== "function") continue;
      espejo[op] = async (...args: unknown[]) => {
        if (enVuelo === 0) abrio = Date.now();
        enVuelo++;
        try {
          return await fn.apply(modelo, args);
        } finally {
          enVuelo--;
          if (enVuelo === 0) msBase += Date.now() - abrio;
        }
      };
    }
    medido[clave] = espejo;
  }
  const ctxMedido: SabinaCtx = { ...ctx, db: medido };

  for (const params of [{}, { tipo: "por_cobrar" }, { tipo: "sin_agendar" }, { tipo: "sin_respuesta" }, { tipo: "sin_reagendar" }, { tipo: "sin_contestar" }]) {
    db.contador.llamadas.length = 0;
    msBase = 0;
    enVuelo = 0;
    const t0 = Date.now();
    const r = await correrHerramienta(oportunidadesPerdidas, ctxMedido, params);
    const ms = Date.now() - t0;
    const porTabla: Record<string, number> = {};
    for (const l of db.contador.llamadas) porTabla[`${l.modelo}.${l.op}`] = (porTabla[`${l.modelo}.${l.op}`] ?? 0) + 1;
    const etiqueta = (params as any).tipo ?? "resumen";
    console.log(
      `\n${etiqueta.padEnd(14)} ${db.contador.llamadas.length} consultas · ` +
        `total ${ms} ms = ${msBase} ms del doble de base (en producción: Postgres) + ${ms - msBase} ms de la herramienta`,
    );
    console.log(`  ${Object.keys(porTabla).map((k) => `${k}×${porTabla[k]}`).join(" ")}`);
    if (r.ok) console.log(`  ${r.resumen.split("\n")[0].slice(0, 170)}`);
  }
}
main();
