// Implants — test E2E "trigger eliminado — fallback a server action".
// Spec §1.9, §10.2.
//
// HISTORIA: este archivo originalmente validaba el trigger SQL
// `protect_implant_traceability`. La validación contra el pooler
// real de Supabase (4 may 2026 — ver
// docs/marketplace/research/implantologia/TRIGGER_COFEPRIS_VALIDATION.md)
// determinó que pgbouncer en transaction mode no respeta SET LOCAL, por
// lo que el trigger se eliminó vía migración
// `20260504210000_drop_implant_traceability_trigger`.
//
// Lo que este test valida ahora:
//   1. UPDATE en lotNumber SIN flag → PASA (trigger eliminado, ningún
//      bypass legítimo necesita el flag — la defensa quedó en la
//      server action). La protección legal real es zod en
//      updateImplantTraceability — ver
//      `updateImplantTraceability.test.ts`.
//   2. UPDATE en otros campos sin flag → pasa (esperado).
//   3. DELETE → FALLA (trigger gemelo `block_implant_delete` se mantiene
//      activo — no requiere SET LOCAL).
//
// Sin DATABASE_URL los casos se marcan it.skip para no romper CI.
//
// Run:
//   DATABASE_URL=postgres://... DIRECT_URL=postgres://... \
//     npx tsx --test src/lib/implants/__tests__/trigger-cofepris.test.ts

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.DIRECT_URL;
const TEST_LOT_ORIGINAL = "TRIGGER-TEST-A";
const TEST_LOT_NEW = "TRIGGER-TEST-B";

const skipIfNoDb = HAS_DB ? it : it.skip;

describe("trigger eliminado — fallback a server action", () => {
  let prisma: PrismaClient;
  let testImplantId: string;
  let cleanup: (() => Promise<void>) | null = null;

  before(async () => {
    if (!HAS_DB) return;
    prisma = new PrismaClient();

    const clinic = await prisma.clinic.findFirst({
      where: {
        category: "DENTAL",
        clinicModules: { some: { status: "active", module: { key: "implants" } } },
      },
      select: { id: true },
    });
    if (!clinic) {
      throw new Error("No hay clínica DENTAL con módulo 'implants' activo para correr el test E2E");
    }
    const patient = await prisma.patient.findFirst({
      where: { clinicId: clinic.id, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new Error("No hay paciente en la clínica de prueba");
    const doctor = await prisma.user.findFirst({
      where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
      select: { id: true },
    });
    if (!doctor) throw new Error("No hay DOCTOR en la clínica de prueba");

    testImplantId = `trigger-test-${randomUUID()}`;
    await prisma.implant.create({
      data: {
        id: testImplantId,
        clinicId: clinic.id,
        patientId: patient.id,
        toothFdi: 16,
        brand: "STRAUMANN",
        modelName: "TriggerTest",
        diameterMm: 4.0,
        lengthMm: 10.0,
        connectionType: "CONICAL_MORSE",
        lotNumber: TEST_LOT_ORIGINAL,
        placedAt: new Date(),
        placedByDoctorId: doctor.id,
        protocol: "ONE_STAGE",
        currentStatus: "PLACED",
        createdByUserId: doctor.id,
        notes: "fixture trigger-cofepris.test.ts — eliminar manualmente si queda colgado",
      },
    });
    cleanup = async () => {
      // Cleanup vía UPDATE a status REMOVED (DELETE está bloqueado
      // por el trigger gemelo block_implant_delete).
      await prisma.implant.update({
        where: { id: testImplantId },
        data: {
          lotNumber: TEST_LOT_ORIGINAL,
          currentStatus: "REMOVED",
          removedAt: new Date(),
          removalReason: "fixture cleanup — test trigger COFEPRIS finalizado",
        },
      });
    };
  });

  after(async () => {
    if (cleanup) await cleanup().catch(() => null);
    if (prisma) await prisma.$disconnect();
  });

  skipIfNoDb("UPDATE de lotNumber SIN flag → PASA (trigger eliminado)", async () => {
    // Antes había un trigger que requería SET LOCAL. Ya no existe —
    // cualquier UPDATE pasa a nivel DB. La protección real está en
    // la server action updateImplantTraceability (zod ≥20 chars +
    // audit log con cofeprisTraceability:true).
    await prisma.implant.update({
      where: { id: testImplantId },
      data: { lotNumber: TEST_LOT_NEW },
    });
    const after = await prisma.implant.findUnique({
      where: { id: testImplantId },
      select: { lotNumber: true },
    });
    assert.equal(after?.lotNumber, TEST_LOT_NEW);
  });

  skipIfNoDb("UPDATE de notes sin flag → pasa (campo no-COFEPRIS)", async () => {
    const newNote = `noted at ${new Date().toISOString()}`;
    await prisma.implant.update({
      where: { id: testImplantId },
      data: { notes: newNote },
    });
    const after = await prisma.implant.findUnique({
      where: { id: testImplantId },
      select: { notes: true },
    });
    assert.equal(after?.notes, newNote);
  });

  skipIfNoDb("DELETE → falla por trigger block_implant_delete (sigue activo)", async () => {
    await assert.rejects(
      async () => {
        await prisma.implant.delete({ where: { id: testImplantId } });
      },
      (err: Error) => {
        const msg = err.message.toLowerCase();
        return (
          msg.includes("cofepris") ||
          msg.includes("delete") ||
          msg.includes("prohibido") ||
          msg.includes("check_violation")
        );
      },
    );
  });
});
