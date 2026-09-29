/**
 * Movimientos del paciente — quien NO es del equipo (ws1-t12).
 *
 * El propio paciente en su portal, la reserva web, la firma en línea de un
 * consentimiento y el bot de WhatsApp dejan movimientos sin usuario del equipo
 * (`actorType` 'patient' | 'public' | 'bot', `userId` NULL). Aquí:
 *  1. cómo se ve cada uno en «Movimientos» y en la bitácora de administración
 *     (una fila sin usuario no rompe nada);
 *  2. lo que hace el bot: escribe como «Bot de WhatsApp» y NUNCA tira;
 *  3. el SQL es aditivo, idempotente y respeta el trigger NOM-024.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

let crudas: Array<{ sql: string; values: unknown[] }> = [];
let filasBitacora: any[] = [];
let listaCruda: any[] = [];
let citaEnBase: any = null;
let fallaCita = false;

mock.module("@/lib/pediatrics/audit", { namedExports: { PEDIATRIC_AUDIT_ACTIONS: [] } });
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      appointment: {
        findFirst: async () => {
          if (fallaCita) throw new Error("pooler");
          return citaEnBase;
        },
      },
      clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
      auditLog: {
        create: async () => ({ id: "x" }),
        findMany: async () => filasBitacora,
        count: async () => filasBitacora.length,
      },
      user: { findMany: async () => [] },
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        crudas.push({ sql: strings.join("?"), values });
        return Promise.resolve(1);
      },
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = Prisma.sql(strings, ...values);
        return Promise.resolve(/COUNT\(\*\)/.test(q.sql) ? [{ n: BigInt(listaCruda.length) }] : listaCruda);
      },
    },
  },
});

const cruda = (o: any) => ({
  id: "l1",
  entityType: "appointment",
  entityId: "a1",
  action: "update",
  changes: null,
  createdAt: new Date("2026-10-03T16:00:00.000Z"),
  actorType: "staff",
  firstName: "Ana",
  lastName: "Pérez",
  ...o,
});

describe("cómo se nombra a quien no es del equipo", () => {
  it("etiquetas por defecto y origen precisado", async () => {
    const c = await import("../catalogo");
    assert.equal(c.etiquetaDeActorExterno("patient", null), "El paciente (portal)");
    assert.equal(c.etiquetaDeActorExterno("public", null), "Reserva web");
    assert.equal(c.etiquetaDeActorExterno("bot", null), "Bot de WhatsApp");
    assert.equal(
      c.etiquetaDeActorExterno("patient", { _mov: { before: null, after: { actor: "El paciente (firma en línea)" } } }),
      "El paciente (firma en línea)",
    );
    assert.equal(c.esActorExterno("bot"), true);
    assert.equal(c.esActorExterno("staff"), false);
    assert.equal(c.esActorExterno("admin"), false);
    assert.equal(c.esActorExterno(null), false);
  });

  it("«Movimientos» muestra al paciente, la reserva web y el bot en lugar de un nombre del equipo", async () => {
    listaCruda = [
      cruda({ id: "1", actorType: "patient", firstName: null, lastName: null, changes: { _mov: { after: { texto: "Pidió cancelar su cita" } } } }),
      cruda({ id: "2", actorType: "public", firstName: null, lastName: null }),
      cruda({ id: "3", actorType: "bot", firstName: null, lastName: null }),
      cruda({ id: "4", actorType: "patient", firstName: null, lastName: null, entityType: "consent", changes: { _mov: { after: { texto: "Firmó un consentimiento desde el enlace", actor: "El paciente (firma en línea)" } } } }),
      cruda({ id: "5" }),
    ];
    const { listarMovimientosDelPaciente } = await import("../consultar");
    const p = await listarMovimientosDelPaciente({ clinicIds: ["cli_1"], patientId: "pat_1" }, { verClinico: true, verDinero: true });
    assert.deepEqual(p.items.map((i) => i.actor), [
      "El paciente (portal)",
      "Reserva web",
      "Bot de WhatsApp",
      "El paciente (firma en línea)",
      "Ana Pérez",
    ]);
  });

  it("la bitácora de administración no se rompe con una fila sin usuario y la nombra por su actor", async () => {
    filasBitacora = [
      { id: "1", clinicId: "cli_1", userId: null, user: null, clinic: { name: "Clínica" }, entityType: "appointment", entityId: "a", action: "update", changes: null, ipAddress: null, userAgent: null, actorType: "bot", createdAt: new Date("2026-10-03T16:00:00Z") },
      { id: "2", clinicId: "cli_1", userId: null, user: null, clinic: { name: "Clínica" }, entityType: "appointment", entityId: "a", action: "update", changes: null, ipAddress: null, userAgent: null, actorType: "patient", createdAt: new Date("2026-10-03T16:00:00Z") },
      { id: "3", clinicId: "cli_1", userId: "u1", user: { firstName: "Ana", lastName: "Pérez", role: "ADMIN", email: "a@b.mx" }, clinic: { name: "Clínica" }, entityType: "appointment", entityId: "a", action: "update", changes: null, ipAddress: null, userAgent: null, actorType: "staff", createdAt: new Date("2026-10-03T16:00:00Z") },
    ];
    const { queryAuditLogs } = await import("@/lib/admin/audit");
    const r = await queryAuditLogs({} as any);
    assert.deepEqual(r.rows.map((x) => x.userName), ["Bot de WhatsApp", "El paciente (portal)", "Ana Pérez"]);
    assert.equal(r.rows[0].userId, "");
    assert.equal(r.rows[0].userRole, null);
  });
});

describe("lo que hace el bot de WhatsApp", () => {
  beforeEach(async () => {
    crudas = [];
    citaEnBase = { id: "apt_1", patientId: "pat_1", startsAt: new Date("2026-10-03T16:00:00.000Z") };
    fallaCita = false;
    const f = await import("../fila");
    f._reiniciarEstadoDeColumna();
    f._reiniciarEstadoDeUsuarioNulo();
    (await import("../zona"))._reiniciarZonas();
  });

  it("una cita agendada por el bot queda como «Bot de WhatsApp», sin usuario", async () => {
    const { anotarCitaCreadaPorBot } = await import("@/lib/whatsapp/bot/movimientos-bot");
    await anotarCitaCreadaPorBot({ clinicId: "cli_1", appointmentId: "apt_1" });
    assert.equal(crudas.length, 1);
    const v = crudas[0].values;
    assert.equal(v[2], null);
    assert.ok(v.includes("bot") && v.includes("pat_1") && v.includes("cli_1"));
    const cambios = JSON.parse(v.find((x) => typeof x === "string" && x.startsWith("{")) as string);
    assert.equal(cambios._mov.after.texto, "Agendó una cita para el 3 oct 2026 10:00");
  });

  it("reagendar dice «del … al …»", async () => {
    const { anotarCitaMovidaPorBot } = await import("@/lib/whatsapp/bot/movimientos-bot");
    citaEnBase = { id: "apt_1", patientId: "pat_1", startsAt: new Date("2026-10-04T17:30:00.000Z") };
    await anotarCitaMovidaPorBot({ clinicId: "cli_1", appointmentId: "apt_1", antes: { startsAt: new Date("2026-10-03T16:00:00.000Z") } });
    const cambios = JSON.parse(crudas[0].values.find((x) => typeof x === "string" && x.startsWith("{")) as string);
    assert.equal(cambios._mov.after.texto, "Movió una cita del 3 oct 2026 10:00 al 4 oct 2026 11:30");
  });

  it("confirmar o cancelar respondiendo un recordatorio", async () => {
    const { anotarRespuestaARecordatorio } = await import("@/lib/whatsapp/bot/movimientos-bot");
    const cita = { id: "apt_1", patientId: "pat_1", startsAt: new Date("2026-10-03T16:00:00.000Z"), status: "SCHEDULED" };
    await anotarRespuestaARecordatorio({ clinicId: "cli_1", cita, accion: "cancel" });
    await anotarRespuestaARecordatorio({ clinicId: "cli_1", cita, accion: "confirm" });
    const textos = crudas.map((c) => JSON.parse(c.values.find((x) => typeof x === "string" && x.startsWith("{")) as string)._mov.after.texto);
    assert.deepEqual(textos, [
      "Canceló la cita del 3 oct 2026 10:00 (respondió por WhatsApp)",
      "Cambió la cita del 3 oct 2026 10:00 de «Agendada» a «Confirmada» (respondió por WhatsApp)",
    ]);
  });

  it("nunca tira: sin cita, con la base caída o sin id no pasa nada", async () => {
    const m = await import("@/lib/whatsapp/bot/movimientos-bot");
    const errores = mock.method(console, "error", () => {});
    try {
      citaEnBase = null;
      await assert.doesNotReject(m.anotarCitaCreadaPorBot({ clinicId: "cli_1", appointmentId: "nope" }));
      fallaCita = true;
      await assert.doesNotReject(m.anotarCitaCreadaPorBot({ clinicId: "cli_1", appointmentId: "apt_1" }));
      await assert.doesNotReject(m.anotarCitaCreadaPorBot({ clinicId: "", appointmentId: "apt_1" }));
      await assert.doesNotReject(m.anotarCitaMovidaPorBot({ clinicId: "cli_1", appointmentId: undefined, antes: null }));
      await assert.doesNotReject(m.anotarPacienteCreadoPorBot({ clinicId: "cli_1", patientId: "pat_1" }));
    } finally {
      errores.mock.restore();
    }
    assert.equal(crudas.length, 1, "solo el alta del paciente escribió");
  });
});

describe("el SQL de los actores externos", () => {
  const sql = leer("sql/audit-logs-actor-externo.sql");
  const codigo = sql.replace(/^--.*$/gm, "");
  it("hace lo que dice y nada más: userId acepta NULL y un CHECK acota quién puede ser NULL", () => {
    assert.match(codigo, /ALTER COLUMN "userId" DROP NOT NULL/);
    assert.match(codigo, /CHECK \("userId" IS NOT NULL OR "actorType" IN \('patient', 'public', 'bot'\)\)/);
  });
  it("es idempotente y aditivo: el CHECK solo se crea si no existe, y nunca UPDATE/DELETE/DROP TABLE/TRIGGER", () => {
    assert.match(codigo, /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
    assert.ok(!/\b(UPDATE|DELETE|TRUNCATE|DROP TABLE|DROP TRIGGER|DISABLE TRIGGER|CREATE TRIGGER|session_replication_role)\b/i.test(codigo));
  });
  it("no se aplica a las filas viejas (NOT VALID): no recorre ni toca audit_logs", () => {
    assert.match(codigo, /NOT VALID/);
  });
  it("el modelo de Prisma ya lo espera (userId opcional) y el helper lo dice", () => {
    const schema = leer("prisma/schema.prisma");
    const modelo = schema.slice(schema.indexOf("model AuditLog {"));
    const cuerpo = modelo.slice(0, modelo.indexOf("\n}\n"));
    assert.match(cuerpo, /userId\s+String\?/);
    assert.match(cuerpo, /user\s+User\?/);
  });
});

describe("el registro de los actores externos está cableado", () => {
  const CON_EXTERNO = [
    "src/app/api/paciente/appointments/route.ts",
    "src/app/api/paciente/appointments/[id]/confirm/route.ts",
    "src/app/api/paciente/appointments/[id]/change-request/route.ts",
    "src/app/api/paciente/documentos/subir/route.ts",
    "src/app/api/paciente/documentos/subidos/route.ts",
    "src/app/api/paciente/profile/route.ts",
    "src/app/api/public/book/route.ts",
    "src/app/api/public/appointment-confirm/route.ts",
    "src/app/api/consent/public/[token]/route.ts",
    "src/app/api/consent/public/[token]/witness/route.ts",
    "src/lib/whatsapp/bot/movimientos-bot.ts",
    "src/lib/whatsapp/bot/booking.ts",
    "src/lib/whatsapp/bot/booking-helpers.ts",
    "src/app/api/whatsapp/webhook/route.ts",
  ];
  for (const f of CON_EXTERNO) {
    it(`${f} registra al actor externo`, () => {
      assert.match(leer(f), /registrarMovimientoExterno\(|anotarCitaCreadaPorBot|anotarCitaMovidaPorBot|anotarPacienteCreadoPorBot|anotarRespuestaARecordatorio/);
    });
  }
  it("la firma pública ya no dice que «NO se escribe en audit_logs»", () => {
    assert.ok(!/NO se escribe en audit_logs/.test(leer("src/app/api/consent/public/[token]/route.ts")));
  });
});
