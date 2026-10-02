// ws1-t4 (11.2) — la reseña no depende del botón con que se cierra la cita.
// Todas las puertas que dejan una cita en COMPLETED piden la invitación (que es
// idempotente: una por cita). Es una guarda de código fuente, a propósito: si
// alguien abre una puerta nueva a COMPLETED y no la añade aquí, la reseña
// volvería a salir o no según el botón.
// Correr: npm run test:resenas-entrega
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUERTAS: Array<{ nombre: string; ruta: string }> = [
  { nombre: "«Terminar consulta» (ficha del paciente)", ruta: "src/app/api/appointments/[id]/complete/route.ts" },
  { nombre: "estado desde la Agenda", ruta: "src/app/api/appointments/[id]/status/route.ts" },
  { nombre: "firmar la hoja de control de ortodoncia", ruta: "src/app/actions/orthodontics/signTreatmentCard.ts" },
  { nombre: "colgar la teleconsulta", ruta: "src/app/api/teleconsulta/end/route.ts" },
];

describe("cerrar la cita pide la reseña por cualquier camino", () => {
  for (const p of PUERTAS) {
    it(p.nombre, () => {
      const src = readFileSync(join(process.cwd(), p.ruta), "utf8");
      assert.match(src, /import \{ sendReviewInvitation \} from "@\/lib\/reviews\/invite"/);
      assert.match(src, /await sendReviewInvitation\(/);
    });
  }

  it("la Agenda solo la pide al pasar a COMPLETED, no en cada cambio de estado", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/appointments/[id]/status/route.ts"), "utf8");
    assert.match(src, /if \(body\.status === "COMPLETED"\) \{\s*await sendReviewInvitation\(/);
  });
});
