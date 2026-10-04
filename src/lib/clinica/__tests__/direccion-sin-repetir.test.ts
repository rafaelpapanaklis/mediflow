// N-34 (segunda auditoría): la dirección salía «… Ciudad de México, CDMX, Ciudad de México» en la carta y la constancia.
// Con el código viejo el membrete y la carta pegaban la ciudad aunque la dirección ya la trajera.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicLetterheadLines } from "@/lib/pdf/clinic-letterhead";
import { direccionDeClinica } from "@/lib/consent/documento";

const DIR = "Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, 03100 Ciudad de México, CDMX";

test("el membrete no repite la ciudad que la dirección ya trae", () => {
  const lineas = clinicLetterheadLines({ clinicName: "QA", clinicAddress: DIR, clinicCity: "Ciudad de México", clinicState: null } as never);
  assert.ok(!lineas.includes("Ciudad de México"), JSON.stringify(lineas));
  assert.equal(lineas[0], DIR);
  // Si la dirección no dice la ciudad, sí va.
  assert.ok(clinicLetterheadLines({ clinicName: "QA", clinicAddress: "Calle 5 #12", clinicCity: "Puebla", clinicState: "Pue." } as never).includes("Puebla, Pue."));
});

test("la carta tampoco", () => {
  assert.equal(direccionDeClinica(DIR, "Ciudad de México"), DIR);
  assert.equal(direccionDeClinica("Calle 5 #12", "Puebla"), "Calle 5 #12, Puebla");
});

test("N-34: carta vieja — la cabecera toma la cédula que dice el texto si el doctor ya no la tiene", async () => {
  const { cedulaEnElTexto } = await import("@/lib/consent/documento");
  assert.equal(cedulaEnElTexto("Nombre: Dr. X\nCédula profesional: 4455667\nEspecialidad: ____"), "4455667");
  assert.equal(cedulaEnElTexto("Cédula profesional: ____________"), null);
  assert.equal(cedulaEnElTexto(null), null);
});
