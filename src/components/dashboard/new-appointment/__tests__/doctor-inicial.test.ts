/**
 * ws1-t11 · fase 2 · P2 — con qué doctor abre «Nueva cita» (decisión D1). Run: npm run test:cita-sin-doctor-panel
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPCION_SIN_DOCTOR,
  doctorIdParaEnviar,
  doctorInicialDeNuevaCita,
  doctorRealDe,
} from "../doctor-inicial";

// Ids como los de la base: cuid y de siembra (no son uuid).
const LAURA = "cm3doctor0000laura000001";
const MARIO = "seed-doctor-2";
const LISTA = [LAURA, MARIO];

test("botón genérico (sin preferencia): «Sin doctor»; sin el SQL, el primero de la lista (como hoy)", () => {
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: [], lista: LISTA, sinDoctorDisponible: true }), OPCION_SIN_DOCTOR);
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: [], lista: LISTA, sinDoctorDisponible: false }), LAURA);
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: [], lista: [], sinDoctorDisponible: false }), "");
});

test("un solo doctor: el botón genérico también abre en «Sin doctor» (D1 para todas las clínicas)", () => {
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: [], lista: [LAURA], sinDoctorDisponible: true }), OPCION_SIN_DOCTOR);
});

test("clic en la columna de un doctor: ese doctor; en la columna «Sin doctor» (`null`): «Sin doctor»", () => {
  assert.equal(doctorInicialDeNuevaCita({ delHueco: MARIO, candidatos: [LAURA], lista: LISTA, sinDoctorDisponible: true }), MARIO);
  assert.equal(doctorInicialDeNuevaCita({ delHueco: null, candidatos: [LAURA], lista: LISTA, sinDoctorDisponible: true }), OPCION_SIN_DOCTOR);
  // Sin el SQL, `null` no puede ser «Sin doctor»: los candidatos, como hoy.
  assert.equal(doctorInicialDeNuevaCita({ delHueco: null, candidatos: [MARIO], lista: LISTA, sinDoctorDisponible: false }), MARIO);
});

test("un candidato explícito (tratante, plan) que recibe citas gana; uno fuera de la lista cae a «Sin doctor»", () => {
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: [MARIO], lista: LISTA, sinDoctorDisponible: true }), MARIO);
  assert.equal(doctorInicialDeNuevaCita({ delHueco: undefined, candidatos: ["cmotro0000000000baja00001"], lista: LISTA, sinDoctorDisponible: true }), OPCION_SIN_DOCTOR);
});

test("al enviar: «Sin doctor» → null explícito; un id tal cual; «» sigue vacío (el 400 de siempre)", () => {
  assert.equal(doctorIdParaEnviar(OPCION_SIN_DOCTOR), null);
  assert.equal(doctorIdParaEnviar(LAURA), LAURA);
  assert.equal(doctorIdParaEnviar(""), "");
  assert.equal(doctorRealDe(OPCION_SIN_DOCTOR), null);
  assert.equal(doctorRealDe(""), null);
  assert.equal(doctorRealDe(MARIO), MARIO);
});
