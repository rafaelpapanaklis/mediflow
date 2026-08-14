// Tests puros (sin BD, sin Meta) de la selección del recordatorio sobre el que
// actúa la respuesta del paciente por WhatsApp — hallazgo M-04 de la auditoría.
//
// Lo que protegen, en una línea: el flujo normal de "1 = confirmar / 2 =
// cancelar" NO se puede romper, y contestar la encuesta post-cita NUNCA puede
// reescribir una cita ya atendida.
//
// Patrón node:test + tsx, igual que src/lib/inbox/__tests__/inbox-send.test.ts.
// Correr: npm run test:wa-reminder-pick

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  actionablePatientIds,
  isActionableReminder,
  pickActionableReminder,
  resolveReminderReply,
} from "../reminder-pick";
import {
  WA_REMINDER_CONFIRMABLE_TYPES,
  WA_REMINDER_REPLYABLE_APPT_STATUSES,
  WA_REMINDER_STATUS,
} from "../reminder-status";
import { APPT_AUTO_TYPE } from "../../reminders/config";

/* ── Fixtures ──────────────────────────────────────────────────────────────
   Forma mínima de una fila de whatsAppReminder.findMany({ include:
   { appointment: true } }). El array va SIEMPRE del más reciente al más viejo,
   como el orderBy: { sentAt: "desc" } del webhook. */
type TestReminder = {
  id: string;
  type: string;
  appointment: { id: string; status: string } | null;
};

const r = (id: string, type: string, apptStatus: string | null): TestReminder => ({
  id,
  type,
  appointment: apptStatus === null ? null : { id: `appt-${id}`, status: apptStatus },
});

/* ── 0. Los literales son los REALES, no inventados ────────────────────────
   El fix filtra por strings sueltos; si el enum de Prisma cambiara de nombres
   el filtro dejaría de matchear en silencio y NADIE podría confirmar su cita.
   Esto lo ancla al schema. */
describe("los valores usados existen de verdad en el schema", () => {
  const schema = readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );

  const enumValues = (name: string): string[] => {
    const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
    assert.ok(m, `no se encontró el enum ${name} en prisma/schema.prisma`);
    return m[1]
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^[A-Z_]+$/.test(l));
  };

  it("cada estado de WA_REMINDER_REPLYABLE_APPT_STATUSES es un AppointmentStatus válido", () => {
    const valid = enumValues("AppointmentStatus");
    assert.ok(valid.length >= 5, "el enum AppointmentStatus se leyó vacío o a medias");
    for (const s of WA_REMINDER_REPLYABLE_APPT_STATUSES) {
      assert.ok(valid.includes(s), `"${s}" no existe en enum AppointmentStatus`);
    }
  });

  it("los estados cerrados (COMPLETED/CANCELLED/NO_SHOW) NO están en la lista", () => {
    for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW", "CHECKED_IN", "IN_PROGRESS", "CHECKED_OUT"]) {
      assert.ok(
        !WA_REMINDER_REPLYABLE_APPT_STATUSES.includes(s),
        `"${s}" no debería permitir que una respuesta reescriba la cita`,
      );
    }
  });

  it("APPT_AUTO (el tipo del encolador automático) está entre los confirmables", () => {
    // Es el tipo del recordatorio de cita REAL: lib/reminders/enqueue.ts lo
    // escribe en cada fila. Si se cayera de la lista, el flujo normal muere.
    assert.equal(APPT_AUTO_TYPE, "APPT_AUTO");
    assert.ok(WA_REMINDER_CONFIRMABLE_TYPES.includes(APPT_AUTO_TYPE));
  });

  it("APPOINTMENT (el @default de la columna en el schema) está entre los confirmables", () => {
    // Filas legacy y cualquier productor que no pase `type` caen en el default.
    // Se busca DENTRO del modelo: sin acotar, el regex tomaba el primer
    // `type String @default(...)` del archivo, que puede ser de otro modelo.
    const modelo = /model\s+WhatsAppReminder\s*\{([\s\S]*?)\n\}/.exec(schema);
    assert.ok(modelo, "no se encontró el model WhatsAppReminder en prisma/schema.prisma");
    const m = /^\s*type\s+String\s+@default\("([A-Z_]+)"\)/m.exec(modelo[1]);
    assert.ok(m, "no se encontró el @default de WhatsAppReminder.type");
    assert.ok(
      WA_REMINDER_CONFIRMABLE_TYPES.includes(m[1]),
      `el default de la columna ("${m[1]}") quedó fuera de los confirmables`,
    );
  });

  it("FOLLOWUP (encuesta post-cita) NO es confirmable", () => {
    assert.ok(!WA_REMINDER_CONFIRMABLE_TYPES.includes("FOLLOWUP"));
  });

  it("solo se leen recordatorios ya enviados (SENT)", () => {
    assert.equal(WA_REMINDER_STATUS.SENT, "SENT");
  });
});

