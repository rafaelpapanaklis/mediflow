/**
 * Copia de configuración al crear una sede (ws1-t10, auditoría BEVADENT · M4).
 * Pruebas puras sobre `copia-sede-core.ts`: con el código viejo no existía
 * ninguna copia (la sede nacía vacía salvo el horario L-V 9-18).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AJUSTES_QUE_SE_COPIAN,
  HORARIO_POR_DEFECTO,
  NO_SE_COPIA,
  ajustesParaSedeNueva,
  copiarCatalogo,
  copioAlgo,
  horarioParaSedeNueva,
  religarProcedimientos,
  resultadoVacio,
  seccionesFallidas,
} from "../copia-sede-core";

const catalogo = [
  { id: "p1", name: "Limpieza", code: null, cieCode: null, category: "dental", basePrice: 800, cost: 120, duration: 45, description: "Profilaxis", isActive: true },
  { id: "p2", name: "Resina", code: "ODO_RESINA", cieCode: "23.2", category: "dental", basePrice: 1500, cost: null, duration: 60, description: null, isActive: false },
];

describe("copia de la sede principal: catálogo", () => {
  it("copia precio, costo, duración, código y estado, con id nuevo y la clínica destino", () => {
    let n = 0;
    const { filas, idViejoANuevo } = copiarCatalogo(catalogo, "sede-nueva", () => `n${++n}`);
    assert.equal(filas.length, 2);
    assert.deepEqual(filas[0], { id: "n1", clinicId: "sede-nueva", name: "Limpieza", code: null, cieCode: null, category: "dental", basePrice: 800, cost: 120, duration: 45, description: "Profilaxis", isActive: true });
    assert.equal(filas[1].isActive, false, "lo inactivo también se copia (es parte del catálogo)");
    assert.equal(filas[1].code, "ODO_RESINA");
    assert.equal(idViejoANuevo.get("p1"), "n1");
    assert.equal(idViejoANuevo.get("p2"), "n2");
    assert.ok(filas.every((f) => f.clinicId === "sede-nueva"), "ninguna fila sin la sede destino");
  });

  it("re-liga los procedimientos de una hoja al catálogo nuevo y descarta los que no existen", () => {
    const { idViejoANuevo } = copiarCatalogo(catalogo, "x", (() => { let n = 0; return () => `n${++n}`; })());
    assert.deepEqual(religarProcedimientos(["p2", "borrado", "p1", "p2"], idViejoANuevo), ["n2", "n1"]);
    assert.deepEqual(religarProcedimientos([], idViejoANuevo), []);
  });
});

describe("copia de la sede principal: horario y ajustes", () => {
  it("usa el horario de la principal (un día por fila) y, sin horario, el L-V 9-18 de siempre", () => {
    const h = horarioParaSedeNueva([
      { dayOfWeek: 1, enabled: true, openTime: "08:00", closeTime: "20:00" },
      { dayOfWeek: 1, enabled: false, openTime: "00:00", closeTime: "00:00" }, // repetido: fuera
      { dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
      { dayOfWeek: 9, enabled: true, openTime: "09:00", closeTime: "14:00" }, // día inválido: fuera
    ]);
    assert.deepEqual(h, [
      { dayOfWeek: 1, enabled: true, openTime: "08:00", closeTime: "20:00" },
      { dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
    ]);
    assert.deepEqual(horarioParaSedeNueva([]), HORARIO_POR_DEFECTO);
    assert.deepEqual(horarioParaSedeNueva(null), HORARIO_POR_DEFECTO);
    assert.equal(HORARIO_POR_DEFECTO.length, 5);
  });

  it("de la clínica solo viajan los ajustes de agenda y recordatorios: nunca CFDI, WhatsApp ni cobros", () => {
    const origen = {
      defaultSlotMinutes: 30, agendaDayStart: 7, agendaDayEnd: 21, timezone: "America/Cancun",
      waReminderActive: true, waReminder24h: true, waReminder1h: true, waReminderMsg: "Hola {nombre}",
      reminderSettings: { offsets: [1440] }, recallMonths: 4, recallActive: true,
      birthdayMsgActive: true, postApptFollowupActive: false, noShowTaskActive: true,
      patientChangesAutoApprove: true, patientChangesMinHours: 12,
      // Lo que NO debe viajar:
      rfcEmisor: "AAA010101AAA", facturApiOrgId: "org", csdUploaded: true, cfdiTaxMode: "iva",
      waPhoneNumberId: "123", waAccessToken: "tok", waConnected: true, waTemplates: { x: 1 },
      stripeSubscriptionId: "sub", monthlyPrice: 999, subscriptionStatus: "active", plan: "CLINIC",
      logoUrl: "x.png", name: "Principal", slug: "principal", aiTokensUsed: 5,
    };
    const a = ajustesParaSedeNueva(origen) as Record<string, unknown>;
    for (const k of AJUSTES_QUE_SE_COPIAN) assert.equal(a[k], (origen as Record<string, unknown>)[k], k);
    for (const k of ["rfcEmisor", "facturApiOrgId", "csdUploaded", "cfdiTaxMode", "waPhoneNumberId", "waAccessToken", "waConnected", "waTemplates", "stripeSubscriptionId", "monthlyPrice", "subscriptionStatus", "plan", "logoUrl", "name", "slug", "aiTokensUsed"]) {
      assert.equal(k in a, false, `${k} no se copia`);
    }
    assert.equal(Object.keys(a).length, AJUSTES_QUE_SE_COPIAN.length);
  });

  it("la lista de lo que NO se copia nombra CFDI, WhatsApp, Mercado Pago, pacientes, usuarios y módulos", () => {
    assert.deepEqual([...NO_SE_COPIA], ["cfdi", "whatsapp", "mercadoPago", "pacientes", "usuarios", "modulos"]);
  });
});

describe("resultado de la copia", () => {
  it("empieza en cero por sección, sabe si copió algo y cuáles fallaron", () => {
    const r = resultadoVacio({ clinicId: "a", nombre: "Principal" });
    assert.equal(copioAlgo(r), false);
    assert.deepEqual(seccionesFallidas(r), []);
    r.copiado.catalogo = 12;
    r.copiado.indicaciones = null;
    r.copiado.botWhatsApp = null;
    assert.equal(copioAlgo(r), true);
    assert.deepEqual(seccionesFallidas(r), ["indicaciones", "botWhatsApp"]);
    assert.equal(r.origen.nombre, "Principal");
  });
});
