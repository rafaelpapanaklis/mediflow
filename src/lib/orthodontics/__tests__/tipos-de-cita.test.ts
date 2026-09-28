/**
 * Tipos de cita de Ortodoncia — la fila fija se reconoce por su CLAVE (ws1-t3).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/tipos-de-cita.test.ts
 *
 * El fallo: la fila fija («Control de ortodoncia») se reconocía por su texto.
 * Tecleando ese texto en un tipo NUEVO, la fila nueva se bloqueaba a media
 * escritura y quedaba un duplicado que, al guardar, se guardaba.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIPO_CITA_CONTROL_ORTO, esCitaControlOrto } from "../agenda-constants";
import {
  ID_TIPO_CITA_CONTROL,
  esTipoFijo,
  motivoDeRechazo,
  nombreComparable,
  normalizarCatalogo,
  nuevaClave,
} from "../tipos-de-cita";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FIJA = { id: "control", label: TIPO_CITA_CONTROL_ORTO };
const DE_FABRICA = [
  { id: "valoracion", label: "Valoración de ortodoncia" },
  { id: "colocacion", label: "Colocación de aparatología" },
  FIJA,
  { id: "retiro", label: "Retiro de aparatología" },
];

test("la fila fija es la de clave «control», diga lo que diga su texto", () => {
  assert.equal(ID_TIPO_CITA_CONTROL, "control");
  assert.equal(esTipoFijo(FIJA), true);
  assert.equal(esTipoFijo({ id: "control" }), true);
  // EL FALLO: un tipo nuevo con el texto de la fija NO es la fija.
  assert.equal(esTipoFijo({ id: "tipo-8" }), false);
  for (const t of DE_FABRICA.filter((x) => x.id !== "control")) assert.equal(esTipoFijo(t), false, t.id);
});

test("teclear «Control de ortodoncia» en un tipo nuevo: no se bloquea, y no se puede guardar duplicado", () => {
  const tecleando = [...DE_FABRICA, { id: "tipo-5", label: TIPO_CITA_CONTROL_ORTO }];
  assert.equal(esTipoFijo(tecleando[4]), false, "la fila nueva sigue siendo editable y se puede quitar");
  assert.match(motivoDeRechazo(tecleando) ?? "", /ya existe y es fijo/);
  // Tampoco con otras mayúsculas, espacios o sin acentos.
  for (const label of ["control de ortodoncia", "  Control  de   Ortodoncia ", "CONTROL DE ORTODONCIA"]) {
    assert.match(motivoDeRechazo([...DE_FABRICA, { id: "tipo-5", label }]) ?? "", /ya existe y es fijo/, label);
  }
  // A media escritura («Control de ortodonci») todavía no choca con nada.
  assert.equal(motivoDeRechazo([...DE_FABRICA, { id: "tipo-5", label: "Control de ortodonci" }]), null);
});

test("un catálogo normal se guarda; los que no, dicen por qué", () => {
  assert.equal(motivoDeRechazo(DE_FABRICA), null);
  assert.equal(motivoDeRechazo([...DE_FABRICA, { id: "tipo-5", label: "Control de elásticos" }]), null);
  assert.match(motivoDeRechazo([]) ?? "", /al menos un tipo/);
  assert.match(motivoDeRechazo([...DE_FABRICA, { id: "tipo-5", label: "   " }]) ?? "", /clave y nombre/);
  assert.match(motivoDeRechazo([...DE_FABRICA, { id: " ", label: "Algo" }]) ?? "", /clave y nombre/);
  assert.match(
    motivoDeRechazo([...DE_FABRICA, { id: "tipo-5", label: "valoracion de ortodoncia" }]) ?? "",
    /dos tipos de cita que se llaman/,
  );
  assert.match(motivoDeRechazo([...DE_FABRICA, { id: "retiro", label: "Otro" }]) ?? "", /misma clave/);
});

test("la fila fija no se puede perder ni cambiar de texto", () => {
  const sinFija = DE_FABRICA.filter((t) => t.id !== "control");
  assert.match(motivoDeRechazo(sinFija) ?? "", /tiene que conservar/);
  // Con el texto correcto pero OTRA clave no vale: la fija es la de la clave.
  assert.match(motivoDeRechazo([...sinFija, { id: "tipo-9", label: TIPO_CITA_CONTROL_ORTO }]) ?? "", /tiene que conservar/);
  // Con la clave pero otro texto tampoco: la Agenda compara ese texto exacto.
  assert.match(motivoDeRechazo([...sinFija, { id: "control", label: "Control mensual" }]) ?? "", /tiene que conservar/);
  assert.match(motivoDeRechazo([...sinFija, { id: "control", label: "control de ortodoncia" }]) ?? "", /tiene que conservar/);
  assert.equal(esCitaControlOrto(FIJA.label), true, "el texto de la fija es el que reconoce la Agenda");
});

test("al cargar, el catálogo sale con UNA fila fija, en su sitio, y sin el duplicado del fallo", () => {
  assert.deepEqual(normalizarCatalogo(DE_FABRICA), DE_FABRICA, "uno sano no cambia");
  // El duplicado que dejaba el fallo se va; la fija se queda donde estaba.
  assert.deepEqual(normalizarCatalogo([...DE_FABRICA, { id: "tipo-5", label: "control de ortodoncia" }]), DE_FABRICA);
  // La fija con el texto estropeado lo recupera.
  assert.deepEqual(
    normalizarCatalogo([{ id: "control", label: "Control" }, { id: "retiro", label: "Retiro de aparatología" }]),
    [FIJA, { id: "retiro", label: "Retiro de aparatología" }],
  );
  // Un catálogo viejo con el texto pero otra clave: esa fila pasa a ser la fija.
  assert.deepEqual(
    normalizarCatalogo([{ id: "a", label: "Valoración" }, { id: "tipo-4", label: TIPO_CITA_CONTROL_ORTO }, { id: "b", label: "Retiro" }]),
    [{ id: "a", label: "Valoración" }, FIJA, { id: "b", label: "Retiro" }],
  );
  // Sin ninguna: se añade.
  assert.deepEqual(normalizarCatalogo([{ id: "a", label: "Valoración" }]), [{ id: "a", label: "Valoración" }, FIJA]);
  assert.deepEqual(normalizarCatalogo([]), [FIJA]);
  // Lo que sale de normalizar siempre se puede guardar (si los nombres no están vacíos).
  for (const c of [DE_FABRICA, [...DE_FABRICA, { id: "tipo-5", label: TIPO_CITA_CONTROL_ORTO }], []]) {
    assert.equal(motivoDeRechazo(normalizarCatalogo(c)), null);
  }
  // No muta lo que recibe.
  const original = [{ id: "control", label: "Control" }];
  normalizarCatalogo(original);
  assert.deepEqual(original, [{ id: "control", label: "Control" }]);
});

test("una clave nueva nunca es la de la fila fija ni repite una que ya existe", () => {
  assert.equal(nuevaClave(DE_FABRICA), "tipo-5");
  assert.equal(nuevaClave([...DE_FABRICA, { id: "tipo-5" }]), "tipo-6");
  assert.equal(nuevaClave([]), "tipo-1");
  assert.notEqual(nuevaClave([{ id: "control" }]), "control");
  assert.equal(nombreComparable("  Contról   DE ortodoncia "), "control de ortodoncia");
});

test("la pantalla, el servidor y el cargador usan la clave, no el texto", () => {
  const pantalla = sinComentarios(leer("src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx"));
  assert.match(pantalla, /const esControl = esTipoFijo\(tipo\);/);
  assert.match(pantalla, /if \(tipo && esTipoFijo\(tipo\)\) \{/, "quitar");
  assert.match(pantalla, /const rechazo = motivoDeRechazo\(appointmentTypes\);/, "guardar");
  assert.match(pantalla, /id: nuevaClave\(arr\)/);
  assert.ok(!/tipo\??\.label === TIPO_CITA_CONTROL_ORTO/.test(pantalla), "ya no se reconoce por el texto");

  const servidor = sinComentarios(leer("src/app/actions/orthodontics/updateOrthoClinicSettings.ts"));
  assert.match(servidor, /const rechazo = motivoDeRechazo\(appointmentTypes\);\s*if \(rechazo\) return fail\(rechazo\);/);
  assert.ok(servidor.indexOf("motivoDeRechazo(") < servidor.indexOf("guardarOrthoClinicSettings("), "se valida ANTES de guardar");
  assert.ok(!/t\.label === TIPO_CITA_CONTROL_ORTO/.test(servidor));

  const cargador = sinComentarios(leer("src/lib/orthodontics/clinic-settings-db.ts"));
  assert.match(cargador, /\? normalizarCatalogo\(row\.appointmentTypes\)/);
  assert.match(cargador, /\{ id: ID_TIPO_CITA_CONTROL, label: TIPO_CITA_CONTROL_ORTO \},/);
});
