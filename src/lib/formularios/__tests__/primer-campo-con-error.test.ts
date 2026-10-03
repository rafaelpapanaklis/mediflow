// ws1-t1 (auditoría BEVADENT, F8) — al fallar «Nuevo paciente» o «Nueva cita», la vista y el foco van al primer
// campo con error. Con el código de antes no existe el módulo y las ventanas solo pintaban el borde rojo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { llevarAlPrimerError, primerCampoConError } from "../primer-campo-con-error";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("el primero en el orden de la pantalla, no el primero que se marcó", () => {
  const orden = ["firstName", "lastName", "dob", "gender", "phone", "allergies"];
  assert.equal(primerCampoConError(orden, { allergies: true, lastName: true }), "lastName");
  assert.equal(primerCampoConError(orden, {}), null);
  assert.equal(primerCampoConError(orden, { phone: false }), null);
});

/** Un DOM mínimo: envolturas con `data-campo` y un enfocable dentro. */
function dom(campos: string[], ausentes: string[] = []) {
  const registro: string[] = [];
  const envolturas = new Map(
    campos.map((c) => {
      const control = { focus: () => registro.push(`foco:${c}`) };
      const envoltura = {
        matches: () => false,
        querySelector: () => control,
        scrollIntoView: () => registro.push(`vista:${c}`),
      };
      return [c, envoltura] as const;
    }),
  );
  const raiz = {
    querySelector: (sel: string) => {
      const m = /data-campo="([^"]+)"/.exec(sel);
      return m && !ausentes.includes(m[1]) ? envolturas.get(m[1]) ?? null : null;
    },
  } as unknown as ParentNode;
  return { raiz, registro };
}

test("desplaza hasta el primero con error y le pone el foco", () => {
  const { raiz, registro } = dom(["patient", "doctorId", "reason", "slot"]);
  const llevado = llevarAlPrimerError(raiz, ["patient", "doctorId", "reason", "slot"], { reason: true, slot: true });
  assert.equal(llevado, "reason");
  assert.deepEqual(registro, ["vista:reason", "foco:reason"]);
});

test("salta los campos que no están pintados (la rejilla de horas sin doctor)", () => {
  const { raiz, registro } = dom(["doctorId", "slot", "reason"], ["slot"]);
  assert.equal(llevarAlPrimerError(raiz, ["doctorId", "slot", "reason"], { slot: true, reason: true }), "reason");
  assert.deepEqual(registro, ["vista:reason", "foco:reason"]);
  assert.equal(llevarAlPrimerError(null, ["x"], { x: true }), null);
});

test("«Nuevo paciente» y «Nueva cita» marcan sus campos y llevan al primer error", () => {
  const alta = leer("components/dashboard/new-patient-modal.tsx");
  for (const campo of ["firstName", "lastName", "dob", "gender", "curp", "passportNo", "phone", "allergies"]) {
    assert.ok(alta.includes(`data-campo="${campo}"`), `falta la marca de ${campo}`);
  }
  assert.match(alta, /llevarAlPrimerError\(formRef\.current, ORDEN_CAMPOS_NUEVO_PACIENTE, nuevos\)/);

  const cita = leer("components/dashboard/new-appointment/new-appointment-dialog.tsx");
  for (const campo of ["patient", "doctorId", "resourceId", "reason", "slot"]) {
    assert.ok(cita.includes(`campo="${campo}"`), `falta la marca de ${campo}`);
  }
  assert.match(cita, /llevarAlPrimerError\(cuerpoRef\.current, ORDEN_CAMPOS_NUEVA_CITA, newErrors\)/);
});