/* ── 1 y 2. EL FLUJO NORMAL — lo que no se puede romper ───────────────────── */
describe("flujo normal: un recordatorio de cita futura", () => {
  const soloRecordatorio = [r("a", APPT_AUTO_TYPE, "SCHEDULED")];

  it('"1" confirma esa cita', () => {
    const { reminder, action } = resolveReminderReply(soloRecordatorio, "1");
    assert.equal(reminder?.id, "a");
    assert.equal(action, "confirm");
  });

  it('"confirmo" confirma esa cita', () => {
    for (const text of ["confirmo", "si", "sí", "confirmar", "claro", "de acuerdo", "va", "ok"]) {
      const { reminder, action } = resolveReminderReply(soloRecordatorio, text);
      assert.equal(reminder?.id, "a", `texto: "${text}"`);
      assert.equal(action, "confirm", `texto: "${text}"`);
    }
  });

  it('"2" cancela esa cita', () => {
    const { reminder, action } = resolveReminderReply(soloRecordatorio, "2");
    assert.equal(reminder?.id, "a");
    assert.equal(action, "cancel");
  });

  it('"cancelar" cancela esa cita', () => {
    for (const text of ["cancelar", "cancela mi cita", "no puedo ir", "no"]) {
      const { reminder, action } = resolveReminderReply(soloRecordatorio, text);
      assert.equal(reminder?.id, "a", `texto: "${text}"`);
      assert.equal(action, "cancel", `texto: "${text}"`);
    }
  });

  it("un texto cualquiera no mueve la cita, pero sí registra la respuesta", () => {
    const { reminder, action } = resolveReminderReply(soloRecordatorio, "gracias doctora");
    assert.equal(reminder?.id, "a");
    assert.equal(action, "none");
  });

  it("DOCUMENTA: 'ahí estaré' NO confirma (límite preexistente de isAffirmative)", () => {
    // No lo introduce este PR: el set de booking-parse.ts:117 no incluye esa
    // frase, así que la cita se queda SCHEDULED y el mensaje espera al staff en
    // el Inbox. Se deja escrito para que el día que se amplíe el vocabulario
    // este test lo señale en vez de pasar en silencio.
    assert.equal(resolveReminderReply(soloRecordatorio, "ahi estare").action, "none");
  });

  it("funciona igual con cita PENDING y CONFIRMED (reconfirmar no rompe)", () => {
    for (const status of WA_REMINDER_REPLYABLE_APPT_STATUSES) {
      const { reminder, action } = resolveReminderReply([r("x", APPT_AUTO_TYPE, status)], "1");
      assert.equal(reminder?.id, "x", `status: ${status}`);
      assert.equal(action, "confirm", `status: ${status}`);
    }
  });

  it("los tres tipos confirmables se comportan igual", () => {
    for (const type of WA_REMINDER_CONFIRMABLE_TYPES) {
      const { action } = resolveReminderReply([r("y", type, "SCHEDULED")], "2");
      assert.equal(action, "cancel", `type: ${type}`);
    }
  });
});

