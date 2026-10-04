// N-31 (tercera auditoría): dentro de la precarga, la sesión, el módulo, el paciente y el caso se leen UNA vez. Fuera
// de ella, cada llamada lee como siempre. Este módulo no existía con el código viejo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { conMemoDePeticion, memoDePeticion } from "../memo-de-peticion";

test("dentro de la petición, la misma clave se lee una sola vez; fuera, cada vez", async () => {
  let lecturas = 0;
  const leer = async () => ++lecturas;
  await conMemoDePeticion(async () => {
    const [a, b, c] = await Promise.all([memoDePeticion("auth", leer), memoDePeticion("auth", leer), memoDePeticion("auth", leer)]);
    assert.deepEqual([a, b, c], [1, 1, 1]);
    assert.equal(await memoDePeticion("otra", leer), 2);
  });
  assert.equal(await memoDePeticion("auth", leer), 3);
  assert.equal(await memoDePeticion("auth", leer), 4);
});

test("dos peticiones no comparten memoria, y un fallo no se queda guardado", async () => {
  let n = 0;
  const r1 = await conMemoDePeticion(() => memoDePeticion("x", async () => ++n));
  const r2 = await conMemoDePeticion(() => memoDePeticion("x", async () => ++n));
  assert.deepEqual([r1, r2], [1, 2]);
  let intentos = 0;
  await conMemoDePeticion(async () => {
    await assert.rejects(memoDePeticion("falla", async () => { intentos++; throw new Error("x"); }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(await memoDePeticion("falla", async () => ++intentos), 2);
  });
});
