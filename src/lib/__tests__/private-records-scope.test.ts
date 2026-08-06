/**
 * Notas privadas: la mitad del filtro que faltaba (Ola crítica · P1-N2).
 *
 * Run: npm run test:private-records
 *
 * `sharedRecordScope` sólo excluye las notas privadas de OTRA sede. Para una
 * clínica sola devuelve `{ clinicId }` pelado y NO mira `isPrivate`, así que
 * cinco superficies entregaban el SOAP privado de cualquier doctor a quien
 * abriera la ficha, recepción incluida.
 *
 * El bug de composición que estos tests vigilan es sutil y silencioso: los dos
 * filtros pueden ocupar la clave `OR`, y dos `OR` en el mismo objeto se pisan —
 * el segundo gana y la restricción DESAPARECE sin error. Por eso van en un
 * `AND: [a, b]` y por eso se prueba la forma, no sólo el contenido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// Desde el módulo PURO, no desde `@/lib/branches` (que importa `server-only` y
// no se puede cargar en un test de node). `branches` los re-exporta.
import { sharedRecordScope, ownPrivateRecordsOnly } from "../clinical/record-scope";

const YO = "user_yo";
const OTRO = "user_otro";

test("la nota privada la ve sólo su autor", () => {
  const f = ownPrivateRecordsOnly(YO) as { OR: Array<Record<string, unknown>> };
  assert.deepEqual(f.OR, [
    { isPrivate: false },
    { isPrivate: true, doctorId: YO },
  ]);
});

test("no hay excepción para admin — privada es privada", () => {
  // Mismo criterio que /api/records, que nunca la tuvo. Si alguien agrega una
  // rama por rol aquí, este test lo obliga a hacerlo a propósito.
  const f = ownPrivateRecordsOnly(OTRO) as { OR: Array<Record<string, unknown>> };
  assert.equal(f.OR.length, 2);
  assert.equal((f.OR[1] as { doctorId: string }).doctorId, OTRO);
});

test("con una sola clínica, sharedRecordScope NO filtra isPrivate — de ahí el bug", () => {
  // Este test documenta la causa raíz: si mañana alguien "arregla"
  // sharedRecordScope para que filtre también dentro de la sede, se enterará
  // aquí de que el otro helper pasa a ser redundante.
  const solo = sharedRecordScope("cli_1", ["cli_1"]);
  assert.deepEqual(solo, { clinicId: "cli_1" });
  assert.equal("isPrivate" in solo, false);
  assert.equal("OR" in solo, false);
});

test("con sedes vinculadas, sharedRecordScope SÍ ocupa la clave OR", () => {
  // La razón por la que los dos filtros NO pueden ir sueltos en el mismo objeto.
  const compartido = sharedRecordScope("cli_1", ["cli_1", "cli_2"]) as {
    OR: Array<Record<string, unknown>>;
  };
  assert.ok(Array.isArray(compartido.OR));
  assert.deepEqual(compartido.OR[1], { clinicId: { in: ["cli_2"] }, isPrivate: false });
});

test("componerlos sueltos PIERDE el filtro — por eso van en AND", () => {
  // La forma INCORRECTA: el segundo OR pisa al primero y la privada de otro
  // doctor vuelve a salir. Se prueba explícitamente para que quede escrito por
  // qué el where se ve como se ve.
  const mal = {
    ...sharedRecordScope("cli_1", ["cli_1", "cli_2"]),
    ...ownPrivateRecordsOnly(YO),
  } as { OR: Array<Record<string, unknown>> };
  assert.deepEqual(mal.OR, [{ isPrivate: false }, { isPrivate: true, doctorId: YO }]);
  // El scope de sede se evaporó: ni rastro de clinicId.
  assert.equal(JSON.stringify(mal).includes("cli_2"), false);

  // La forma CORRECTA: ambos sobreviven.
  const bien = {
    AND: [sharedRecordScope("cli_1", ["cli_1", "cli_2"]), ownPrivateRecordsOnly(YO)],
  };
  assert.equal(bien.AND.length, 2);
  assert.ok(JSON.stringify(bien).includes("cli_2"));
  assert.ok(JSON.stringify(bien).includes("doctorId"));
});