/* ── 3. La encuesta más nueva no le gana al recordatorio de cita viva ─────── */
describe("prioridad: encuesta reciente vs recordatorio de cita viva", () => {
  // Orden real del webhook: sentAt desc → el FOLLOWUP (de anoche) va primero.
  const lista = [
    r("followup", "FOLLOWUP", "COMPLETED"),
    r("cita", APPT_AUTO_TYPE, "SCHEDULED"),
  ];

  it("el accionable es el APPT_AUTO, jamás el FOLLOWUP", () => {
    assert.equal(pickActionableReminder(lista)?.id, "cita");
  });

  it('"1" confirma la cita futura y NO toca la ya atendida', () => {
    const { reminder, action } = resolveReminderReply(lista, "1");
    assert.equal(reminder?.id, "cita");
    assert.equal(action, "confirm");
    assert.equal(reminder?.appointment?.id, "appt-cita");
  });

  it('"2" NO cancela: lo último que recibió el paciente fue una ENCUESTA', () => {
    // La encuesta no le pidió cancelar nada, así que su "2" no puede llevarse
    // por delante la cita de mañana. Se registra sobre la encuesta.
    const { reminder, action } = resolveReminderReply(lista, "2");
    assert.equal(action, "none");
    assert.equal(reminder?.id, "followup");
  });

  it('"no tuve dolor" (respuesta legítima a la encuesta) no cancela nada', () => {
    // isNegative() matchea el "no" suelto: sin esta condición, contestar la
    // encuesta cancelaba la cita futura y el paciente recibía "❌ Tu cita ha
    // sido cancelada" justo después de opinar.
    for (const text of ["no tuve dolor", "todo bien, no me dolió", "no, ninguna molestia"]) {
      const { reminder, action } = resolveReminderReply(lista, text);
      assert.equal(action, "none", `texto: "${text}"`);
      assert.equal(reminder?.id, "followup", `texto: "${text}"`);
    }
  });

  it("cancelar SÍ funciona cuando el recordatorio de la cita es el más reciente", () => {
    const normal = [
      r("cita", APPT_AUTO_TYPE, "SCHEDULED"),
      r("followup", "FOLLOWUP", "COMPLETED"),
    ];
    assert.equal(resolveReminderReply(normal, "2").action, "cancel");
    assert.equal(resolveReminderReply(normal, "cancelar").reminder?.id, "cita");
  });
});

/* ── 3bis. Y el paciente que SÍ quiere cancelar no se queda sin poder ──────── */
describe("lo último que recibió el paciente SÍ pedía confirmar/cancelar", () => {
  // Caso real de tratamiento multi-sesión: cita X hoy 17:00 (asistió → COMPLETED,
  // su recordatorio de 2 h salió a las 15:00) y cita Y mañana (recordatorio de
  // 24 h enviado a las 09:00, sin contestar). A las 19:00 el paciente escribe
  // CANCELAR — la palabra que el propio mensaje le pide.
  const serie = [
    r("x-2h", APPT_AUTO_TYPE, "COMPLETED"),
    r("y-24h", APPT_AUTO_TYPE, "SCHEDULED"),
  ];

  it('"cancelar" cancela la cita viva, no se queda en silencio', () => {
    // Bloquearlo dejaría al paciente creyendo que canceló, sin ninguna
    // respuesta, y a la clínica esperándolo: no-show con silla bloqueada.
    const { reminder, action } = resolveReminderReply(serie, "cancelar");
    assert.equal(action, "cancel");
    assert.equal(reminder?.id, "y-24h");
  });

  it('"2" y "no puedo ir" también', () => {
    for (const text of ["2", "no puedo ir", "no"]) {
      assert.equal(resolveReminderReply(serie, text).action, "cancel", `texto: "${text}"`);
    }
  });

  it('"1" confirma la cita viva', () => {
    const { reminder, action } = resolveReminderReply(serie, "1");
    assert.equal(action, "confirm");
    assert.equal(reminder?.id, "y-24h");
  });

  it("un MANUAL cerrado encima tampoco bloquea (también pide confirmar/cancelar)", () => {
    const conManual = [r("man", "MANUAL", "CANCELLED"), r("viva", APPT_AUTO_TYPE, "SCHEDULED")];
    assert.equal(resolveReminderReply(conManual, "2").action, "cancel");
  });

  it("pero un RECALL encima sí bloquea: no pidió cancelar nada", () => {
    const conRecall = [r("rec", "RECALL", "COMPLETED"), r("viva", APPT_AUTO_TYPE, "SCHEDULED")];
    const { reminder, action } = resolveReminderReply(conRecall, "2");
    assert.equal(action, "none");
    assert.equal(reminder?.id, "rec");
  });

  it("aunque haya varios no-accionables encima", () => {
    const ruidoso = [
      r("recall", "RECALL", "COMPLETED"),
      r("birthday", "BIRTHDAY", null),
      r("followup", "FOLLOWUP", "COMPLETED"),
      r("cita", APPT_AUTO_TYPE, "CONFIRMED"),
    ];
    assert.equal(pickActionableReminder(ruidoso)?.id, "cita");
  });

  it("con dos accionables gana el más reciente (el primero de la lista)", () => {
    const dos = [
      r("nueva", APPT_AUTO_TYPE, "SCHEDULED"),
      r("vieja", APPT_AUTO_TYPE, "SCHEDULED"),
    ];
    assert.equal(pickActionableReminder(dos)?.id, "nueva");
  });
});

