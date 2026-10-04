// ws1-t1 (tercera ronda, Bajas de G5) — N-48 (horas de la reserva en otra tipografía), N-49 (búsqueda vieja vacía
// con dos palabras), N-52 (Anticipos «Sin link» en una transferencia, plazos en minutos y horas), N-53 (bot
// «Cerrado» los 7 días) y N-54 (vista previa con fecha fija, «Ambos (WhatsApp + Email)», «(recall)»).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fechaDeEjemplo } from "../fecha-de-ejemplo";
import { botSiempreCerrado, horarioDelBotDesdeClinica } from "@/lib/whatsapp/bot/horario-desde-clinica";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 N-54: la vista previa usa MAÑANA, no «lunes 24 de junio»", () => {
  assert.equal(fechaDeEjemplo(new Date("2026-10-04T18:00:00Z"), "America/Mexico_City"), "lunes 5 de octubre");
  assert.equal(fechaDeEjemplo(new Date("2026-10-04T18:00:00Z"), "America/Mexico_City", "en"), "Monday, October 5");
  assert.match(leer("app/dashboard/settings/reminders-section.tsx"), /fechaDeEjemplo\(new Date\(\), clinic\?\.timezone\)/);
  assert.match(leer("app/dashboard/whatsapp/whatsapp-client.tsx"), /fecha: fechaDeEjemplo\(new Date\(\)\)/);
  const recall = leer("app/dashboard/settings/recall-section.tsx");
  assert.ok(!/titulo="Reactivación de pacientes \(recall\)"/.test(recall));
  assert.ok(!recall.includes(">WhatsApp y email<"));
});

test("🔴→🟢 N-53: el bot puede tomar el horario de la clínica", () => {
  const h = horarioDelBotDesdeClinica([
    { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" },
  ])!;
  assert.deepEqual(h["0"], { enabled: true, open: "09:00", close: "19:00" });
  assert.deepEqual(h["6"], { enabled: false, open: "09:00", close: "14:00" });
  assert.equal(h["3"].enabled, false, "un día sin fila: cerrado");
  assert.equal(horarioDelBotDesdeClinica([]), null);
  assert.equal(botSiempreCerrado({ "0": { enabled: false }, "1": { enabled: false } }), true);
  assert.equal(botSiempreCerrado(h), false);
  assert.match(leer("app/dashboard/whatsapp/bot/bot-client.tsx"), /usarHorarioClinica: horarioClinica \? usarHorarioClinica : undefined/);
  assert.match(leer("components/dashboard/whatsapp-rediseno/bot.tsx"), /Usar el horario de la clínica/);
});

test("🔴→🟢 N-52: una transferencia sin pagar dice que se espera, y cada plazo dice a qué anticipo aplica", () => {
  const a = leer("app/dashboard/settings/anticipos/anticipos-client.tsx");
  assert.match(a, /if \(sinMp && \(r\.estado === "FAILED" \|\| r\.estado === "PENDING"\)\) return \{ texto: "Esperando la transferencia"/);
  assert.match(a, /etiqueta="Plazo para pagar el anticipo del bot \(minutos\)"/);
  assert.match(a, /etiqueta="Plazo para pagar el anticipo pedido desde el panel \(horas\)"/);
});

test("🔴→🟢 N-49: la búsqueda vieja busca palabra por palabra", () => {
  const r = leer("app/api/patients/route.ts");
  assert.match(r, /AND: palabrasDeBusqueda\(search\)\.map\(\(tok\) => \(\{/);
  assert.ok(!/\{ firstName: \{ contains: search, mode/.test(r), "ya no la frase entera contra cada columna");
});

test("🔴→🟢 N-48: los botones de la reserva heredan la tipografía de la página", () => {
  assert.match(leer("app/reservar/[slug]/booking-client.tsx"), /button, input, select, textarea \{ font-family: inherit; \}/);
});
