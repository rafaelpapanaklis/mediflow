/**
 * CITAS DEL PLAN — LAS REGLAS (ws1-t1 · fase 2 · P8). Puras: `citas-del-plan.ts` y lo puro de la
 * pantalla (`agenda-nueva/agendar-plan-datos.ts`).
 *
 * Run: npm run test:plan-citas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citaOcupaLaFila,
  decidirSeguimiento,
  diasSinActividad,
  estadoDeAgenda,
  leerPlanItemIds,
  minutosDeLaCita,
  problemaAlLigar,
  type CitaLigada,
  type FilaParaLigar,
} from "@/lib/treatments/citas-del-plan";
import {
  leerUrlDeAgendaDelPlan,
  paramsDeNuevaCita,
  paramsDeReagendar,
  resumenDeFilas,
  totalElegido,
  urlDeAgendaDelPlan,
  type DatosDePlanPendiente,
} from "@/components/dashboard/plan-a-agenda/agendar-plan-datos";
import { conceptoDeLaCita } from "@/lib/invoices/cobrar-hoy";

const AHORA = new Date("2026-10-21T16:00:00Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const cita = (status: string, desdeAhoraH: number, durH = 1): CitaLigada => ({
  id: `a-${status}-${desdeAhoraH}`,
  startsAt: new Date(AHORA.getTime() + desdeAhoraH * HORA),
  endsAt: new Date(AHORA.getTime() + (desdeAhoraH + durH) * HORA),
  status,
});

test("una cita viva por delante ocupa la fila; cancelada, no asistida o atendida la libera", () => {
  assert.equal(citaOcupaLaFila(cita("SCHEDULED", 24), AHORA), true);
  assert.equal(citaOcupaLaFila(cita("CONFIRMED", 2), AHORA), true);
  assert.equal(citaOcupaLaFila(cita("PENDING", 2), AHORA), true);
  assert.equal(citaOcupaLaFila(cita("CANCELLED", 24), AHORA), false, "cancelada libera");
  assert.equal(citaOcupaLaFila(cita("NO_SHOW", -3), AHORA), false);
  assert.equal(citaOcupaLaFila(cita("COMPLETED", -3), AHORA), false, "atendida y sin marcar hecho: por agendar otra vez");
  assert.equal(citaOcupaLaFila(cita("CHECKED_OUT", -3), AHORA), false);
  assert.equal(citaOcupaLaFila(cita("SCHEDULED", -5), AHORA), false, "ya pasó y nadie la cerró: no aparta la fila");
  assert.equal(citaOcupaLaFila(cita("IN_CHAIR", -2), AHORA), true, "en el sillón aunque se pasó de su hora");
  assert.equal(citaOcupaLaFila(cita("CHECKED_IN", -14), AHORA), false, "…pero una que nadie cerró deja de apartar a las 12 h");
  assert.equal(citaOcupaLaFila(null, AHORA), false);
});

test("estado de agenda: hecha o cancelada no se agenda", () => {
  assert.equal(estadoDeAgenda({ estado: "pendiente" }, null, AHORA), "por_agendar");
  assert.equal(estadoDeAgenda({ estado: "en_curso" }, cita("SCHEDULED", 5), AHORA), "agendada");
  assert.equal(estadoDeAgenda({ estado: "pendiente" }, cita("CANCELLED", 5), AHORA), "por_agendar");
  assert.equal(estadoDeAgenda({ estado: "hecho" }, null, AHORA), "no_aplica");
  assert.equal(estadoDeAgenda({ estado: "cancelado" }, null, AHORA), "no_aplica");
});

test("minutos: tarifario × cantidad, sin duración = 30, redondeado al hueco y dentro de 5–480", () => {
  assert.equal(minutosDeLaCita([{ cantidad: 1, minutos: 45 }], 30), 60);
  assert.equal(minutosDeLaCita([{ cantidad: 2, minutos: 45 }, { cantidad: 1, minutos: null }], 15), 120);
  assert.equal(minutosDeLaCita([{ cantidad: 1, minutos: 10 }], 30), 30, "nunca menos que un hueco");
  assert.equal(minutosDeLaCita([{ cantidad: 20, minutos: 60 }], 30), 480, "tope de la ventana");
  assert.equal(minutosDeLaCita([{ cantidad: 0, minutos: -5 }], 0), 30, "datos raros: una fila de 30 en huecos de 15");
});

test("planItemIds: ausente = cita normal; lista de textos; cualquier otra cosa es 400", () => {
  assert.deepEqual(leerPlanItemIds(undefined), { ok: true, ids: [] });
  assert.deepEqual(leerPlanItemIds(null), { ok: true, ids: [] });
  assert.deepEqual(leerPlanItemIds([]), { ok: true, ids: [] });
  assert.deepEqual(leerPlanItemIds([" f1", "f2", "f1"]), { ok: true, ids: ["f1", "f2"] });
  for (const malo of ["f1", 5, [5], [""], [{ id: "f1" }], ["x".repeat(101)], Array.from({ length: 31 }, (_, i) => `f${i}`)]) {
    assert.equal(leerPlanItemIds(malo).ok, false, JSON.stringify(malo).slice(0, 40));
    assert.equal(leerPlanItemIds(malo).codigo, "plan_filas_invalidas");
  }
});

const filaLigar = (id: string, extra: Partial<FilaParaLigar> = {}): FilaParaLigar => ({
  id,
  planId: "plan1",
  estado: "pendiente",
  planDoctorId: "doc1",
  planPatientId: "pac1",
  planStatus: "ACTIVE",
  cita: null,
  ...extra,
});
const RECEP = { patientId: "pac1", userId: "recep", esDoctor: false };

test("ligar: una fila que no llegó (otra clínica) o de otro paciente → «ajena», sin decir cuál", () => {
  assert.equal(problemaAlLigar(["f1", "f2"], [filaLigar("f1")], RECEP, AHORA), "plan_fila_ajena");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { planPatientId: "otro" })], RECEP, AHORA), "plan_fila_ajena");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1")], RECEP, AHORA), null);
});

test("ligar: el doctor solo agenda sus planes; recepción cualquiera", () => {
  const doc = { patientId: "pac1", userId: "doc2", esDoctor: true };
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1")], doc, AHORA), "plan_de_otro_doctor");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1")], { ...doc, userId: "doc1" }, AHORA), null);
});

test("ligar: plan pausado, terminado o abandonado → no se agenda (también por API)", () => {
  for (const planStatus of ["PAUSED", "COMPLETED", "ABANDONED"]) {
    assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { planStatus })], RECEP, AHORA), "plan_no_activo", planStatus);
  }
});

test("ligar: hecha → no pendiente; ya agendada en cita viva → 409; cita cancelada → se puede", () => {
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { estado: "hecho" })], RECEP, AHORA), "plan_fila_no_pendiente");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { estado: "cancelado" })], RECEP, AHORA), "plan_fila_no_pendiente");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { cita: cita("SCHEDULED", 48) })], RECEP, AHORA), "plan_fila_ya_agendada");
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { cita: cita("CANCELLED", 48) })], RECEP, AHORA), null);
  assert.equal(problemaAlLigar(["f1"], [filaLigar("f1", { cita: cita("NO_SHOW", -48) })], RECEP, AHORA), null);
});

// ── Seguimiento ─────────────────────────────────────────────────────────────

const hace = (dias: number) => new Date(AHORA.getTime() - dias * DIA);

test("seguimiento: pendiente CON cita por delante no avisa; SIN cita sí (pasados 14 días)", () => {
  const conCita = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: cita("SCHEDULED", 72) }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(conCita.avisar, false);
  assert.equal(conCita.motivo, "sin_pendientes");
  const sinCita = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }, { estado: "hecho", hechoEn: hace(20), cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(sinCita.avisar, true);
  assert.equal(sinCita.pendientesSinCita, 1);
  assert.equal(sinCita.hechas, 1);
  assert.equal(sinCita.vivas, 2);
});

test("seguimiento: no por intervalo — un plan recién hecho o con actividad reciente espera", () => {
  const nuevo = decidirSeguimiento({ filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }], citaPorDelante: false, creadoEn: hace(3), lastFollowUpSent: null }, AHORA);
  assert.equal(nuevo.motivo, "reciente");
  const hechoAyer = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }, { estado: "hecho", hechoEn: hace(1), cita: null }], citaPorDelante: false, creadoEn: hace(90), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(hechoAyer.motivo, "reciente");
  // Una cita del plan que pasó hace 5 días (atendida, sin marcar) también es actividad.
  const citaReciente = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: cita("COMPLETED", -5 * 24) }], citaPorDelante: false, creadoEn: hace(90), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(citaReciente.motivo, "reciente");
  // …pero una cancelada no cuenta como actividad.
  const cancelada = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: cita("CANCELLED", -5 * 24) }], citaPorDelante: false, creadoEn: hace(90), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(cancelada.avisar, true);
});

test("seguimiento: el paciente ya tiene otra cita en la clínica → no se le insiste", () => {
  const d = decidirSeguimiento({ filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }], citaPorDelante: true, creadoEn: hace(40), lastFollowUpSent: null }, AHORA);
  assert.equal(d.avisar, false);
  assert.equal(d.motivo, "con_cita");
});

test("seguimiento: plan solo presentado (nada hecho ni en la nota) no avisa; con tope de 3 avisos", () => {
  const presentado = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: null, cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(presentado.motivo, "sin_aceptar");
  const empezado = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: null, cita: null }, { estado: "hecho", hechoEn: hace(30), cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(empezado.avisar, true, "empezado sin nota también cuenta como aceptado");
  const tope = decidirSeguimiento(
    { filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: hace(8), avisosPrevios: 3 },
    AHORA,
  );
  assert.equal(tope.motivo, "tope");
});

test("seguimiento: dedupe de 7 días y nada que hacer si todo está hecho o cancelado", () => {
  const avisado = decidirSeguimiento({ filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: hace(3) }, AHORA);
  assert.equal(avisado.motivo, "avisado_hace_poco");
  const yaVa = decidirSeguimiento({ filas: [{ estado: "pendiente", invoiceId: "nota1", cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: hace(8) }, AHORA);
  assert.equal(yaVa.avisar, true);
  const todo = decidirSeguimiento(
    { filas: [{ estado: "hecho", hechoEn: hace(30), cita: null }, { estado: "cancelado", cita: null }], citaPorDelante: false, creadoEn: hace(40), lastFollowUpSent: null },
    AHORA,
  );
  assert.equal(todo.motivo, "sin_pendientes");
  assert.equal(todo.vivas, 1);
  assert.equal(diasSinActividad({ filas: [{ estado: "hecho", hechoEn: hace(30), cita: null }], creadoEn: hace(40) }, AHORA), 30);
});

// ── La pantalla ─────────────────────────────────────────────────────────────

const DATOS: DatosDePlanPendiente = {
  disponible: true,
  puedeAgendar: true,
  minutosDelHueco: 15,
  plan: { id: "plan1", nombre: "Plan 20 oct", status: "ACTIVE", doctorId: "doc1", paciente: { id: "pac1", nombre: "Ana López" } },
  filas: [
    { id: "f1", nombre: "Resina 2 caras", dientes: [16], caras: ["M", "O"], estado: "pendiente", cantidad: 1, minutos: 45, agenda: "por_agendar", cita: null },
    { id: "f2", nombre: "Endodoncia", dientes: [26], caras: [], estado: "pendiente", cantidad: 1, minutos: 90, agenda: "agendada", cita: { id: "a1", startsAt: "2026-10-24T16:00:00Z", status: "SCHEDULED" } },
    { id: "f3", nombre: "Limpieza", dientes: [], caras: [], estado: "en_curso", cantidad: 1, minutos: null, agenda: "por_agendar", cita: null },
    { id: "f4", nombre: "Extracción", dientes: [38], caras: [], estado: "hecho", cantidad: 1, minutos: 30, agenda: "no_aplica", cita: null },
  ],
};

test("la Nueva cita del plan: paciente, doctor, motivo y duración de lo elegido; nunca una fila ya agendada", () => {
  const p = paramsDeNuevaCita(DATOS, ["f1", "f2", "f3", "f4"])!;
  assert.deepEqual(p.initialPatient, { id: "pac1", name: "Ana López" });
  assert.equal(p.initialDoctorId, "doc1");
  assert.equal(p.initialReason, "Resina 2 caras 16 · Limpieza", "sin prefijo, el motivo es el resumen");
  assert.equal(p.initialDurationMin, 75);
  assert.deepEqual(p.delPlan, { planId: "plan1", filaIds: ["f1", "f3"], resumen: "Resina 2 caras 16 · Limpieza" });
  assert.equal(paramsDeNuevaCita(DATOS, ["f2", "f4"]), null, "solo lo ya agendado o hecho: nada que agendar");
  assert.equal(paramsDeNuevaCita(DATOS, []), null);
  assert.equal(paramsDeNuevaCita({ disponible: false }, ["f1"]), null, "sin el SQL no hay cita del plan");
  assert.deepEqual(totalElegido(DATOS, ["f1", "f2"]), { n: 1, minutos: 45 });
});

test("cobro doble: «Cobrar hoy» de la cita del plan NO propone el precio del tarifario (por el prefijo del motivo)", () => {
  const catalogo = [
    { id: "p-resina", name: "Restauración resina 2 caras", basePrice: 1200 },
    { id: "p-limpieza", name: "Limpieza", basePrice: 600 },
  ] as any[];
  // Sin prefijo, el motivo de una sola fila se emparejaría con su precio: ese es el riesgo.
  assert.equal(conceptoDeLaCita("Restauración resina 2 caras 16", catalogo)?.importe, 1200);
  assert.equal(conceptoDeLaCita("Limpieza", catalogo)?.importe, 600);
  for (const ids of [["f1"], ["f3"], ["f1", "f3"]]) {
    const p = paramsDeNuevaCita(DATOS, ids, "Plan: ")!;
    assert.ok(p.initialReason!.startsWith("Plan: "));
    const c = conceptoDeLaCita(p.initialReason, catalogo);
    assert.equal(c?.procedureId, null, `${p.initialReason}: no se liga a un procedimiento`);
    assert.ok(Number.isNaN(c?.importe), `${p.initialReason}: sin importe`);
  }
});

test("Reagendar una cita del plan: se vuelve a llevar sus filas; sin permiso o sin SQL, como siempre", () => {
  const datos = { disponible: true, puedeAgendar: true, minutosSugeridos: 60, planId: "plan1", filas: [{ id: "f1", nombre: "Resina", dientes: [16] }] };
  assert.deepEqual(paramsDeReagendar(datos), {
    delPlan: { planId: "plan1", filaIds: ["f1"], resumen: "Resina 16" },
    initialDurationMin: 60,
  });
  assert.equal(paramsDeReagendar({ ...datos, puedeAgendar: false }), null, "sin treatments.edit el POST la rechazaría");
  assert.equal(paramsDeReagendar({ ...datos, filas: [] }), null);
  assert.equal(paramsDeReagendar({ disponible: false }), null);
  assert.equal(paramsDeReagendar(null), null);
});

test("el motivo largo se corta en 160 letras; la URL de la agenda va y vuelve", () => {
  const largo = resumenDeFilas(Array.from({ length: 20 }, (_, i) => ({ nombre: `Procedimiento largo ${i}`, dientes: [11 + (i % 8)] })));
  assert.ok(largo.length <= 160);
  assert.ok(largo.endsWith("…"));
  const url = urlDeAgendaDelPlan("plan 1", ["f1", "f3"]);
  assert.equal(url, "/dashboard/agenda?agendarPlan=plan+1&filas=f1%2Cf3");
  const q = new URLSearchParams(url.split("?")[1]);
  assert.deepEqual(leerUrlDeAgendaDelPlan(q), { planId: "plan 1", filaIds: ["f1", "f3"] });
  assert.equal(leerUrlDeAgendaDelPlan(new URLSearchParams("date=2026-10-21")), null);
  assert.deepEqual(leerUrlDeAgendaDelPlan(new URLSearchParams("agendarPlan=p&filas=a,,a,b")), { planId: "p", filaIds: ["a", "b"] });
});