/* ── 4. EL BUG M-04: contestar la encuesta no puede tocar ninguna cita ────── */
describe("solo hay una encuesta post-cita pendiente", () => {
  const soloEncuesta = [r("followup", "FOLLOWUP", "COMPLETED")];

  it("no hay accionable", () => {
    assert.equal(pickActionableReminder(soloEncuesta), null);
  });

  it('responder "2" (mala calificación) NO cancela nada', () => {
    const { reminder, action } = resolveReminderReply(soloEncuesta, "2");
    assert.equal(action, "none");
    // Sí se registra la respuesta, para que el hilo no quede colgado.
    assert.equal(reminder?.id, "followup");
  });

  it('responder "1" (buena calificación) NO reabre la cita facturada', () => {
    assert.equal(resolveReminderReply(soloEncuesta, "1").action, "none");
  });

  it("ninguna respuesta imaginable mueve la cita", () => {
    for (const text of ["1", "2", "si", "no", "cancelar", "confirmo", "excelente", "pesima"]) {
      assert.equal(resolveReminderReply(soloEncuesta, text).action, "none", `texto: "${text}"`);
    }
  });

  it("lo mismo para los demás tipos no confirmables", () => {
    for (const type of ["FOLLOWUP", "RECALL", "BIRTHDAY", "TREATMENT_FOLLOWUP", "ENDO", "PERIO", "ORTHO", "IMPLANT"]) {
      const lista = [r("z", type, "SCHEDULED")]; // ¡incluso con cita viva!
      assert.equal(pickActionableReminder(lista), null, `type: ${type}`);
      assert.equal(resolveReminderReply(lista, "2").action, "none", `type: ${type}`);
    }
  });
});

/* ── 5. Citas que ya no admiten cambios ───────────────────────────────────── */
describe("la cita del recordatorio ya está cerrada", () => {
  for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "CHECKED_OUT"]) {
    it(`${status}: no se selecciona y no se actúa`, () => {
      const lista = [r("cerrada", APPT_AUTO_TYPE, status)];
      assert.equal(pickActionableReminder(lista), null);
      const { reminder, action } = resolveReminderReply(lista, "1");
      assert.equal(action, "none");
      assert.equal(reminder?.id, "cerrada"); // se registra la respuesta, nada más
    });
  }

  it("un recordatorio sin cita (recall suelto) tampoco es accionable", () => {
    assert.equal(pickActionableReminder([r("suelto", APPT_AUTO_TYPE, null)]), null);
    assert.equal(resolveReminderReply([r("suelto", "MANUAL", null)], "2").action, "none");
  });

  it("cae al siguiente accionable si el más reciente está cerrado", () => {
    const lista = [
      r("cerrada", APPT_AUTO_TYPE, "COMPLETED"),
      r("viva", APPT_AUTO_TYPE, "SCHEDULED"),
    ];
    assert.equal(pickActionableReminder(lista)?.id, "viva");
    assert.equal(resolveReminderReply(lista, "1").action, "confirm");
    // Y con "2" TAMBIÉN actúa: el mensaje cerrado seguía siendo un recordatorio
    // de cita, así que "cancelar" es coherente con lo que se le pidió. Este es
    // el assert que delata cualquier regla que silencie cancelaciones legítimas.
    const cancelada = resolveReminderReply(lista, "2");
    assert.equal(cancelada.action, "cancel");
    assert.equal(cancelada.reminder?.id, "viva");
  });
});

/* ── 6. Bordes ────────────────────────────────────────────────────────────── */
describe("bordes", () => {
  it("lista vacía → null, sin excepción", () => {
    assert.equal(pickActionableReminder([]), null);
    assert.deepEqual(resolveReminderReply([], "1"), { reminder: null, action: "none", unclear: false });
    assert.deepEqual(resolveReminderReply([], ""), { reminder: null, action: "none", unclear: false });
  });

  it("isActionableReminder es tolerante con filas incompletas", () => {
    assert.equal(isActionableReminder({ type: APPT_AUTO_TYPE, appointment: null }), false);
    assert.equal(isActionableReminder({ type: "", appointment: { status: "SCHEDULED" } }), false);
    // type null llega de una fila legacy con la columna vacía: no debe lanzar.
    assert.equal(
      isActionableReminder({ type: null as unknown as string, appointment: { status: "SCHEDULED" } }),
      false,
    );
    assert.equal(isActionableReminder({ type: APPT_AUTO_TYPE, appointment: { status: "" } }), false);
  });

  it("el type distingue mayúsculas (no hay coincidencia laxa)", () => {
    assert.equal(pickActionableReminder([r("m", "appt_auto", "SCHEDULED")]), null);
  });

  it("no muta el array que recibe", () => {
    const lista = [r("a", "FOLLOWUP", "COMPLETED"), r("b", APPT_AUTO_TYPE, "SCHEDULED")];
    const copia = JSON.parse(JSON.stringify(lista));
    resolveReminderReply(lista, "1");
    pickActionableReminder(lista);
    assert.deepEqual(lista, copia);
  });
});

