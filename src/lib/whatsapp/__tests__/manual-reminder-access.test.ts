/**
 * H-3 · La recepcionista veía «enviar recordatorio», lo pulsaba y recibía 403.
 *
 * `POST /api/whatsapp/send` exige administrador. Aquí se comprueba que (1) el
 * espejo de esa regla para la UI dice lo mismo que el servidor, y (2) NINGÚN
 * sitio que llame a esa ruta pinta su botón sin mirar antes quién es.
 *
 * Corre con: npm run test:wa-manual-reminder
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canSendManualReminder } from "../manual-reminder-access";

const raiz = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

test("solo ve el botón quien el servidor va a aceptar", () => {
  assert.equal(canSendManualReminder("ADMIN"), true);
  assert.equal(canSendManualReminder("SUPER_ADMIN"), true);
  for (const rol of ["RECEPTIONIST", "DOCTOR", "READONLY", "", null, undefined]) {
    assert.equal(canSendManualReminder(rol), false, String(rol));
  }
});

test("el espejo y el servidor dicen LO MISMO (si la ruta cambia, esto avisa)", () => {
  const ruta = leer("src/app/api/whatsapp/send/route.ts");
  assert.match(ruta, /requireAdmin\(ctx\)/, "la ruta ya no es admin-only: actualiza manual-reminder-access.ts con ella");
  const auth = leer("src/lib/auth-context.ts");
  assert.match(auth, /isSuperAdmin\s*=\s*finalUser\.role === "SUPER_ADMIN"/);
  assert.match(auth, /isAdmin\s*=\s*finalUser\.role === "ADMIN" \|\| isSuperAdmin/);
});

test("nadie llama a /api/whatsapp/send sin gatear su botón", () => {
  // Cada pantalla que usa la ruta, y la guarda que debe llevar su botón.
  const pantallas: Array<[string, RegExp, number]> = [
    ["src/components/dashboard/agenda/agenda-detail-panel.tsx", /permissions\.canSendReminder !== false && \(\s*<button[^>]*?onClick=\{sendWhatsapp\}/s, 1],
    ["src/app/dashboard/appointments/appointments-client.tsx", /waConnected && canSendReminder && \(\s*<(button|Button)[^\n]*?onClick=\{\(\) => sendWA\(/g, 2],
    ["src/components/dashboard/agenda-nueva/panel-cita.tsx", /esAdmin && \(\s*<button[^>]*?onClick=\{enviarWhatsapp\}/s, 1],
  ];
  for (const [rel, guarda, veces] of pantallas) {
    const src = leer(rel);
    assert.equal((src.match(guarda) ?? []).length, veces, `${rel}: botón sin guarda`);
  }

  // Y que no aparezca una pantalla NUEVA llamando a la ruta sin pasar por aquí.
  const conocidas = new Set(pantallas.map(([rel]) => rel));
  const huerfanas: string[] = [];
  const andar = (dir: string) => {
    for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "__tests__" && e.name !== "node_modules") andar(rel);
      } else if (/\.tsx?$/.test(e.name) && leer(rel).includes('"/api/whatsapp/send"') && !conocidas.has(rel)) {
        huerfanas.push(rel);
      }
    }
  };
  andar("src/app/dashboard");
  andar("src/components");
  assert.deepEqual(huerfanas, [], "pantalla nueva que llama a la ruta: añádela arriba con su guarda");
});

test("las dos páginas de servidor calculan el permiso con el espejo, no a mano", () => {
  for (const rel of ["src/app/dashboard/agenda/page.tsx", "src/app/dashboard/appointments/page.tsx"]) {
    assert.match(leer(rel), /canSendReminder[:=]\s*\{?canSendManualReminder\(user\.role\)/, rel);
  }
});
