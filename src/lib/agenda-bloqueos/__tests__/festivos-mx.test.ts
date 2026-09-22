/**
 * EL CATÁLOGO DE FESTIVOS DE MÉXICO — WS1-T2.
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *  1. Que los festivos móviles se CALCULAN. Un «primer lunes de febrero»
 *     tecleado a mano acierta un año y miente los otros tres; por eso se
 *     comprueban TRES años distintos, no uno.
 *  2. Que Pascua sale bien, porque de ella cuelgan los dos únicos festivos
 *     que no son «el n-ésimo lunes de»: **Pascua 2026 = 5 de abril**, y por
 *     tanto Jueves Santo = 2 de abril y Viernes Santo = 3 de abril.
 *  3. Que `oficial` y `porDefecto` NO son lo mismo: los de costumbre se
 *     proponen pero llegan DESMARCADOS (decisión de Rafael — muchas clínicas
 *     dentales abren el 24 y el 2 de noviembre).
 *  4. Que el 1 de diciembre aparece SOLO los años de transmisión del
 *     Ejecutivo. El próximo es 2030, así que 2026 NO lo lleva.
 *
 * Run: npm run test:agenda-bloqueos-festivos
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  domingoDePascua,
  esAnioDeTransmision,
  festivoPorKey,
  festivosDeMexico,
  nEsimoDiaSemana,
  FESTIVOS_ANIO_MAX,
  FESTIVOS_ANIO_MIN,
} from "../festivos-mx";

/** La fecha de un festivo por su sufijo de clave, en un año dado. */
function fecha(anio: number, sufijo: string): string | undefined {
  return festivosDeMexico(anio).find((f) => f.key === `MX-${anio}-${sufijo}`)?.fecha;
}

/* ── 1. Los lunes móviles, en tres años distintos ────────────────────────── */

test("el primer lunes de febrero se calcula, no se teclea", () => {
  // Tres años con tres respuestas distintas: una lista escrita a mano
  // acertaría uno y fallaría dos.
  assert.equal(fecha(2026, "CONSTITUCION"), "2026-02-02");
  assert.equal(fecha(2027, "CONSTITUCION"), "2027-02-01");
  assert.equal(fecha(2028, "CONSTITUCION"), "2028-02-07");
});

test("el tercer lunes de marzo (Benito Juárez) se calcula", () => {
  assert.equal(fecha(2026, "BENITO-JUAREZ"), "2026-03-16");
  assert.equal(fecha(2027, "BENITO-JUAREZ"), "2027-03-15");
  assert.equal(fecha(2028, "BENITO-JUAREZ"), "2028-03-20");
});

test("el tercer lunes de noviembre (Revolución) se calcula", () => {
  assert.equal(fecha(2026, "REVOLUCION"), "2026-11-16");
  assert.equal(fecha(2027, "REVOLUCION"), "2027-11-15");
  assert.equal(fecha(2028, "REVOLUCION"), "2028-11-20");
});

test("los tres lunes móviles caen SIEMPRE en lunes, en veinte años seguidos", () => {
  // La comprobación que no depende de ninguna fecha concreta: si el cálculo
  // se desalinea un día, esto lo caza en cualquier año.
  for (let anio = 2024; anio <= 2044; anio++) {
    for (const sufijo of ["CONSTITUCION", "BENITO-JUAREZ", "REVOLUCION"]) {
      const f = fecha(anio, sufijo)!;
      const [y, m, d] = f.split("-").map(Number);
      assert.equal(
        new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
        1,
        `${sufijo} de ${anio} (${f}) no cayó en lunes`,
      );
    }
  }
});

test("nEsimoDiaSemana: el primer lunes de febrero de 2026 es el día 2", () => {
  assert.equal(nEsimoDiaSemana(2026, 2, 1, 1), 2);
  assert.equal(nEsimoDiaSemana(2026, 3, 1, 3), 16);
  // Un mes que EMPIEZA en el día buscado: el 1 de junio de 2026 es lunes.
  assert.equal(nEsimoDiaSemana(2026, 6, 1, 1), 1);
});

/* ── 2. Pascua y la Semana Santa ─────────────────────────────────────────── */

test("Pascua 2026 es el 5 de abril, y de ahí salen el Jueves y el Viernes Santo", () => {
  assert.deepEqual(domingoDePascua(2026), { mes: 4, dia: 5 });
  assert.equal(fecha(2026, "JUEVES-SANTO"), "2026-04-02");
  assert.equal(fecha(2026, "VIERNES-SANTO"), "2026-04-03");
});

test("Pascua acierta en otros años conocidos", () => {
  assert.deepEqual(domingoDePascua(2024), { mes: 3, dia: 31 });
  assert.deepEqual(domingoDePascua(2025), { mes: 4, dia: 20 });
  assert.deepEqual(domingoDePascua(2027), { mes: 3, dia: 28 });
  assert.deepEqual(domingoDePascua(2028), { mes: 4, dia: 16 });
});