/* ── 7. EL BUG DE PRODUCCIÓN: un dedazo inutilizaba la confirmación ─────────
   Reproducido con un paciente real: escribió "Confirmarr" (dos erres) y luego
   "Confirmar", "CONFIRMAR" y "SI". La cita nunca se confirmó porque el primer
   mensaje, al no ser ni confirmar ni cancelar, escribía `repliedAt` igual que
   una confirmación y quemaba el recordatorio para siempre.

   `text` llega al webhook ya en minúsculas y trimmed (route.ts), así que los
   tests lo pasan por el mismo filtro. */
const asWebhook = (raw: string): string => raw.trim().toLowerCase();

describe("erratas del paciente: los casos exactos del reporte", () => {
  const cita = [r("cita", APPT_AUTO_TYPE, "SCHEDULED")];
  const decide = (raw: string) => resolveReminderReply(cita, asWebhook(raw));

  it('"Confirmarr" (dedazo, dos erres) CONFIRMA', () => {
    // Era el caso 1 del reporte: \bconfirmar\b no casaba por la erre de más.
    assert.equal(decide("Confirmarr").action, "confirm");
  });

  it('"Confirmar", "CONFIRMAR", "SI", "sí", "1" confirman', () => {
    for (const raw of ["Confirmar", "CONFIRMAR", "SI", "sí", "1", "Sí, confirmo"]) {
      assert.equal(decide(raw).action, "confirm", `texto: "${raw}"`);
    }
  });

  it('"confirmado", "confirmo", "cofirmar" y demás dedazos también', () => {
    for (const raw of [
      "confirmado", "Confirmada", "confirmo", "cofirmar", "confimar",
      "comfirmar", "cnofirmar", "confrimar", "confirmé", "ya confirme",
      "confirmar mi cita del jueves", "CONFIRMARRR",
    ]) {
      assert.equal(decide(raw).action, "confirm", `texto: "${raw}"`);
    }
  });

  it('"CANCELAR", "2" y "mejor no" cancelan', () => {
    for (const raw of ["CANCELAR", "2", "mejor no", "Cancelar por favor"]) {
      assert.equal(decide(raw).action, "cancel", `texto: "${raw}"`);
    }
  });

  it('"no puedo confirmar" NO confirma — cancelar se evalúa primero', () => {
    // La tolerancia a erratas NO puede invertir este orden: la frase lleva
    // "confirmar" dentro y aun así es una negativa.
    const { action } = decide("no puedo confirmar");
    assert.notEqual(action, "confirm");
    assert.equal(action, "cancel");
  });

  it("un texto de verdad ajeno sigue sin mover la cita", () => {
    for (const raw of [
      "hola buenas", "gracias doctora", "quiero una cita", "cuánto cuesta la limpieza",
      "confío en usted", "ahí estaré",
    ]) {
      assert.equal(decide(raw).action, "none", `texto: "${raw}"`);
    }
  });

  it("la tolerancia NO se extiende a cancelar (cancelar de más no se deshace)", () => {
    // "canselar" cae en el "no te entendí" del webhook y el paciente lo
    // reescribe. Confirmar de más cuesta un ✅ sobrante; cancelar de más libera
    // el sillón y le dice al paciente que su cita ya no existe.
    assert.equal(decide("canselar").action, "none");
    assert.equal(decide("cancelarr").action, "none");
  });
});

