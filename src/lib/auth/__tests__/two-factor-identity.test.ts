/* ============================================================
   EL SEGUNDO FACTOR ES DE LA PERSONA, NO DE LA FILA.

     npm run test:2fa-identity

   El agujero (EQ-02): `totpEnabled`, `totpSecret` y `recoveryCodes` son
   columnas de `User`, y una persona tiene UNA fila User POR clínica. El
   dueño con dos sedes activaba el 2FA en la principal y entraba a la
   segunda sin que el panel le pidiera nada, porque esa otra fila tenía
   totpEnabled=false.

   Aquí se fija la regla que lo decide. Las dos mitades importan y por
   motivos opuestos:

     · si `enrolado` se quedara corto, el agujero sigue abierto;
     · si `totpSecret` se quedara corto, el dueño recibe el reto en una
       sede y NO puede contestarlo — nadie tiene contra qué validar su
       código y se queda encerrado fuera de su propia clínica. Ese es el
       fallo que este arreglo NO puede tener.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

// Del módulo PURO: el que trae la base de datos importa `cache` de React, que
// no existe fuera del render de Next.
import { resolverDosFactores, type FilaDeDosFactores } from "../two-factor-identity-core";

const SECRET = "JBSWY3DPEHPK3PXP";

/** Una fila de clínica, con lo justo. */
function fila(p: Partial<FilaDeDosFactores> = {}): FilaDeDosFactores {
  return {
    totpEnabled: false,
    totpSecret: null,
    recoveryCodes: [],
    clinic: { require2fa: false },
    ...p,
  };
}

/* ══════════════════════════════════════════════════════════════
   1 · Enrolado en UNA sede = enrolado en todas
   ══════════════════════════════════════════════════════════════ */

test("el caso del hallazgo: enrolado en la principal, la segunda tambien obliga", () => {
  // Exactamente el estado que deja la base hoy: la fila donde se enroló tiene
  // secret y bandera; la sede hermana está en blanco.
  const r = resolverDosFactores([
    fila({ totpEnabled: true, totpSecret: SECRET, recoveryCodes: ["$2b$10$a"] }),
    fila(),
  ]);
  assert.equal(r.enrolado, true, "cambiar de sede seguiría saltándose el segundo factor");
});

test("da igual el orden de las filas", () => {
  const r = resolverDosFactores([
    fila(),
    fila({ totpEnabled: true, totpSecret: SECRET }),
  ]);
  assert.equal(r.enrolado, true);
});

test("sin ninguna fila enrolada, no obliga a nadie", () => {
  // Lo importante que NO hace: aplicarle el gate a quien no tiene 2FA sería
  // dejar a la mayoría de los usuarios fuera de su propio panel.
  const r = resolverDosFactores([fila(), fila(), fila()]);
  assert.equal(r.enrolado, false);
  assert.equal(r.algunaClinicaLoExige, false);
});

test("sin filas —cuenta desactivada o inexistente— no inventa nada", () => {
  const r = resolverDosFactores([]);
  assert.deepEqual(r, { enrolado: false, totpSecret: null, recoveryCodes: [], algunaClinicaLoExige: false });
});

/* ══════════════════════════════════════════════════════════════
   2 · El reto se tiene que poder CONTESTAR desde cualquier sede
   ══════════════════════════════════════════════════════════════ */

test("el secret viaja desde la sede donde se enrolo", () => {
  // Si esto devolviera null, la sede hermana pediría el código y ningún código
  // sería correcto: encerrado fuera de su propia clínica.
  const r = resolverDosFactores([
    fila(),
    fila({ totpEnabled: true, totpSecret: SECRET, recoveryCodes: ["$2b$10$a", "$2b$10$b"] }),
  ]);
  assert.equal(r.totpSecret, SECRET);
  assert.deepEqual(r.recoveryCodes, ["$2b$10$a", "$2b$10$b"]);
});

test("manda el secret de la fila ENROLADA, no el de una a medias", () => {
  // /setup guarda un secret nuevo con totpEnabled todavía en false. Si ese
  // ganara, el 2FA que ya funciona dejaría de validar los códigos del teléfono.
  const r = resolverDosFactores([
    fila({ totpSecret: "SECRETOAMEDIAS" }),
    fila({ totpEnabled: true, totpSecret: SECRET, recoveryCodes: ["$2b$10$a"] }),
  ]);
  assert.equal(r.totpSecret, SECRET);
  assert.deepEqual(r.recoveryCodes, ["$2b$10$a"]);
});

test("sin ninguna enrolada, sirve el secret a medias — es el enrolamiento en curso", () => {
  // El caso de /enable: acaba de pasar por /setup y todavía nadie está enrolado.
  const r = resolverDosFactores([fila({ totpSecret: "SECRETOAMEDIAS" }), fila()]);
  assert.equal(r.enrolado, false);
  assert.equal(r.totpSecret, "SECRETOAMEDIAS");
});

test("enrolado pero sin secret no puede prestar un secret que no existe", () => {
  // Estado corrupto (bandera sin secret). Obliga igual —fail-closed— pero no
  // se inventa credenciales.
  const r = resolverDosFactores([fila({ totpEnabled: true, totpSecret: null })]);
  assert.equal(r.enrolado, true);
  assert.equal(r.totpSecret, null);
});

/* ══════════════════════════════════════════════════════════════
   3 · La politica de la clinica, en cualquiera de ellas
   ══════════════════════════════════════════════════════════════ */

test("si UNA sola clinica exige 2FA, apagarlo queda bloqueado", () => {
  // Sin esto quedaba una salida: quien tiene una sede con require2fa y otra sin
  // él se cambiaba a la segunda y desde ahí se quitaba el 2FA de las dos.
  const r = resolverDosFactores([
    fila({ clinic: { require2fa: false } }),
    fila({ clinic: { require2fa: true } }),
  ]);
  assert.equal(r.algunaClinicaLoExige, true);
});

test("una clinica sin politica declarada no la exige", () => {
  const r = resolverDosFactores([fila({ clinic: null }), fila({ clinic: { require2fa: null } })]);
  assert.equal(r.algunaClinicaLoExige, false);
});

/* ══════════════════════════════════════════════════════════════
   4 · Una sola sede: nada cambia
   ══════════════════════════════════════════════════════════════ */

test("con una sola sede el resultado es el de siempre", () => {
  const solo = resolverDosFactores([
    fila({ totpEnabled: true, totpSecret: SECRET, recoveryCodes: ["$2b$10$a"], clinic: { require2fa: true } }),
  ]);
  assert.deepEqual(solo, {
    enrolado: true,
    totpSecret: SECRET,
    recoveryCodes: ["$2b$10$a"],
    algunaClinicaLoExige: true,
  });
});
