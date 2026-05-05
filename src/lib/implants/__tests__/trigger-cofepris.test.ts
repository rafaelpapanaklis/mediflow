// Implants — test E2E del trigger COFEPRIS protect_implant_traceability.
// Spec §1.9, §10.2.
//
// Run:
//   DATABASE_URL=postgres://... DIRECT_URL=postgres://... \
//     npx tsx --test src/lib/implants/__tests__/trigger-cofepris.test.ts
//
// El test requiere conexión real a Postgres con la migración
// 20260504200000_implants_module aplicada. Si DATABASE_URL no está
// definido, los casos se marcan como `it.skip` para no romper CI
// cuando se corren los tests unitarios sin credenciales.
//
// Validaciones:
//  1. UPDATE en brand/lotNumber/placedAt SIN flag de sesión → debe
//     fallar con la excepción del trigger.
//  2. UPDATE en mismos campos CON flag activo en la transacción →
//     debe pasar.
//  3. UPDATE en otros campos (notes) sin flag → debe pasar (el
//     trigger solo protege los 3 campos COFEPRIS).
//  4. DELETE → debe fallar con excepción del trigger
//     block_implant_delete.
//
// PRECAUCIÓN: si el pooler de Supabase ignora SET LOCAL, el caso 2
// fallará. La acción correctiva está documentada en la migración
// SQL §5: ejecutar `DROP TRIGGER IF EXISTS
// protect_implant_traceability_trg ON "implants";` y dejar la
// validación en server action (justification ≥20 + audit log).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.DIRECT_URL;
const TEST_LOT_ORIGINAL = "TRIGGER-TEST-A";
const TEST_LOT_NEW = "TRIGGER-TEST-B";

const skipIfNoDb = HAS_DB ? it : it.skip;

describe("trigger COFEPRIS — protect_implant_traceability", () => {
  let prisma: PrismaClient;
  let testImplantId: string;
  let cleanup: (() => Promise<void>) | null = null;

  before(async () => {
    if (!HAS_DB) return;
    prisma = new PrismaClient();

    // Buscamos una clínica + paciente + doctor reales para crear un
    // implante de prueba (Prisma valida FKs).
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
      // Borrar via SQL crudo + bypass del trigger usando flag de
      // sesión para volver el lote al original primero — el test
      // de DELETE bloqueado debe fallar (no nos deja borrar).
      // En lugar de delete, marcamos como REMOVED con motivo válido.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL app.implant_mutation_justified = 'true'`,
        );
        await tx.implant.update({
          where: { id: testImplantId },
          data: {
            lotNumber: TEST_LOT_ORIGINAL,
            currentStatus: "REMOVED",
            removedAt: new Date(),
            removalReason: "fixture cleanup — test trigger COFEPRIS finalizado",
          },
        });
      });
    };
  });

  after(async () => {
    if (cleanup) await cleanup().catch(() => null);
    if (prisma) await prisma.$disconnect();
  });

  skipIfNoDb("UPDATE de lotNumber SIN flag → falla", async () => {
    await assert.rejects(
      async () => {
        await prisma.implant.update({
          where: { id: testImplantId },
          data: { lotNumber: TEST_LOT_NEW },
        });
      },
      (err: Error) => {
        const msg = err.message.toLowerCase();
        // El trigger arroja "COFEPRIS: brand/lotNumber/placedAt son inmutables..."
        return msg.includes("cofepris") || msg.includes("inmutable") || msg.includes("insufficient_privilege");
      },
    );
  });

  skipIfNoDb("UPDATE de lotNumber CON flag de sesión → pasa", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.implant_mutation_justified = 'true'`,
      );
      await tx.implant.update({
        where: { id: testImplantId },
        data: { lotNumber: TEST_LOT_NEW },
      });
    });
    const after = await prisma.implant.findUnique({
      where: { id: testImplantId },
      select: { lotNumber: true },
    });
    assert.equal(after?.lotNumber, TEST_LOT_NEW);
  });

  skipIfNoDb("UPDATE de notes sin flag → pasa (no es campo COFEPRIS)", async () => {
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

  skipIfNoDb("DELETE → falla por trigger block_implant_delete", async () => {
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