/* ── 8. Una respuesta que no se entiende NO quema el recordatorio ──────────── */
describe("respuesta no entendida: la puerta queda abierta", () => {
  const cita = [r("cita", APPT_AUTO_TYPE, "SCHEDULED")];

  it("marca `unclear` para que el webhook pida aclarar y NO cierre la fila", () => {
    const { reminder, action, unclear } = resolveReminderReply(cita, "el jueves mejor");
    assert.equal(action, "none");
    assert.equal(unclear, true);
    assert.equal(reminder?.id, "cita");
  });

  it("y el intento siguiente, ya bien escrito, SÍ confirma", () => {
    // Es la secuencia del reporte. En la vida real el webhook no cierra la fila
    // en el primer mensaje, así que la lista de pendientes es la MISMA.
    assert.equal(resolveReminderReply(cita, "confirmarr").action, "confirm");
    assert.equal(resolveReminderReply(cita, "confirmar").action, "confirm");
    assert.equal(resolveReminderReply(cita, "si").action, "confirm");
  });

  it("no pide aclarar cuando lo último que recibió fue una encuesta", () => {
    // Pedirle "responde CONFIRMAR o CANCELAR" a quien acaba de contestar
    // "¿cómo te sentiste?" sería un sinsentido.
    const lista = [r("followup", "FOLLOWUP", "COMPLETED"), r("cita", APPT_AUTO_TYPE, "SCHEDULED")];
    const { reminder, action, unclear } = resolveReminderReply(lista, "todo excelente, gracias");
    assert.equal(action, "none");
    assert.equal(unclear, false);
    // Y se registra sobre la ENCUESTA, no sobre el recordatorio de la cita:
    // cerrar ahí el recordatorio vivo es exactamente el bug que se arregla.
    assert.equal(reminder?.id, "followup");
  });

  it("tampoco cuando el 'no' de una encuesta se coló como cancelar", () => {
    const lista = [r("followup", "FOLLOWUP", "COMPLETED"), r("cita", APPT_AUTO_TYPE, "SCHEDULED")];
    const { reminder, action, unclear } = resolveReminderReply(lista, "no tuve dolor");
    assert.equal(action, "none");
    assert.equal(unclear, false);
    assert.equal(reminder?.id, "followup");
  });

  it("una encuesta sola se cierra como siempre (no es 'no entendido')", () => {
    const { action, unclear } = resolveReminderReply([r("f", "FOLLOWUP", "COMPLETED")], "excelente");
    assert.equal(action, "none");
    assert.equal(unclear, false);
  });

  it("confirmar y cancelar nunca marcan `unclear`", () => {
    assert.equal(resolveReminderReply(cita, "1").unclear, false);
    assert.equal(resolveReminderReply(cita, "2").unclear, false);
    assert.equal(resolveReminderReply(cita, "confirmar").unclear, false);
    assert.equal(resolveReminderReply(cita, "cancelar").unclear, false);
  });
});

/* ── 9. Teléfonos compartidos: hermanos con el celular de la mamá ──────────── */
describe("varios pacientes con el mismo teléfono", () => {
  const withPatient = (id: string, type: string, status: string | null, patientId: string) => {
    const base = r(id, type, status);
    return { ...base, appointment: base.appointment ? { ...base.appointment, patientId } : null };
  };

  it("un solo dueño → sin ambigüedad, se confirma normal", () => {
    const lista = [
      withPatient("a", APPT_AUTO_TYPE, "SCHEDULED", "p1"),
      withPatient("b", APPT_AUTO_TYPE, "SCHEDULED", "p1"), // dos citas del MISMO
    ];
    assert.deepEqual(actionablePatientIds(lista), ["p1"]);
    assert.equal(resolveReminderReply(lista, "confirmar").action, "confirm");
  });

  it("dos hermanos con cita por confirmar → ambigüedad real", () => {
    const lista = [
      withPatient("hermana", APPT_AUTO_TYPE, "SCHEDULED", "p1"),
      withPatient("hermano", APPT_AUTO_TYPE, "SCHEDULED", "p2"),
    ];
    assert.equal(actionablePatientIds(lista).length, 2);
  });

  it("solo cuentan los ACCIONABLES: la cita cerrada del hermano no ambigua nada", () => {
    const lista = [
      withPatient("hermano", APPT_AUTO_TYPE, "COMPLETED", "p2"),  // ya atendida
      withPatient("hermana", APPT_AUTO_TYPE, "SCHEDULED", "p1"),
      withPatient("encuesta", "FOLLOWUP", "SCHEDULED", "p2"),     // no pide confirmar
    ];
    assert.deepEqual(actionablePatientIds(lista), ["p1"]);
  });

  it("sin patientId (filas viejas leídas sin la relación) no inventa dueños", () => {
    const lista = [r("a", APPT_AUTO_TYPE, "SCHEDULED"), r("b", APPT_AUTO_TYPE, "SCHEDULED")];
    assert.deepEqual(actionablePatientIds(lista), []);
  });

  it("lista vacía → sin dueños", () => {
    assert.deepEqual(actionablePatientIds([]), []);
  });
});
