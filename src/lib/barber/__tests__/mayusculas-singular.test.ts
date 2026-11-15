/* ═══════════════════════════════════════════════════════════════════════
   MAYÚSCULA SOLO EN LA PRIMERA LETRA, Y «1 terminada», «1 ticket».

     npx tsx --test src/lib/barber/__tests__/mayusculas-singular.test.ts

   Pulido · punto 7 (M15 de la revisión de ws6-t3). `text-transform:
   capitalize` daba «Sábado, 14 De Noviembre», «Horarios Y Bloqueos», «Fila
   Virtual», «Noviembre De 2026» y «11:00 A.M.».
   NOTA (no se cambia aquí): el vertical mezcla 24 h («11:00» en la reserva
   pública, «22:36» en la agenda) con «11:00 a. m.» en el panel. Es una
   decisión de formato de todo el vertical.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { upperFirst } from "@/components/barber/upper-first";
import { getBarberT } from "@/i18n/dictionaries/barber";

const comp = path.resolve(__dirname, "../../../components/barber");
const leer = (rel: string) => readFileSync(path.join(comp, rel), "utf8");

test("upperFirst: solo la primera letra, sin tocar el resto", () => {
  assert.equal(upperFirst("sábado, 14 de noviembre"), "Sábado, 14 de noviembre");
  assert.equal(upperFirst("lun 16 de nov, 11:00 a. m."), "Lun 16 de nov, 11:00 a. m.");
  assert.equal(upperFirst("noviembre de 2026"), "Noviembre de 2026");
  assert.equal(upperFirst(""), "");
  assert.equal(upperFirst("épsilon"), "Épsilon");
});

test("ni el CSS de agenda y periodo ni las pantallas usan capitalize", () => {
  for (const rel of ["agenda/agenda.module.css", "cash/money.css"]) {
    assert.doesNotMatch(leer(rel), /text-transform:\s*capitalize/, rel);
  }
  assert.match(leer("agenda/agenda.module.css"), /\.dateTitle::first-letter \{ text-transform: uppercase; \}/);
  assert.match(leer("agenda/agenda.module.css"), /\.detailWhenSub::first-letter \{ text-transform: uppercase; \}/);
  assert.match(leer("cash/money.css"), /\.bcaja-period__label::first-letter \{ text-transform: uppercase; \}/);
  assert.doesNotMatch(leer("commissions/receipt-print.tsx"), /capitalize/);
  const sol = readFileSync(path.resolve(__dirname, "../../../app/barber/(panel)/solicitudes/solicitudes-client.tsx"), "utf8");
  assert.doesNotMatch(sol, /capitalize/);
});

test("singular correcto: «1 terminada», «1 ticket»", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.inicio.kpi.visitsHint", { count: 1, done: 1, pending: 2 }), "1 terminada · 2 por atender");
  assert.equal(es("barber.inicio.kpi.visitsHint", { count: 3, done: 3, pending: 1 }), "3 terminadas · 1 por atender");
  assert.equal(es("barber.inicio.kpi.visitsHint", { count: 0, done: 0, pending: 0 }), "0 terminadas · 0 por atender");
  assert.equal(en("barber.inicio.kpi.visitsHint", { count: 1, done: 1, pending: 2 }), "1 done · 2 to serve");
  assert.equal(es("barber.caja.session.ticketsInSession", { count: 1 }), "1 ticket");
  assert.equal(es("barber.caja.session.ticketsInSession", { count: 4 }), "4 tickets");
  assert.equal(en("barber.caja.session.ticketsInSession", { count: 1 }), "1 ticket");
  assert.equal(en("barber.caja.session.ticketsInSession", { count: 2 }), "2 tickets");
  // La llamada de Inicio manda el conteo que escoge singular/plural.
  assert.match(leer("dashboard/inicio-view.tsx"), /k\("kpi\.visitsHint", \{ count: v\.done,/);
});
