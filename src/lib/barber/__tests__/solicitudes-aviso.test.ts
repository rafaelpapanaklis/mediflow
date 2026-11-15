/* ═══════════════════════════════════════════════════════════════════════
   SOLICITUDES: «Rechazar» pregunta, y si al cliente no le llegó aviso el
   dueño lo ve y avisa él.

     npx tsx --test src/lib/barber/__tests__/solicitudes-aviso.test.ts

   Pulido · punto 2 (M2, M3 de la revisión de ws6-t3). La parte de datos
   (notified true/false según WhatsApp y ventana de 24 h) está probada con
   Postgres real en reserva-frenos-integration.test.ts. Aquí, de forma
   estática (la pantalla es de cliente): la ruta pasa `notified` y la pantalla
   lo usa; «Rechazar» no llama al servidor hasta confirmar; es y en completos.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getBarberT } from "@/i18n/dictionaries/barber";

const raiz = path.resolve(__dirname, "../../..");
const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

test("la ruta devuelve `notified` junto al estado", () => {
  const ruta = leer("app/api/barber/booking-requests/[id]/route.ts");
  assert.match(ruta, /notified:\s*result\.notified/);
});

test("«Rechazar» solo abre la confirmación; la llamada sale con «Sí, rechazar»", () => {
  const src = leer("app/barber/(panel)/solicitudes/solicitudes-client.tsx");
  // El botón «Rechazar» ya no llama a resolve().
  assert.doesNotMatch(src, /onClick=\{\(\) => void resolve\(r, "rechazar"\)\}[\s\S]{0,80}solicitudes\.rechazar"\)\}/);
  assert.match(src, /setConfirmId\(confirmId === r\.id \? null : r\.id\)/);
  // La única llamada a resolve(r, "rechazar") está dentro de la confirmación.
  const idx = src.indexOf('resolve(r, "rechazar")');
  assert.ok(idx > src.indexOf('role="alertdialog"'), "el rechazo vive dentro de la confirmación");
  // El aviso solo sale con notified === false (un servidor viejo no alarma).
  assert.match(src, /body\?\.notified === false/);
});

test("los textos nuevos existen en es y en", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.reserva.solicitudes.avisaTu"), "Avísale tú: a este cliente no le llegó mensaje.");
  assert.equal(es("barber.reserva.solicitudes.confirmarRechazoSi"), "Sí, rechazar");
  assert.equal(es("barber.reserva.solicitudes.confirmarRechazo", { nombre: "Ana" }), "¿Rechazar la solicitud de Ana?");
  for (const k of [
    "confirmarRechazo",
    "confirmarRechazoSi",
    "confirmarRechazoNo",
    "avisaTuAcepto",
    "avisaTuRechazo",
    "avisaTu",
    "avisaTuLlamar",
    "avisaTuWhatsapp",
    "avisaTuSinTelefono",
    "avisaTuCerrar",
  ]) {
    const key = `barber.reserva.solicitudes.${k}`;
    assert.notEqual(es(key, { nombre: "X" }), key, `es sin ${k}`);
    assert.notEqual(en(key, { nombre: "X" }), key, `en sin ${k}`);
  }
});
