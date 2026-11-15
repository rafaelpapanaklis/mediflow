/* ═══════════════════════════════════════════════════════════════════════
   EL BARBERO QUE PUEDE AVANZAR SUS VISITAS NO VE «SOLO PUEDES VER».

     npx tsx --test src/lib/barber/__tests__/agenda-aviso-barbero.test.ts

   Ronda 5 · M1 de la revisión de ws6-t2. Con `advanceOwnBarberId` (rol
   Barbero sin agenda.edit, ver api/barber/appointments/route.ts) la agenda
   dice «Puedes iniciar y completar tus visitas confirmadas; lo demás lo ve
   recepción.». Los demás roles de solo lectura conservan el aviso de siempre.
   Estática: el componente es de cliente y necesita fetch para pintarse.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getBarberT } from "@/i18n/dictionaries/barber";

const fuente = readFileSync(
  path.resolve(__dirname, "../../../components/barber/agenda/agenda-client.tsx"),
  "utf8",
);

test("la llave nueva existe en es y en en, y el aviso de los demás roles no cambió", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(
    es("barber.agenda.state.readOnlyOwnBarber"),
    "Puedes iniciar y completar tus visitas confirmadas; lo demás lo ve recepción.",
  );
  assert.equal(
    en("barber.agenda.state.readOnlyOwnBarber"),
    "You can start and complete your confirmed visits; the front desk handles the rest.",
  );
  assert.equal(es("barber.agenda.state.readOnly"), "Solo puedes ver la agenda. Pide permiso para editarla.");
  assert.equal(en("barber.agenda.state.readOnly"), "You can only view the schedule. Ask for permission to edit it.");
});

test("la agenda elige el aviso por advanceOwnBarberId y solo cuando no se puede editar", () => {
  // Solo aparece dentro del bloque «sin permiso de edición»…
  assert.match(fuente, /\{!canEdit && data \? \(/);
  // …y escoge la llave nueva únicamente con la bandera del barbero.
  assert.match(
    fuente,
    /data\.can\.advanceOwnBarberId\s*\?\s*t\("barber\.agenda\.state\.readOnlyOwnBarber"\)\s*:\s*t\("barber\.agenda\.state\.readOnly"\)/,
  );
});
