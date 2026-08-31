/**
 * DaleControl INSTITUCIONAL — Ola 8 · LA CARTERA DE IA DEL INSTITUTO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ia-cupo.test.ts
 *
 * Todo sin base de datos: solo funciones puras y objetos `where`.
 *
 * Lo que fija:
 *  1. la ARITMÉTICA del cupo — el techo, lo que queda, la barra;
 *  2. 🔴 las DOS REGLAS del excedente, que son lo que impide la fuga;
 *  3. 🔴 QUIÉN EDITA QUÉ: las dos keys nuevas, quién las tiene y —lo más
 *     importante— que lo que INCLUYE el contrato no lo abre ninguna;
 *  4. el ALCANCE del gasto, que es el del DINERO y no uno nuevo;
 *  5. el PERIODO: a qué mes se carga un gasto, en la zona del instituto;
 *  6. el dinero: dos unidades, una conversión, y cómo se lee lo que teclea
 *     una persona;
 *  7. la pantalla: item de menú, etiqueta y que no diga "Ola".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_IA_MAX_TOPE_USD_CENTS,
  EDU_IA_MICROS_POR_CENTAVO,
  EDU_IA_MODELOS,
  eduIaCentsToMicros,
  eduIaEnExcedente,
  eduIaCupoAgotado,
  eduIaIncluidoUsdMicros,
  eduIaMarcaIncluido,
  eduIaParte,
  eduIaPeriodKey,
  eduIaPeriodoLabel,
  eduIaPorcentajeUsado,
  eduIaPrecioLabel,
  eduIaRestanteUsdMicros,
  eduIaTechoUsdMicros,
  eduIaUnidadesLabel,
  eduIaUsdInputValue,
  eduIaUsdLabel,
  eduIaValidarCupo,
  parseEduIaUsdCents,
  type EduIaCupo,
} from "../ia-core";
import {
  EDU_ALL_PERMISSION_KEYS,
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  getEduEffectivePermissions,
  hasEduPermission,
} from "../permissions";
import { eduAiUsageScopeWhere, eduVisibility } from "../visibility";
import { EDU_NAV_ITEMS, EDU_NAV_LABELS, EDU_UPCOMING_AREAS } from "../types";

const USD = 100; // centavos en un dólar, para que los números se lean

function cupo(over: Partial<EduIaCupo> = {}): EduIaCupo {
  return {
    periodo: "2026-08",
    periodoLabel: "agosto de 2026",
    incluidoUsdCents: 50 * USD,
    permiteExcedente: false,
    topeUsdCents: null,
    encendido: true,
    contacto: null,
    consumidoUsdMicros: 0,
    actualizadoPor: null,
    actualizadoLabel: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 1 · La aritmética del cupo
// ─────────────────────────────────────────────────────────────────────

test("sin excedente permitido, el techo del mes es lo que incluye el contrato", () => {
  const c = cupo();
  assert.equal(eduIaTechoUsdMicros(c), 50_000_000);
  assert.equal(eduIaIncluidoUsdMicros(c), 50_000_000);
  assert.equal(eduIaRestanteUsdMicros(c), 50_000_000);
  assert.equal(eduIaCupoAgotado(c), false);
});

test("el TOPE no se aplica si la escuela no autorizó el excedente", () => {
  // Un tope guardado con la casilla apagada es historia: si se aplicara,
  // desmarcar "permitir gastar de más" no apagaría nada.
  const c = cupo({ permiteExcedente: false, topeUsdCents: 200 * USD });
  assert.equal(eduIaTechoUsdMicros(c), 50_000_000);
});

test("con excedente autorizado, el techo es el TOPE (que es el total del mes)", () => {
  const c = cupo({ permiteExcedente: true, topeUsdCents: 120 * USD });
  assert.equal(eduIaTechoUsdMicros(c), 120_000_000);
  assert.equal(eduIaIncluidoUsdMicros(c), 50_000_000, "lo incluido no cambia");
});

test("🔴 un tope POR DEBAJO de lo incluido no reduce el cupo (cinturón)", () => {
  // El servidor ya rechaza guardarlo así. Esto cubre una fila escrita por
  // SQL: si el techo bajara, marcar "permitir gastar de más" quitaría
  // cupo, que es lo contrario de lo que dice la casilla.
  const c = cupo({ permiteExcedente: true, topeUsdCents: 10 * USD });
  assert.equal(eduIaTechoUsdMicros(c), 50_000_000);
});

test("lo que queda nunca es negativo, aunque la última llamada haya rebasado", () => {
  // Es un caso REAL y esperado: el cupo frena las llamadas que EMPIEZAN,
  // no aborta una en vuelo, así que la última del mes puede pasarse por lo
  // que cueste esa llamada.
  const c = cupo({ consumidoUsdMicros: 50_400_000 });
  assert.equal(eduIaRestanteUsdMicros(c), 0);
  assert.equal(eduIaCupoAgotado(c), true);
});

test("un consumo basura se trata como cero, no revienta la resta", () => {
  const c = cupo({ consumidoUsdMicros: NaN as unknown as number });
  assert.equal(eduIaRestanteUsdMicros(c), 50_000_000);
});

test("un cupo de CERO está agotado desde el primer día", () => {
  const c = cupo({ incluidoUsdCents: 0 });
  assert.equal(eduIaCupoAgotado(c), true);
  // Y la barra se pinta llena, no vacía: un cupo de cero no es "vas por el
  // 0 %", es un micrófono que no funciona.
  assert.equal(eduIaPorcentajeUsado(c), 100);
});

test("la barra va de 0 a 100 y se acota, nunca pinta 140 %", () => {
  assert.equal(eduIaPorcentajeUsado(cupo()), 0);
  assert.equal(eduIaPorcentajeUsado(cupo({ consumidoUsdMicros: 25_000_000 })), 50);
  assert.equal(eduIaPorcentajeUsado(cupo({ consumidoUsdMicros: 70_000_000 })), 100);
});

test("la MARCA de lo incluido solo existe cuando hay excedente que marcar", () => {
  // Sin excedente, techo == incluido y una marca al 100 % sería una raya
  // pegada al borde que no dice nada.
  assert.equal(eduIaMarcaIncluido(cupo()), null);
  const c = cupo({ permiteExcedente: true, topeUsdCents: 100 * USD });
  assert.equal(eduIaMarcaIncluido(c), 50, "50 de 100 USD");
});

test("'en excedente' es haber pasado lo INCLUIDO, no el techo", () => {
  const c = cupo({ permiteExcedente: true, topeUsdCents: 120 * USD });
  assert.equal(eduIaEnExcedente({ ...c, consumidoUsdMicros: 40_000_000 }), false);
  assert.equal(eduIaEnExcedente({ ...c, consumidoUsdMicros: 60_000_000 }), true);
});

test("eduIaParte no divide entre cero", () => {
  assert.equal(eduIaParte(10, 0), 0);
  assert.equal(eduIaParte(25, 100), 25);
  assert.equal(eduIaParte(200, 100), 100, "se acota");
});

// ─────────────────────────────────────────────────────────────────────
// 2 · 🔴 LAS DOS REGLAS DEL EXCEDENTE
// ─────────────────────────────────────────────────────────────────────

test("sin excedente, no hace falta tope y el cambio vale", () => {
  assert.equal(
    eduIaValidarCupo({ incluidoUsdCents: 50 * USD, permiteExcedente: false, topeUsdCents: null }),
    null,
  );
});

test("🔴 permitir gastar de más SIN TOPE se rechaza, y el mensaje dice por qué", () => {
  // Es la fuga que la Ola 3B se negó a abrir: 120 alumnos con el micrófono
  // abierto y una factura que nadie puede contestar.
  const mal = eduIaValidarCupo({
    incluidoUsdCents: 50 * USD,
    permiteExcedente: true,
    topeUsdCents: null,
  });
  assert.ok(mal, "debería rechazarse");
  assert.ok(mal.includes("TOPE"), mal);
  assert.ok(mal.length > 80, "el motivo tiene que estar escrito para una persona");
});

test("🔴 un tope MENOR O IGUAL a lo incluido se rechaza", () => {
  // Permitir excederse hasta menos de lo incluido no permite nada:
  // reduciría el cupo, que es lo contrario de lo que dice la casilla.
  for (const tope of [10 * USD, 50 * USD]) {
    const mal = eduIaValidarCupo({
      incluidoUsdCents: 50 * USD,
      permiteExcedente: true,
      topeUsdCents: tope,
    });
    assert.ok(mal, `tope ${tope} debería rechazarse`);
    assert.ok(mal.includes("MAYOR"), mal);
    // Y dice CUÁNTO incluye el contrato, para que se pueda corregir sin
    // salir del formulario a buscar el número.
    assert.ok(mal.includes("50.00 USD"), mal);
  }
});

test("un tope por encima de lo incluido se acepta", () => {
  assert.equal(
    eduIaValidarCupo({
      incluidoUsdCents: 50 * USD,
      permiteExcedente: true,
      topeUsdCents: 51 * USD,
    }),
    null,
  );
});

test("un cambio basura se rechaza en vez de pasar de largo", () => {
  assert.ok(eduIaValidarCupo(null as never));
});

// ─────────────────────────────────────────────────────────────────────
// 3 · 🔴 QUIÉN EDITA QUÉ
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_8 = ["ia.view", "ia.manage"] as const;

test("las dos keys de la Ola 8 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_8) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k}`);
    const d = EDU_ALL_PERMISSIONS[k];
    assert.ok(d.length > 15, `${k} sin descripción legible`);
    assert.notEqual(d, k);
  }
});

test("las dos viven en su PROPIO grupo, y cada una en uno solo", () => {
  for (const k of KEYS_OLA_8) {
    const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k));
    assert.equal(grupos.length, 1, `${k} está en ${grupos.length} grupos`);
  }
  const grupo = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("ia.view"))[0];
  // NO va con el expediente, donde vive estudios.analyze: una casilla que
  // deja PEDIR una lectura no se parece a una que deja decidir cuánto
  // dinero se gasta en todas las lecturas del instituto.
  assert.equal(grupo.keys.includes("estudios.analyze"), false);
  assert.deepEqual(grupo.keys, ["ia.view", "ia.manage"]);
});

test("🔴 las dos son SOLO de DIRECCION", () => {
  for (const k of KEYS_OLA_8) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `DIRECCION sin ${k}`);
    for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as const) {
      assert.equal(hasEduPermission({ role: rol }, k), false, `${rol} NO debería tener ${k}`);
    }
  }
});

test("⚠️ CAJA ve dinero y aun así NO ve el cupo de IA", () => {
  // Es la que parece discutible y no lo es: el dinero de caja es el que la
  // escuela COBRA a sus pacientes; el cupo de IA es un renglón del
  // contrato con DaleControl, que no entra al corte ni se cobra en el
  // mostrador.
  assert.equal(hasEduPermission({ role: "CAJA" }, "caja.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "ia.view"), false);
});

test("🔴 NINGUNA key del catálogo abre el cupo que incluye el CONTRATO", () => {
  // Es la línea de la ola. Si un día apareciera una key con "monthly" o
  // "contrato" en el nombre, esta prueba obliga a pararse a pensar: ese
  // número lo escribe DaleControl con el contrato, no un formulario, y la
  // cuenta de API que se consume no es la de la escuela.
  const sospechosas = EDU_ALL_PERMISSION_KEYS.filter((k) =>
    /monthly|mensual|contrato|cupo\.set|incluido/i.test(k),
  );
  assert.deepEqual(sospechosas, []);
  // Y "ia.manage" se describe por lo que SÍ hace, no como "editar el cupo"
  // a secas — que se leería como "puedo ponerme el cupo que quiera".
  assert.ok(/apagar|excedente|gastar/i.test(EDU_ALL_PERMISSIONS["ia.manage"]));
});

test("un permiso nuevo NO le llega solo a quien ya tiene override", () => {
  // Por eso el .sql de cada ola trae su backfill. Una dirección con
  // override guardado entra al panel, no ve "Consumo de IA" en el menú, y
  // desde fuera parece que la ola no se aplicó.
  const conOverride = { role: "DIRECCION" as const, permissionsOverride: ["inicio.view"] };
  assert.equal(hasEduPermission(conOverride, "ia.view"), false);
  assert.deepEqual(getEduEffectivePermissions(conOverride), ["inicio.view"]);
  // Y con el override vacío sí cae al default, que ya las trae.
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "ia.view"), true);
});

test("los defaults de la Ola 8 son EXACTAMENTE los del contrato", () => {
  for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as const) {
    const suyas = EDU_ROLE_DEFAULTS[rol].filter((k) => (KEYS_OLA_8 as readonly string[]).includes(k));
    assert.deepEqual(suyas, [], `${rol} no debería traer ninguna key de IA`);
  }
  const direccion = EDU_ROLE_DEFAULTS.DIRECCION.filter((k) =>
    (KEYS_OLA_8 as readonly string[]).includes(k),
  );
  assert.deepEqual(direccion.sort(), ["ia.manage", "ia.view"]);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · 🔴 EL ALCANCE DEL GASTO ES EL DEL DINERO
// ─────────────────────────────────────────────────────────────────────

const INST = "inst_1";

test("🔴 la Ola 8 NO agregó un recurso nuevo: el gasto de IA se lee con 'charges'", () => {
  // Un recurso nuevo que dijera lo mismo solo daría un segundo sitio donde
  // equivocarse. Y "charges" tiene la propiedad que hace falta: es una
  // lista BLANCA que se resuelve antes del switch de roles.
  assert.equal(eduVisibility({ role: "DIRECCION", eduUserId: "u" }, "charges").kind, "all");
  assert.equal(eduVisibility({ role: "CAJA", eduUserId: "u" }, "charges").kind, "all");
  assert.equal(eduVisibility({ role: "DOCENTE", eduUserId: "u" }, "charges").kind, "none");
  assert.equal(eduVisibility({ role: "ALUMNO", eduUserId: "u" }, "charges").kind, "none");
});

test("🔴 SEGUNDO CANDADO: con ia.view encendida por override, un alumno sigue sin ver un dólar", () => {
  // El permiso abre la pantalla; el alcance decide las filas. Este es el
  // que no se puede abrir desde la pantalla de permisos.
  const alumno = { role: "ALUMNO" as const, eduUserId: "u_alumno" };
  assert.equal(
    hasEduPermission({ role: "ALUMNO", permissionsOverride: ["inicio.view", "ia.view"] }, "ia.view"),
    true,
    "el override sí puede encender la casilla",
  );
  const where = eduAiUsageScopeWhere({
    institutionId: INST,
    scope: eduVisibility(alumno, "charges"),
  });
  assert.deepEqual(where, { institutionId: INST, id: { in: [] } });
});

test("para DIRECCION el where trae el instituto entero, y SIEMPRE con el tenant", () => {
  const where = eduAiUsageScopeWhere({
    institutionId: INST,
    scope: eduVisibility({ role: "DIRECCION", eduUserId: "u" }, "charges"),
  });
  assert.deepEqual(where, { institutionId: INST });
});

test("🔴 sin institutionId, el where LANZA (un undefined borraría el filtro de tenant)", () => {
  assert.throws(
    () =>
      eduAiUsageScopeWhere({
        institutionId: "" as unknown as string,
        scope: { kind: "all" },
      }),
    /institutionId/,
  );
});

test("un alcance raro cierra la consulta en vez de abrirla", () => {
  for (const scope of [
    { kind: "own", studentUserId: "u" } as const,
    { kind: "supervised", supervisorUserId: "d" } as const,
    { kind: "none" } as const,
  ]) {
    assert.deepEqual(eduAiUsageScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 5 · El periodo — a qué mes se carga un gasto
// ─────────────────────────────────────────────────────────────────────

test("🔴 el mes se decide en la zona del INSTITUTO, no en UTC", () => {
  // 31 de agosto, 23:30 en Tijuana (UTC-7) son las 06:30 del 1 de
  // septiembre en UTC. Cargarlo a septiembre le comería a la escuela cupo
  // del mes que no era, y el día 1 se vería como un salto inexplicable.
  const instante = new Date("2026-09-01T06:30:00.000Z");
  assert.equal(eduIaPeriodKey(instante, "America/Tijuana"), "2026-08");
  assert.equal(eduIaPeriodKey(instante, "UTC"), "2026-09");
});

test("una zona inválida no revienta: cae a la del producto", () => {
  const instante = new Date("2026-08-15T12:00:00.000Z");
  assert.equal(eduIaPeriodKey(instante, "No/Existe"), "2026-08");
});

test("el periodo se pinta en español, y lo que no es un periodo no sale como NaN", () => {
  assert.equal(eduIaPeriodoLabel("2026-08"), "agosto de 2026");
  assert.equal(eduIaPeriodoLabel(""), "—");
  assert.equal(eduIaPeriodoLabel("no-es-un-mes"), "no-es-un-mes");
  assert.equal(eduIaPeriodoLabel("2026-13"), "2026-13", "un mes 13 se devuelve crudo");
});

// ─────────────────────────────────────────────────────────────────────
// 6 · El dinero: dos unidades, una conversión
// ─────────────────────────────────────────────────────────────────────

test("centavos → millonésimas, en UN solo sitio", () => {
  assert.equal(EDU_IA_MICROS_POR_CENTAVO, 10_000);
  assert.equal(eduIaCentsToMicros(5_000), 50_000_000);
  assert.equal(eduIaCentsToMicros(0), 0);
  assert.equal(eduIaCentsToMicros(null), 0);
  assert.equal(eduIaCentsToMicros(-5), 0, "no existe un cupo negativo");
});

test("🔴 el presupuesto va en CENTAVOS para no toparse en 2 147 USD", () => {
  // Un INTEGER de millonésimas se topa en 2 147,48 USD al mes, que es un
  // techo puesto por un tipo de dato y no por nadie. En centavos, el mismo
  // INTEGER llega a 21 millones.
  assert.ok(EDU_IA_MAX_TOPE_USD_CENTS <= 2_147_483_647);
  assert.ok(EDU_IA_MAX_TOPE_USD_CENTS > 2_147 * 100, "el tope no puede ser el del tipo de dato");
});

test("las cantidades se pintan con dos decimales y separador de miles", () => {
  assert.equal(eduIaUsdLabel(50_000_000), "50.00 USD");
  assert.equal(eduIaUsdLabel(1_234_560_000), "1,234.56 USD");
  assert.equal(eduIaUsdLabel(0), "0.00 USD");
  assert.equal(eduIaUsdLabel(null), "—", "un hueco honesto, no 'NaN USD'");
});

test("lo que teclea una persona se lee en centavos, sin coma flotante", () => {
  assert.equal(parseEduIaUsdCents("120"), 12_000);
  assert.equal(parseEduIaUsdCents("120.50"), 12_050);
  assert.equal(parseEduIaUsdCents("$1,234.5"), 123_450);
  // Tres decimales se rechazan en vez de redondearse: si alguien teclea
  // 99.999 hay que preguntarle, no decidir por él.
  assert.equal(parseEduIaUsdCents("99.999"), null);
  assert.equal(parseEduIaUsdCents("-10"), null, "no existe un tope negativo");
  assert.equal(parseEduIaUsdCents("abc"), null);
  assert.equal(parseEduIaUsdCents(""), null);
});

test("el valor del input vuelve sin comas (si no, no se puede releer)", () => {
  assert.equal(eduIaUsdInputValue(12_050), "120.50");
  assert.equal(eduIaUsdInputValue(null), "");
});

test("la TARIFA se pinta tal como la publica el proveedor", () => {
  assert.equal(eduIaPrecioLabel(5_000_000, "TOKEN"), "5.00 USD por millón de tokens");
  assert.equal(
    eduIaPrecioLabel(100_000_000, "SECOND"),
    "100.00 USD por millón de segundos de audio",
  );
  assert.equal(eduIaPrecioLabel(0, "TOKEN"), "—", "una tarifa en cero no es una tarifa");
});

test("las unidades se pintan en lo que una persona entiende", () => {
  assert.equal(eduIaUnidadesLabel(12_430, "TOKEN"), "12,430 tokens");
  assert.equal(eduIaUnidadesLabel(45, "SECOND"), "45 s de audio");
  assert.equal(eduIaUnidadesLabel(600, "SECOND"), "10 min de audio");
  assert.equal(eduIaUnidadesLabel(4_320, "SECOND"), "1 h 12 min de audio");
  assert.equal(eduIaUnidadesLabel(0, "TOKEN"), "0 tokens");
});

// ─────────────────────────────────────────────────────────────────────
// 6b · 🔴 LA TARIFA SE BUSCA POR MODELO EXACTO, NO POR FUNCIÓN
// ─────────────────────────────────────────────────────────────────────

test("cada función declara QUÉ modelo llama y en qué se mide", () => {
  // Es la clave con la que se busca la tarifa, y tiene que coincidir con
  // lo que de verdad se le manda al proveedor.
  assert.equal(EDU_IA_MODELOS.DICTADO.model, "whisper-1");
  assert.equal(EDU_IA_MODELOS.DICTADO.unit, "SECOND");
  assert.equal(EDU_IA_MODELOS.ANALISIS.model, "claude-opus-5");
  assert.equal(EDU_IA_MODELOS.ANALISIS.unit, "TOKEN");
});

test("🔴 el modelo que se declara es el que se le manda al proveedor", () => {
  // Si alguien cambia EDU_ANALISIS_MODEL en ia.ts y no toca el mapa, esta
  // prueba lo caza ANTES de que el análisis empiece a cobrarse con la
  // tarifa de otro modelo. Se lee el archivo en vez de importarlo porque
  // ia.ts es servidor (importa prisma) y esta prueba corre sin base.
  const fuente = readFileSync(join(__dirname, "..", "ia.ts"), "utf8");
  assert.ok(
    /const EDU_ANALISIS_MODEL = EDU_IA_MODELOS\.ANALISIS\.model;/.test(fuente),
    "EDU_ANALISIS_MODEL dejó de salir del mapa: la tarifa se buscaría por un modelo y se llamaría a otro",
  );
  assert.ok(
    /const EDU_DICTADO_MODEL = EDU_IA_MODELOS\.DICTADO\.model;/.test(fuente),
    "EDU_DICTADO_MODEL dejó de salir del mapa",
  );
  // Y el envoltorio de Whisper sigue mandando el modelo que declaramos.
  const whisper = readFileSync(
    join(__dirname, "..", "..", "integrations", "whisper.ts"),
    "utf8",
  );
  assert.ok(
    whisper.includes(`"${EDU_IA_MODELOS.DICTADO.model}"`),
    `whisper.ts ya no manda ${EDU_IA_MODELOS.DICTADO.model}: la tarifa del dictado dejaría de corresponder`,
  );
});

test("🔴 el SQL da de alta las DOS tarifas, con la clave exacta", () => {
  // Sin fila de tarifa, la función se apaga. Si el .sql se quedara sin uno
  // de los dos INSERT, la ola se entregaría con media IA muerta y el
  // motivo sería "falta configurar la tarifa" — correcto, pero evitable.
  const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "sql", "edu-ola-8.sql"), "utf8");
  for (const f of ["DICTADO", "ANALISIS"] as const) {
    const m = EDU_IA_MODELOS[f];
    assert.ok(
      sql.includes(`'${f}', '${m.model}', '${m.unit}'`),
      `sql/edu-ola-8.sql no da de alta la tarifa de ${f} (${m.model}, ${m.unit})`,
    );
  }
  // Y NO se queda comentado: sin tarifa no hay función, así que forma
  // parte de la migración igual que las tablas.
  assert.ok(/^INSERT INTO "edu_ai_prices"/m.test(sql), "el INSERT de tarifas está comentado");
  // El cupo del instituto SÍ va comentado: ese número sale del contrato de
  // cada escuela y no hay un valor por defecto honesto.
  assert.equal(
    /^INSERT INTO "edu_ai_quotas"/m.test(sql),
    false,
    "el cupo inicial NO puede ejecutarse: es dato de UNA escuela",
  );
});

// ─────────────────────────────────────────────────────────────────────
// 7 · La pantalla
// ─────────────────────────────────────────────────────────────────────

test("/instituto/ia está en el menú, con su permiso y su etiqueta", () => {
  const item = EDU_NAV_ITEMS.filter((i) => i.href === "/instituto/ia")[0];
  assert.ok(item, "falta el item de menú");
  assert.equal(item.permission, "ia.view");
  assert.equal(item.section, "administracion");
  assert.ok(EDU_NAV_LABELS[item.key], "el item sin etiqueta pinta la key cruda en el sidebar");
  assert.equal(EDU_NAV_LABELS[item.key], "Consumo de IA");
});

test("⚠️ el icono del item nuevo tiene que estar en el mapa del sidebar", () => {
  // Un icono que no esté en el mapa de edu-shell.tsx cae al genérico EN
  // SILENCIO, y el item se ve como una casita más.
  const item = EDU_NAV_ITEMS.filter((i) => i.href === "/instituto/ia")[0];
  assert.equal(item.icon, "sparkles");
});

test("la IA no se anuncia como 'próximamente': ya está", () => {
  const anunciada = EDU_UPCOMING_AREAS.filter((a) => /ia|inteligencia/i.test(a.key));
  assert.deepEqual(anunciada, []);
});

test("nada de lo que se lee dice 'Ola'", () => {
  // El producto no habla de sus olas de desarrollo. Se revisan los textos
  // que de verdad se pintan: las descripciones de permiso y las etiquetas
  // del menú.
  for (const k of KEYS_OLA_8) {
    assert.equal(/\bola\b/i.test(EDU_ALL_PERMISSIONS[k]), false, `${k} dice "ola"`);
  }
  for (const label of Object.values(EDU_NAV_LABELS)) {
    assert.equal(/\bola\b/i.test(label), false, `"${label}" dice "ola"`);
  }
  const grupo = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("ia.view"))[0];
  assert.equal(/\bola\b/i.test(grupo.title), false);
});
