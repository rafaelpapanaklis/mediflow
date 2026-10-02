/**
 * ws1-t8 — decisión 13 de Rafael (2-oct): firmar un control en un caso «Por colocar» (sin aparatología registrada)
 * avisa con dos botones —«Registrar la colocación primero» / «Firmar el control de todos modos»— y NO bloquea.
 * Antes «Firmar control» firmaba sin decir nada (el caso seguía «Por colocar» con controles firmados y los meses
 * sin contar).
 *
 * La regla es pura (caso-por-colocar.ts). El cajón (DrawerTreatmentCard.tsx) arrastra un `.module.css` que Node
 * no lee, así que lo demás son guardas de código fuente: el cajón pregunta con esa regla, los dos botones dicen
 * lo decidido, el servidor sigue firmando igual, y las dos pantallas que abren la hoja (ficha y Agenda) le pasan
 * el estado del caso y qué hacer al elegir registrar la colocación.
 * Run: npm run test:orto-por-colocar
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esCasoPorColocar, pasoAlFirmar } from "../caso-por-colocar";
import { textosFirmaControl } from "@/components/specialties/orthodontics/redesign/textos-firma-control";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("la regla", () => {
  it("«Por colocar» es el caso PLANNED; en curso, pausado, retención… no", () => {
    assert.equal(esCasoPorColocar("PLANNED"), true);
    for (const otro of ["IN_PROGRESS", "ON_HOLD", "RETENTION", "COMPLETED", "DROPPED_OUT", null, undefined, ""]) {
      assert.equal(esCasoPorColocar(otro), false, String(otro));
    }
  });

  it("«Firmar control» pregunta en un caso «Por colocar» y firma directo en los demás", () => {
    assert.equal(pasoAlFirmar({ casoPorColocar: true, firmarIgualAceptado: false }), "preguntar");
    assert.equal(pasoAlFirmar({ casoPorColocar: false, firmarIgualAceptado: false }), "firmar");
    assert.equal(pasoAlFirmar({ casoPorColocar: undefined, firmarIgualAceptado: false }), "firmar");
  });

  it("no bloquea: tras «Firmar el control de todos modos» firma", () => {
    assert.equal(pasoAlFirmar({ casoPorColocar: true, firmarIgualAceptado: true }), "firmar");
  });
});

describe("los textos son los decididos", () => {
  it("los dos botones", () => {
    const t = textosFirmaControl("es");
    assert.equal(t.porColocarRegistrar, "Registrar la colocación primero");
    assert.equal(t.porColocarFirmarIgual, "Firmar el control de todos modos");
    assert.match(t.porColocarTitulo, /Por colocar/);
  });
});

describe("el cajón de la hoja", () => {
  const src = leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx");

  it("«Firmar control» pasa por la regla antes de firmar y abre el aviso", () => {
    assert.match(src, /pasoAlFirmar\(\{ casoPorColocar: props\.casoPorColocar, firmarIgualAceptado \}\) === "preguntar"/);
    assert.match(src, /setPreguntaPorColocar\(true\)/);
  });

  it("el aviso es un alertdialog con los dos botones", () => {
    assert.match(src, /role="alertdialog"/);
    assert.match(src, /textosFirma\.porColocarRegistrar/);
    assert.match(src, /textosFirma\.porColocarFirmarIgual/);
  });

  it("«Firmar el control de todos modos» firma (no bloquea)", () => {
    assert.match(src, /setFirmarIgualAceptado\(true\);\s*setPreguntaPorColocar\(false\);\s*void firmar\(\);/);
  });

  it("«Registrar la colocación primero» guarda la hoja como borrador y solo sigue si se guardó", () => {
    const i = src.indexOf("const registrarColocacionPrimero");
    assert.ok(i > 0);
    const cuerpo = src.slice(i, src.indexOf("};", i));
    assert.match(cuerpo, /await props\.onSave\(buildSubmit\(\)\)/);
    assert.match(cuerpo, /if \(!id\) return;/);
    assert.ok(cuerpo.indexOf("props.onSave(") < cuerpo.indexOf("props.onRegistrarColocacion()"));
  });
});

describe("el servidor no bloquea la firma por el estado del caso", () => {
  it("signTreatmentCard no mira PLANNED", () => {
    assert.doesNotMatch(leer("src/app/actions/orthodontics/signTreatmentCard.ts"), /PLANNED|casoPorColocar/);
  });
});

describe("las pantallas que abren la hoja le dicen si el caso está «Por colocar»", () => {
  it("el contexto de la hoja lo trae (ficha y Agenda leen el estado del caso)", () => {
    const ctx = leer("src/lib/orthodontics/treatment-card-context.ts");
    assert.match(ctx, /casoPorColocar: esCasoPorColocar\(plan\.status\)/);
    for (const accion of ["getTreatmentCardContextForPatient", "getTreatmentCardContextForAppointment"]) {
      const a = leer(`src/app/actions/orthodontics/${accion}.ts`);
      assert.match(a, /installedAt: true,\s*status: true,/, accion);
    }
  });

  it("la ficha lo pasa a sus cuatro cajones y «Registrar la colocación primero» abre «Datos del caso»", () => {
    const ficha = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
    const cajones = ficha.split("<DrawerTreatmentCard").length - 1;
    assert.equal(cajones, 4);
    assert.equal(ficha.split("onRegistrarColocacion={registrarColocacion}").length - 1, cajones);
    assert.equal(ficha.split("casoPorColocar={t.casoPorColocar === true || nuevoControlCtx?.casoPorColocar === true}").length - 1, cajones);
    assert.match(ficha, /const registrarColocacion = props\.onUpdateCaseSettings\s*\?\s*\(\) => \{\s*setDrawer\(\{ kind: "case-settings" \}\)/);
  });

  it("la vista del caso marca «Por colocar»", () => {
    assert.match(leer("src/lib/orthodontics/redesign/adapter.ts"), /esCasoPorColocar\(String\(plan\.status\)\) \? \{ casoPorColocar: true \}/);
  });

  it("la Agenda también: guarda el borrador y lleva a la ficha de Ortodoncia", () => {
    const agenda = leer("src/components/specialties/orthodontics/agenda/BotonHojaControl.tsx");
    assert.match(agenda, /casoPorColocar=\{ctx\.casoPorColocar\}/);
    assert.match(agenda, /onRegistrarColocacion=\{\(\) => \{/);
    assert.match(agenda, /\?tab=ortodoncia/);
    // El borrador guardado devuelve su id: sin él el cajón no sabría que se guardó.
    assert.match(agenda, /if \(!firmar\) \{\s*cerrar\(\);[\s\S]{0,200}return res\.data\.cardId;/);
  });
});
