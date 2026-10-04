// ws1-t1 (ronda final, G5 tras la tercera auditoría de uso, REPORTE-ws1-t10): N-47 (botón verde en el cobro de
// ortodoncia), N-48 (hora del resumen en monoespaciada), N-55 (título de la Agenda), N-40 (precios por familia),
// N-A (19:45 sin apagar), N-B (carriles de la Semana sin rótulo), N-D (fecha de nacimiento mm/dd/yyyy) y N-E
// (Sabina tapa la última fila en el teléfono). Cada prueba importa lo nuevo por separado: con el código viejo,
// todas fallan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 N-A: el último hueco del día (no cabe) se apaga igual que los demás fuera de horario", async () => {
  const { pintarFueraDeHorario } = await import("@/lib/agenda/aviso-horario-alta");
  assert.equal(pintarFueraDeHorario({ libre: false, seSaleDelDia: true, fueraDeHorario: true }), true, "19:45 de un domingo");
  assert.equal(pintarFueraDeHorario({ libre: true, seSaleDelDia: false, fueraDeHorario: true }), true);
  assert.equal(pintarFueraDeHorario({ libre: false, seSaleDelDia: false, fueraDeHorario: true }), false, "ocupado de verdad: gris, no punteado");
  assert.equal(pintarFueraDeHorario({ libre: true, seSaleDelDia: false, fueraDeHorario: false }), false);
  assert.match(leer("components/dashboard/new-appointment/slot-grid-picker.tsx"), /seSaleDelDia: idx \+ slotsNeeded > total/);
});

test("🔴→🟢 N-B: en la Semana con varios doctores la tarjeta lleva las iniciales del doctor", async () => {
  const { inicialesDelResponsable } = await import("@/lib/agenda-nueva/carriles-semana");
  assert.equal(inicialesDelResponsable("Alejandro Beltrán Ríos"), "AB");
  assert.equal(inicialesDelResponsable("Dra. Mariana Cortés"), "MC");
  assert.equal(inicialesDelResponsable("Dr/a. Irma QaFix Ortiz"), "IQ");
  assert.equal(inicialesDelResponsable("Sabina"), "SA");
  assert.equal(inicialesDelResponsable(""), "");
  assert.match(leer("components/dashboard/agenda-nueva/vista-semana.tsx"), /conResponsable=\{carriles\.length > 1\}/);
  assert.match(leer("components/dashboard/agenda-nueva/tarjeta-cita.tsx"), /variante === "semana" && conResponsable && inicialesDelResponsable/);
});

test("🔴→🟢 N-40: «Ortodoncia», «Limpieza dental» e «Implantes» toman el «Desde» de su familia del tarifario", async () => {
  const { preciosDelCatalogo, precioDeServicio } = await import("@/lib/reserva-web/datos-reserva");
  const cat = preciosDelCatalogo([
    { name: "Ortodoncia brackets", basePrice: 25000 },
    { name: "Ortodoncia invisible", basePrice: 45000 },
    { name: "Limpieza dental profunda", basePrice: 800 },
    { name: "Implante dental", basePrice: 18000 },
    { name: "Blanqueamiento", basePrice: 3500 },
    { name: "Blanqueamiento en consultorio", basePrice: 2000 },
    { name: "Valoración de ortodoncia", basePrice: 500 },
  ]);
  const p = (name: string) => precioDeServicio({ name, price: "Desde $1" }, cat);
  assert.equal(p("Ortodoncia"), "Desde $25,000");
  assert.equal(p("Limpieza dental"), "Desde $800");
  assert.equal(p("Implantes"), "Desde $18,000");
  assert.equal(p("Blanqueamiento"), "$3,500", "lo exacto manda sobre la familia");
  assert.equal(p("Valoración de ortodoncia"), "$500");
  assert.equal(p("Odontopediatría"), "Desde $1", "sin ligadura: lo que escribió la clínica");
});

test("🔴→🟢 N-D y N-48: reserva web con fecha dd/mm/aaaa y sin monoespaciada", () => {
  const f = leer("app/[slug]/_shared/booking-flow.tsx");
  assert.ok(!/invalido=\{!form\.dob\} type="date"/.test(f), "type=date seguía el idioma del navegador (mm/dd/yyyy)");
  assert.match(f, /interpretarTecleo\(v, "1900-01-01"/);
  assert.match(f, /placeholder="dd\/mm\/aaaa"/);
  assert.ok(!f.includes("font-mono"), "la hora del resumen salía en monoespaciada");
});

test("🔴→🟢 N-55: la Agenda titula su pestaña «Agenda»", () => {
  assert.match(leer("app/dashboard/agenda/page.tsx"), /export const metadata: Metadata = \{ title: "Agenda" \}/);
});

test("🔴→🟢 N-47: los cajones de cobro de ortodoncia guardan con el botón primario, no verde", () => {
  for (const f of ["DrawerConfigCobro", "DrawerCambiarPlanDePago", "DrawerElegirDescuento", "DrawerPromesaDePago"]) {
    assert.ok(!leer(`components/specialties/orthodontics/redesign/drawers/${f}.tsx`).includes('variant="emerald"'), f);
  }
});

test("🔴→🟢 N-E: la Fila y Hoy dejan sitio a Sabina al final en el teléfono", () => {
  assert.match(leer("components/dashboard/piezas-rediseno/fila-espera.tsx"), /<EspacioSabina \/>/);
  assert.match(leer("components/dashboard/hoy-rediseno/hoy-recepcion.tsx"), /<EspacioSabina \/>/);
  assert.match(leer("components/dashboard/espacio-sabina.module.css"), /@media \(max-width: 768px\)[\s\S]*height: 88px/);
});
