// ws1-t1 (ronda de arreglos de la auditoría de uso, C-100) — reserva web pública.
// Con el código de antes: «Lunes, 5 De Octubre» (clase `capitalize`), «Dr/a. Dr Import…», un implante de 90 min
// se podía pedir en un hueco de 30, y «Valoración de ortodoncia» salía sin precio ni explicación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cabeElServicio, fechaLargaReserva, lineaDePrecio, nombreDoctorReserva, textoNoCabe } from "../textos-reserva";

const SRC = join(__dirname, "..", "..", "..");
const FLUJO = readFileSync(join(SRC, "app/[slug]/_shared/booking-flow.tsx"), "utf8");

test("🔴→🟢 la fecha: solo la primera letra en mayúscula", () => {
  assert.equal(fechaLargaReserva("2026-10-05"), "Lunes, 5 de octubre");
  assert.ok(!FLUJO.includes("mb-3 capitalize"), "sin la clase que subía todas las palabras");
});

test("🔴→🟢 el título del doctor no se repite", () => {
  assert.equal(nombreDoctorReserva({ firstName: "Ana", lastName: "López" }), "Dr/a. Ana López");
  assert.equal(nombreDoctorReserva({ firstName: "Dr Importado", lastName: "Uno" }), "Dr Importado Uno");
  assert.equal(nombreDoctorReserva({ firstName: "Dra.", lastName: "Ruiz" }), "Dra. Ruiz");
  assert.ok(!/`Dr\/a\. \$\{/.test(FLUJO) && !FLUJO.includes("Dr/a. {doc.firstName}"), "todas las salidas usan nombreDoctorReserva");
});

test("🔴→🟢 un procedimiento de 90 min no cabe en un hueco suelto de 30", () => {
  const libres = ["10:00", "10:30", "11:30", "12:00", "12:30"];
  assert.equal(cabeElServicio("10:00", 90, libres), false, "11:00 está ocupado");
  assert.equal(cabeElServicio("11:30", 90, libres), true);
  assert.equal(cabeElServicio("10:00", 60, libres), true);
  assert.equal(cabeElServicio("12:30", 30, libres), true, "30 min cabe en su propio hueco");
  assert.equal(cabeElServicio("10:00", null, libres), true, "sin duración no se bloquea");
  assert.equal(textoNoCabe("10:00", 90), "No cabe a las 10:00: dura 90 min. Elige otra hora.");
});

test("con «cualquier doctor», tiene que ser UN mismo doctor en todos los tramos", () => {
  const libres = ["10:00", "10:30", "11:00"];
  const distintos = { "10:00": ["a"], "10:30": ["b"], "11:00": ["a"] };
  const mismo = { "10:00": ["a", "b"], "10:30": ["b"], "11:00": ["b"] };
  assert.equal(cabeElServicio("10:00", 90, libres, distintos), false);
  assert.equal(cabeElServicio("10:00", 90, libres, mismo), true);
});

test("🔴→🟢 sin precio, cuando otros sí lo tienen, se dice «Precio a confirmar en la clínica»", () => {
  assert.equal(lineaDePrecio({ price: null, durationMin: 45 }, true), "Precio a confirmar en la clínica · 45 min");
  assert.equal(lineaDePrecio({ price: "$500", durationMin: 30 }, true), "$500 · 30 min");
  assert.equal(lineaDePrecio({ price: null, durationMin: null }, false), null);
});

test("el flujo usa la regla en el paso de procedimiento y en el de hora", () => {
  assert.match(FLUJO, /const noCabe = !!selSlot && !!s\.durationMin && !cabeElServicio\(selSlot/);
  assert.match(FLUJO, /!cabeElServicio\(s, servicioElegido\.durationMin, slots/);
  assert.match(FLUJO, /setDoctoresPorHueco\(d\.slotDoctors \?\? null\)/);
});
