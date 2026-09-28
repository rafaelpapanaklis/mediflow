/**
 * N2 (QA ronda 4, ws1-t2) — «Anticipo pedido desde el panel» decía
 * «Guardado.» y NO guardaba nada sin Mercado Pago conectado.
 *
 * El PUT hacía `prisma.clinicMercadoPago.updateMany({ where: { clinicId } })`
 * con el comentario "la fila existe: la creó la conexión". Sin conexión de
 * Mercado Pago no hay fila — una clínica que solo cobra por transferencia
 * puede configurar el panel SIN conectar nada — así que `updateMany`
 * "tenía éxito" con 0 filas tocadas: 200 + «Guardado.», y al recargar (otro
 * GET) la config seguía en los defaults.
 *
 * Run: npm run test:settings-anticipos-n2 (o
 *   `tsx --test --experimental-test-module-mocks <este archivo>`)
 *   Se ejecuta el PUT /api/settings/anticipos DE VERDAD; solo se sustituyen
 *   Prisma, la sesión, los permisos y la auditoría.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_n2";

// Sin fila al empezar: exactamente "sin Mercado Pago conectado".
let FILA: Record<string, unknown> | null = null;

const prismaFalso: any = {
  clinicMercadoPago: {
    findUnique: async ({ where }: any) =>
      FILA && FILA.clinicId === where.clinicId ? { ...FILA } : null,
    upsert: async ({ where, create, update }: any) => {
      if (FILA && FILA.clinicId === where.clinicId) {
        FILA = { ...FILA, ...update };
      } else {
        FILA = { ...create };
      }
      return { ...FILA };
    },
  },
  appointmentDeposit: {
    findMany: async () => [],
  },
  // leerPlantillasOpcionales (pantalla.server.ts) hace
  // `prisma.clinic.findUnique(...).catch(() => null)`: sin este modelo en el
  // doble, `prisma.clinic` es undefined y `.findUnique` truena ANTES de que
  // exista promesa que atrapar con `.catch`.
  clinic: {
    findUnique: async () => null,
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: CLINICA, userId: "u_admin", role: "ADMIN", permissionsOverride: [] }),
  },
});
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {}, extractAuditMeta: () => ({}) } });

async function putPanel(body: unknown) {
  const { NextRequest } = await import("next/server");
  const { PUT } = await import("../route");
  const res = await PUT(
    new NextRequest("http://localhost/api/settings/anticipos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

test("N2: guardar la config del panel SIN Mercado Pago conectado (solo transferencia) SÍ persiste", async () => {
  FILA = null;

  const r = await putPanel({ panel: { modo: "percent", monto: 50, porcentaje: 20, horas: 12 } });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(FILA, "el PUT tiene que crear la fila (antes updateMany tocaba 0 filas y no dejaba rastro)");
  assert.equal(FILA!.panelDepositMode, "percent");
  assert.equal(FILA!.panelDepositAmount, 50);
  assert.equal(FILA!.panelDepositPercent, 20);
  assert.equal(FILA!.panelDepositExpiryHours, 12);

  // "Recargar" — un GET nuevo (o, aquí, releer la misma respuesta que ya
  // trae `leerPantallaAnticipos` fresco) tiene que ver lo mismo que se pidió
  // guardar, no los defaults `fixed / 0 / 24` del bug original.
  assert.equal(r.body.configPanel.modo, "percent");
  assert.equal(r.body.configPanel.monto, 50);
  assert.equal(r.body.configPanel.porcentaje, 20);
  assert.equal(r.body.configPanel.horas, 12);
});

test("N2: un segundo guardado sobre la misma clínica actualiza la fila (no crea otra)", async () => {
  FILA = null;
  await putPanel({ panel: { modo: "fixed", monto: 100, porcentaje: 0, horas: 24 } });
  const r = await putPanel({ panel: { modo: "fixed", monto: 250, porcentaje: 0, horas: 6 } });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(FILA!.panelDepositAmount, 250);
  assert.equal(FILA!.panelDepositExpiryHours, 6);
});
