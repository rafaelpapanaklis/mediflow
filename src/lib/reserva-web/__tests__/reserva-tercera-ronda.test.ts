// ws1-t1 (tercera ronda) — «Nueva cita» en día cerrado (N-38) y reserva web: avisos sin WhatsApp (N-39) y precios
// del catálogo (N-40). Con el código de antes: la rejilla ofrecía huecos «libres» en domingo y avisaba después de
// guardar («horario de Ajustes»); la reserva prometía WhatsApp sin WhatsApp; los precios eran los tecleados a mano.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoHorarioAlAgendar, huecoFueraDeHorario } from "@/lib/agenda/aviso-horario-alta";
import { normalizarNombreServicio, precioDeServicio, preciosDelCatalogo, textosAvisoReserva } from "../datos-reserva";
import { scheduleViolation } from "@/lib/agenda/clinic-hours";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 N-38: día cerrado y hora fuera de horario se dicen antes de guardar", () => {
  const cerrado = { abierto: false, aperturaMin: null, cierreMin: null };
  const lv = { abierto: true, aperturaMin: 9 * 60, cierreMin: 19 * 60 };
  assert.equal(huecoFueraDeHorario(cerrado, 10 * 60, 30), true);
  assert.equal(huecoFueraDeHorario(lv, 8 * 60, 30), true);
  assert.equal(huecoFueraDeHorario(lv, 18 * 60 + 45, 30), true, "termina después del cierre");
  assert.equal(huecoFueraDeHorario(lv, 10 * 60, 30), false);
  assert.equal(huecoFueraDeHorario(null, 3 * 60, 30), false, "sin horario no se inventa nada");
  assert.match(avisoHorarioAlAgendar(cerrado, null)!, /^La clínica está cerrada ese día \(Configuración → Horarios y bloqueos\)/);
  assert.match(avisoHorarioAlAgendar(lv, { inicioMin: 8 * 60, duracionMin: 30 })!, /fuera del horario de la clínica \(09:00–19:00\)/);
  assert.equal(avisoHorarioAlAgendar(lv, { inicioMin: 10 * 60, duracionMin: 30 }), null);
});

test("🔴→🟢 N-38: el aviso de después de guardar ya no dice «Ajustes»", () => {
  const v = scheduleViolation(
    new Date("2026-10-04T16:00:00Z"), new Date("2026-10-04T16:30:00Z"), "America/Mexico_City",
    { agendaDayStart: 8, agendaDayEnd: 20 } as never,
    [{ dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" }, { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "19:00" }],
  );
  assert.equal(v?.reason, "closed_day");
  assert.ok(!/Ajustes/.test(v!.message));
  assert.match(v!.message, /Configuración → Horarios y bloqueos/);
  const picker = leer("components/dashboard/new-appointment/slot-grid-picker.tsx");
  assert.match(picker, /horario: body\.horarioDelDia \?\? null/);
  assert.match(picker, /if \(isSlotFree\(i\) && !fueraDeHorario\(i\)\) return i;/, "«primer hueco» prefiere uno en horario");
  assert.match(leer("app/api/appointments/route.ts"), /horarioDelDia: horarioDelDiaDeAjustes\(dateISO, session\.clinic\.schedules, session\.clinic\.timezone\)/);
});

test("🔴→🟢 N-39: sin WhatsApp conectado la reserva no promete ningún WhatsApp", () => {
  for (const t of [textosAvisoReserva(false, "Clínica QA"), textosAvisoReserva(undefined, "Clínica QA")]) {
    assert.ok(!/WhatsApp/.test(t.solicitudPide + t.solicitudConfirma + t.citaDetalles + t.campoTelefono));
    assert.equal(t.citaRecordatorio, null);
    assert.match(t.solicitudPide, /te llama al teléfono que dejes/);
  }
  assert.match(textosAvisoReserva(true, "Clínica QA").solicitudPide, /te confirma por WhatsApp/);
  const flujo = leer("app/[slug]/_shared/booking-flow.tsx");
  assert.ok(!/confirma por WhatsApp — todavía/.test(flujo), "el texto fijo se fue");
  assert.ok(!flujo.includes("Recibirás un WhatsApp con los detalles</div>"));
});

test("🔴→🟢 N-40: el precio sale del catálogo cuando el servicio está ligado; si no, como hoy", () => {
  const cat = preciosDelCatalogo([
    { name: "Blanqueamiento", basePrice: 3500 },
    { name: "Blanqueamiento", basePrice: 3500 },
    { name: "Profilaxis (limpieza)", basePrice: 600 },
    { name: "Limpieza dental", basePrice: 800 },
    { name: "Limpieza Dental", basePrice: 600 },
    { name: "Diagnóstico de caries", basePrice: 0 },
  ]);
  assert.equal(precioDeServicio({ name: "Blanqueamiento", price: "Desde $2,500" }, cat), "$3,500");
  assert.equal(precioDeServicio({ name: "limpieza dental", price: "Desde $600" }, cat), "Desde $600", "dos precios → el menor con «Desde»");
  assert.equal(precioDeServicio({ name: "Implantes", price: "Desde $14,000" }, cat), "Desde $14,000", "sin ligadura: como hoy");
  assert.equal(precioDeServicio({ name: "Diagnóstico de caries", price: null }, cat), null, "$0 no pone precio");
  assert.equal(normalizarNombreServicio("  Valoración   de ORTODONCIA "), "valoracion de ortodoncia");
  const flujo = leer("app/[slug]/_shared/booking-flow.tsx");
  assert.match(flujo, /price: precioDeServicio\(sv, clinic\.preciosCatalogo\)/);
  assert.match(leer("app/reservar/[slug]/page.tsx"), /\.\.\.\(await datosExtraDeReserva\(clinic\.id\)\)/);
  assert.match(leer("app/[slug]/clinic-landing-server.tsx"), /Object\.assign\(c, await datosExtraDeReserva\(clinic\.id\)\)/);
});
