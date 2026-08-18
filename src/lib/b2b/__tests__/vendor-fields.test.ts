/* ============================================================
   LAS LISTAS BLANCAS DE PROVEEDOR Y LABORATORIO.

     npm run test:vendor-fields

   `mpAccessToken` es la credencial con la que se cobra A NOMBRE del
   vendedor: un secreto de un tercero, no de la plataforma. Salía por
   siete sitios (B2B-12) y se cerró con listas blancas
   (../vendor-fields.ts). Esto las sujeta.

   La prueba que más vale es la tercera: que ningún campo del modelo que
   HUELA a credencial pueda entrar en la lista en el futuro. La lista de
   nombres de hoy envejece; el patrón, no.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LAB_SELECT, PROVEEDOR_SELECT, SECRETOS_DE_VENDEDOR } from "../vendor-fields";

/**
 * Los campos ESCALARES de un modelo, leídos del esquema de verdad.
 *
 * Las relaciones (`users SupplierUser[]`, `orders SupplierOrder[]`) no son
 * columnas seleccionables y no pintan nada aquí: se descartan mirando si el
 * tipo del campo es a su vez un modelo del esquema.
 */
function camposDelModelo(modelo: string): string[] {
  const esquema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const modelos = new Set(Array.from(esquema.matchAll(/^model ([A-Za-z0-9_]+) \{$/gm), m => m[1]));
  const bloque = esquema.match(new RegExp(`^model ${modelo} \\{$([\\s\\S]*?)^\\}$`, "m"));
  assert.ok(bloque, `no se encontró el modelo ${modelo} en prisma/schema.prisma`);
  const campos: string[] = [];
  for (const linea of bloque[1].split("\n")) {
    const m = linea.match(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\[\])?(\?)?/);
    if (m && !modelos.has(m[2])) campos.push(m[1]);
  }
  return campos;
}

const LISTAS = [
  { nombre: "DentalLab", modelo: "DentalLab", select: LAB_SELECT },
  { nombre: "Supplier", modelo: "Supplier", select: PROVEEDOR_SELECT },
] as const;

for (const { nombre, modelo, select } of LISTAS) {
  const claves = Object.keys(select);

  test(`${nombre}: el token de MercadoPago no está en la lista blanca`, () => {
    const colados = (SECRETOS_DE_VENDEDOR as readonly string[]).filter(s => claves.includes(s));
    assert.deepEqual(
      colados, [],
      "Con el mpAccessToken en la lista, el panel de administración le entrega " +
      "a quien lo abra la credencial de cobro de cada vendedor.",
    );
  });

  test(`${nombre}: nada que parezca una credencial puede entrar en la lista`, () => {
    const HUELE_A_SECRETO = /secret|token|hash|password|apikey|privatekey|credential|clabe|accountnumber/i;
    const sospechosos = claves.filter(c => HUELE_A_SECRETO.test(c));
    assert.deepEqual(sospechosos, [], `Campos con pinta de credencial en la lista blanca de ${nombre}.`);
  });

  test(`${nombre}: todo campo de la lista existe en el modelo`, () => {
    // El `select` es un objeto de literales: TypeScript no comprueba que las
    // claves sean columnas reales, y un typo revienta en producción con
    // "Unknown field" de Prisma, no en el build.
    const delModelo = new Set(camposDelModelo(modelo));
    const inventados = claves.filter(c => !delModelo.has(c));
    assert.deepEqual(inventados, [], `Campos de la lista blanca que no existen en ${modelo}.`);
  });

  test(`${nombre}: la lista cubre todo lo que NO es secreto`, () => {
    // Al revés que las otras: una lista blanca recortada de más deja la
    // pantalla de administración sin datos. Si el modelo estrena una columna
    // pública, esto falla y obliga a decidir — que es el punto. Si la columna
    // nueva es un secreto, se añade a SECRETOS_DE_VENDEDOR y ya.
    const publicasDelModelo = camposDelModelo(modelo)
      .filter(c => !(SECRETOS_DE_VENDEDOR as readonly string[]).includes(c));
    const faltan = publicasDelModelo.filter(c => !claves.includes(c));
    assert.deepEqual(
      faltan, [],
      `${modelo} tiene columnas que ni están en la lista blanca ni declaradas como secreto. ` +
      "Decide cuál de las dos cosas son.",
    );
  });

  test(`${nombre}: el select solo admite true`, () => {
    assert.ok(Object.values(select).every(v => v === true));
  });
}
