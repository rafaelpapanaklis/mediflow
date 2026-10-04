// ws1-t1 (ronda de arreglos de la auditoría de uso, C-101) — «Recordar por WhatsApp» en el Hoy de recepción.
// Con el código de antes: el botón llevaba a /dashboard/whatsapp?intent=remind (la pantalla de CONECTAR
// WhatsApp), no recordaba nada, y sin WhatsApp no decía que al paciente no le llega nada. Tampoco «Editar
// cita» ni «Nueva cita» lo decían: con la clínica sin WhatsApp la casilla desaparecía sin explicación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accionCitasSinConfirmar } from "../accion-sin-confirmar";
import { textosAvisoReprogramar } from "@/lib/agenda/aviso-al-reprogramar";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const citas = [
  { id: "c1", patient: { name: "Ana López" } },
  { id: "c2", patient: { name: "Luis Pérez" } },
];

test("🔴→🟢 con WhatsApp: abre la Agenda del día en la primera cita sin confirmar (no la pantalla de conectar)", () => {
  const a = accionCitasSinConfirmar(citas, "2026-10-05", true);
  assert.equal(a.title, "2 citas sin confirmar");
  assert.equal(a.cta?.label, "Recordar por WhatsApp");
  assert.equal(a.cta?.href, "/dashboard/agenda?date=2026-10-05&highlight=c1");
  assert.ok(!a.cta?.href.includes("/dashboard/whatsapp"));
  assert.equal(a.detail, "Ana, Luis");
});

test("🔴→🟢 sin WhatsApp no promete un WhatsApp: lo dice y propone llamar", () => {
  const a = accionCitasSinConfirmar(citas, "2026-10-05", false);
  assert.equal(a.cta?.label, "Confirmar por teléfono");
  assert.match(a.detail ?? "", /WhatsApp no está conectado: al paciente no le llega ningún recordatorio/);
});

test("la ruta del Hoy de recepción usa la acción y ya no manda a ?intent=remind", () => {
  const ruta = leer("app/api/dashboard/home/receptionist/route.ts");
  assert.ok(!ruta.includes("intent=remind"));
  assert.match(ruta, /accionCitasSinConfirmar\(unconfirmed, dateISO, session\.clinic\.waConnected\)/);
});

test("🔴→🟢 Editar/Mover cita y Nueva cita dicen que sin WhatsApp al paciente no le llega nada", () => {
  assert.match(textosAvisoReprogramar("es").sinWhatsApp, /no tiene WhatsApp conectado: al paciente no le llega nada/);
  assert.match(textosAvisoReprogramar("en").sinWhatsApp, /no WhatsApp connected/);
  const casilla = leer("components/dashboard/agenda/aviso-al-reprogramar.tsx");
  assert.match(casilla, /estado === "apagado" \|\| estado === "sinWhatsApp"/);
  const nueva = leer("components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(nueva, /\{!boot\.waConnected && \([\s\S]{0,300}whatsAppNotConnected/);
  for (const d of ["es", "en"]) {
    const dic = JSON.parse(leer(`i18n/dictionaries/${d}.json`));
    assert.ok(dic.appointments.newApptDialog.whatsAppNotConnected, `falta whatsAppNotConnected en ${d}`);
  }
});