test("Pascua cae SIEMPRE en domingo, y el Jueves y el Viernes Santo en su día", () => {
  const diaDe = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  for (let anio = 2024; anio <= 2044; anio++) {
    const p = domingoDePascua(anio);
    const iso = `${anio}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
    assert.equal(diaDe(iso), 0, `Pascua de ${anio} (${iso}) no cayó en domingo`);
    assert.equal(diaDe(fecha(anio, "JUEVES-SANTO")!), 4, `Jueves Santo de ${anio}`);
    assert.equal(diaDe(fecha(anio, "VIERNES-SANTO")!), 5, `Viernes Santo de ${anio}`);
  }
});

test("la Semana Santa cruza de mes o de año sin romperse", () => {
  // 2027: Pascua el 28 de marzo, así que el Jueves Santo es el 25 de marzo.
  assert.equal(fecha(2027, "JUEVES-SANTO"), "2027-03-25");
  // 2024: Pascua el 31 de marzo; los dos días caen en marzo, no en abril.
  assert.equal(fecha(2024, "JUEVES-SANTO"), "2024-03-28");
  assert.equal(fecha(2024, "VIERNES-SANTO"), "2024-03-29");
});

/* ── 3. Oficial ≠ por defecto ────────────────────────────────────────────── */

test("los OFICIALES del art. 74 llegan marcados", () => {
  const oficiales = festivosDeMexico(2026).filter((f) => f.oficial);
  // Siete en 2026 (el 1 de diciembre no toca ese año).
  assert.equal(oficiales.length, 7);
  // Todo oficial viene marcado: nadie tiene que acordarse del 16 de septiembre.
  for (const f of oficiales) {
    assert.equal(f.porDefecto, true, `${f.key} es oficial pero no viene marcado`);
  }
});

test("los DE COSTUMBRE se proponen pero NO vienen marcados", () => {
  // Decisión de Rafael: muchas clínicas dentales abren el 24 y el 2 de
  // noviembre. Se proponen para que nadie tenga que acordarse; marcarlos es
  // de la clínica. Si esto se pone en `true`, se le cierra la agenda a quien
  // ese día trabaja media jornada y se entera cuando el paciente llama.
  const costumbre = festivosDeMexico(2026).filter((f) => !f.oficial);
  assert.equal(costumbre.length, 6);
  for (const f of costumbre) {
    assert.equal(f.porDefecto, false, `${f.key} no es oficial pero viene marcado`);
  }
  assert.deepEqual(
    costumbre.map((f) => f.key).sort(),
    [
      "MX-2026-DIA-DE-MUERTOS",
      "MX-2026-FIN-DE-ANIO",
      "MX-2026-GUADALUPE",
      "MX-2026-JUEVES-SANTO",
      "MX-2026-NOCHEBUENA",
      "MX-2026-VIERNES-SANTO",
    ],
  );
});

/* ── 4. El 1 de diciembre, cada seis años ────────────────────────────────── */

test("el 1 de diciembre sale SOLO los años de transmisión del Ejecutivo", () => {
  assert.equal(esAnioDeTransmision(2024), true);
  assert.equal(esAnioDeTransmision(2026), false);
  assert.equal(esAnioDeTransmision(2030), true);
  assert.equal(esAnioDeTransmision(2036), true);
  assert.equal(esAnioDeTransmision(2029), false);

  // 2026 NO lo lleva: el próximo es 2030.
  assert.equal(fecha(2026, "TRANSMISION-EJECUTIVO"), undefined);
  assert.equal(fecha(2030, "TRANSMISION-EJECUTIVO"), "2030-12-01");
  assert.equal(festivosDeMexico(2030).length, festivosDeMexico(2026).length + 1);
});

/* ── 5. Forma del catálogo ───────────────────────────────────────────────── */

test("el catálogo sale ordenado por fecha y con claves únicas del año", () => {
  const cat = festivosDeMexico(2026);
  const fechas = cat.map((f) => f.fecha);
  assert.deepEqual(fechas, [...fechas].sort(), "el catálogo no viene ordenado");
  assert.equal(new Set(cat.map((f) => f.key)).size, cat.length, "hay claves repetidas");
  // Toda clave lleva el año dentro: es lo que permite saber qué festivos de
  // ESTE año están puestos sin adivinarlo comparando fechas.
  for (const f of cat) assert.ok(f.key.startsWith("MX-2026-"), f.key);
  // Y toda fecha es de ese año.
  for (const f of cat) assert.ok(f.fecha.startsWith("2026-"), `${f.key} → ${f.fecha}`);
});

test("las fechas fijas están donde tienen que estar", () => {
  assert.equal(fecha(2026, "ANIO-NUEVO"), "2026-01-01");
  assert.equal(fecha(2026, "TRABAJO"), "2026-05-01");
  assert.equal(fecha(2026, "INDEPENDENCIA"), "2026-09-16");
  assert.equal(fecha(2026, "NAVIDAD"), "2026-12-25");
  assert.equal(fecha(2026, "DIA-DE-MUERTOS"), "2026-11-02");
  assert.equal(fecha(2026, "GUADALUPE"), "2026-12-12");
  assert.equal(fecha(2026, "NOCHEBUENA"), "2026-12-24");
  assert.equal(fecha(2026, "FIN-DE-ANIO"), "2026-12-31");
});

test("festivoPorKey encuentra el del año y no el de otro", () => {
  assert.equal(festivoPorKey(2026, "MX-2026-NAVIDAD")?.fecha, "2026-12-25");
  // La clave de OTRO año no aparece: es justo lo que impide que el bloqueo de
  // la Navidad de 2025 marque como puesta la de 2026.
  assert.equal(festivoPorKey(2026, "MX-2025-NAVIDAD"), null);
});

test("un año fuera del catálogo se rechaza en vez de inventar fechas", () => {
  assert.throws(() => festivosDeMexico(FESTIVOS_ANIO_MIN - 1), /fuera del catálogo/);
  assert.throws(() => festivosDeMexico(FESTIVOS_ANIO_MAX + 1), /fuera del catálogo/);
  assert.throws(() => festivosDeMexico(2026.5), /fuera del catálogo/);
  assert.throws(() => festivosDeMexico(NaN), /fuera del catálogo/);
});
