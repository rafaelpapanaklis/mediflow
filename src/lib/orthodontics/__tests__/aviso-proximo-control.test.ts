// ws1-t8 #2 — «Avisar próximo control» va al responsable de pago cuando el caso lo tiene.
// Correr: npx tsx --test src/lib/orthodontics/__tests__/aviso-proximo-control.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  destinoDelAviso,
  MOTIVO_SIN_TELEFONO_NINGUNO,
  MOTIVO_SIN_TELEFONO_PACIENTE,
  textoAvisoProximoControl,
} from "../aviso-proximo-control";

const leer = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", "..", rel), "utf8");

test("con responsable con teléfono, el aviso va a él aunque el niño también tenga", () => {
  const r = destinoDelAviso({ responsablePhone: " 999 111 2222 ", hayResponsable: true, pacientePhone: "999 000 0000" });
  assert.deepEqual(r, { ok: true, destino: { telefono: "999 111 2222", esResponsable: true } });
});

test("con responsable con teléfono y niño SIN teléfono, sale al responsable (antes fallaba)", () => {
  const r = destinoDelAviso({ responsablePhone: "999 111 2222", hayResponsable: true, pacientePhone: null });
  assert.equal(r.ok === true && r.destino.esResponsable, true);
});

test("responsable sin teléfono: cae al del paciente", () => {
  const r = destinoDelAviso({ responsablePhone: "  ", hayResponsable: true, pacientePhone: "999 000 0000" });
  assert.deepEqual(r, { ok: true, destino: { telefono: "999 000 0000", esResponsable: false } });
});

test("sin responsable, como siempre: el paciente; sin nadie, el mensaje de siempre", () => {
  assert.deepEqual(destinoDelAviso({ pacientePhone: "999 000 0000" }), { ok: true, destino: { telefono: "999 000 0000", esResponsable: false } });
  assert.deepEqual(destinoDelAviso({ pacientePhone: null }), { ok: false, motivo: MOTIVO_SIN_TELEFONO_PACIENTE });
});

test("con responsable pero ni él ni el paciente tienen teléfono: mensaje claro que nombra a los dos", () => {
  const r = destinoDelAviso({ responsablePhone: null, hayResponsable: true, pacientePhone: "" });
  assert.deepEqual(r, { ok: false, motivo: MOTIVO_SIN_TELEFONO_NINGUNO });
  assert.match(MOTIVO_SIN_TELEFONO_NINGUNO, /paciente ni su responsable/);
});

test("el texto al responsable habla del paciente en tercera persona", () => {
  const base = { paciente: "Sofía Ruiz", clinica: "Clínica QA", fechaTexto: "5 de octubre", horaTexto: "10:00" };
  const tutor = textoAvisoProximoControl({ ...base, paraResponsable: true });
  assert.match(tutor, /control de ortodoncia de Sofía Ruiz/);
  assert.doesNotMatch(tutor, /tu próximo/);
  assert.match(textoAvisoProximoControl({ ...base, paraResponsable: false }), /^Hola Sofía Ruiz, tu próximo control/);
});

test("la acción usa el destino en el dedupe, la ventana de 24 h y el envío (nunca patient.phone directo)", () => {
  const src = leer("src/app/actions/orthodontics/whatsapp/avisarProximoControlAlPaciente.ts");
  assert.match(src, /destinoDelAviso\(/);
  assert.match(src, /lastSentOfKind\(ctx\.clinicId, telefonoDestino,/);
  assert.match(src, /lastInboundAtForPhone\(ctx\.clinicId, telefonoDestino\)/);
  assert.match(src, /to: telefonoDestino,/);
  assert.doesNotMatch(src, /to: patient\.phone|ForPhone\(ctx\.clinicId, patient\.phone/);
  assert.match(src, /clinicId: ctx\.clinicId, deletedAt: null/, "el plan se lee con filtro de clínica");
});
