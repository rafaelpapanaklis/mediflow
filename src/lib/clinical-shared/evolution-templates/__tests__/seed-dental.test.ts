// Clinical-shared — plantillas de nota de odontología general (WS1-T2).
//
// Run: npm run test:nota-plantillas-cita
//
// Lo que esta prueba no deja deshacer:
//   · una plantilla dental rellena los CUATRO campos de la nota
//   · y NO pisa lo que el doctor ya había escrito
//   · las plantillas llevan huecos [entre corchetes] y ningún dato clínico falso
//   · con DOS citas el mismo día no se elige ninguna
//   · la ficha dental sigue montando el selector y mandando la cita

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DENTAL_DEFAULT_TEMPLATES, DENTAL_MODULE, hasUnfilledPlaceholders } from "../dental-templates";
import { applyTemplateToNote } from "../apply-template";
import { isSoapTemplateBody } from "../types";
import {
  MAX_EARLY_MS,
  pickSingleAppointmentOfDay,
  resolveNoteAppointmentId,
  sanitizeAppointmentId,
} from "../../../clinical/note-appointment-link";

const VACIA = { subjective: "", objective: "", assessment: "", plan: "" };

describe("DENTAL_DEFAULT_TEMPLATES", () => {
  it("trae las 8 plantillas pedidas, con nombres únicos", () => {
    const names = DENTAL_DEFAULT_TEMPLATES.map((t) => t.name);
    for (const n of [
      "Profilaxis", "Restauración con resina", "Endodoncia", "Extracción simple",
      "Corona", "Urgencia por dolor", "Revisión / control", "Primera vez",
    ]) assert.ok(names.includes(n), `falta la plantilla «${n}»`);
    assert.equal(new Set(names).size, names.length);
    for (const n of names) assert.ok(n.length >= 1 && n.length <= 80, `nombre fuera de 1–80: ${n}`);
  });

  it("solo una es default", () => {
    assert.equal(DENTAL_DEFAULT_TEMPLATES.filter((t) => t.isDefault).length, 1);
  });

  it("cada plantilla tiene S/O/A/P con texto, con huecos y dentro del límite de 4000", () => {
    for (const t of DENTAL_DEFAULT_TEMPLATES) {
      assert.ok(isSoapTemplateBody(t.soap), `soap inválido en ${t.name}`);
      for (const k of ["S", "O", "A", "P"] as const) {
        const txt = t.soap[k];
        assert.ok(txt.length > 10 && txt.length <= 4000, `${k} de «${t.name}» fuera de tamaño`);
        assert.ok(hasUnfilledPlaceholders(txt), `${k} de «${t.name}» no tiene ningún [hueco]`);
        // Los corchetes cierran y no se anidan: un hueco anidado no se lee.
        let depth = 0;
        for (const ch of txt) {
          if (ch === "[") depth++;
          if (ch === "]") depth--;
          assert.ok(depth === 0 || depth === 1, `corchetes mal puestos en ${k} de «${t.name}»`);
        }
        assert.equal(depth, 0, `corchete sin cerrar en ${k} de «${t.name}»`);
        // Los huecos del motor de ortodoncia ({{x}}) aquí no se rellenan solos.
        assert.ok(!txt.includes("{{"), `${k} de «${t.name}» usa {{…}} en vez de [corchetes]`);
      }
    }
  });

  it("no inventa datos clínicos: fuera de los huecos no hay piezas FDI ni dosis", () => {
    for (const t of DENTAL_DEFAULT_TEMPLATES) {
      for (const k of ["S", "O", "A", "P"] as const) {
        const fijo = t.soap[k].replace(/\[[^\[\]]*\]/g, "");
        // «24 h» de las indicaciones postoperatorias no es una pieza.
        assert.ok(!/\b[1-8][1-8]\b(?!\s?h\b)/.test(fijo), `pieza FDI escrita a mano en ${k} de «${t.name}»: ${fijo}`);
        assert.ok(!/\d+\s?(mg|ml|mm)\b/i.test(fijo), `dosis o medida escrita a mano en ${k} de «${t.name}»`);
      }
    }
  });
});

describe("applyTemplateToNote", () => {
  it("rellena los cuatro campos de una nota vacía", () => {
    for (const t of DENTAL_DEFAULT_TEMPLATES) {
      const out = applyTemplateToNote(VACIA, t.soap);
      assert.equal(out.subjective, t.soap.S);
      assert.equal(out.objective, t.soap.O);
      assert.equal(out.assessment, t.soap.A);
      assert.equal(out.plan, t.soap.P);
    }
  });

  it("NO pisa lo ya escrito: el texto del doctor se queda entero y delante", () => {
    const tpl = DENTAL_DEFAULT_TEMPLATES.find((t) => t.name === "Endodoncia")!.soap;
    const escrito = { ...VACIA, subjective: "Dolor pulsátil en 36 desde el lunes.", plan: "Rx periapical." };
    const out = applyTemplateToNote(escrito, tpl);
    assert.ok(out.subjective.startsWith("Dolor pulsátil en 36 desde el lunes."));
    assert.ok(out.subjective.endsWith(tpl.S));
    assert.ok(out.plan.startsWith("Rx periapical."));
    assert.ok(out.plan.endsWith(tpl.P));
    // Los que estaban vacíos sí se rellenan.
    assert.equal(out.objective, tpl.O);
    assert.equal(out.assessment, tpl.A);
  });

  it("no toca el resto del formulario (periodontal, oclusal, próxima cita…)", () => {
    const form = { ...VACIA, nextVisit: "3 meses", periodontal: { plaque: "20%" } };
    const out = applyTemplateToNote(form, DENTAL_DEFAULT_TEMPLATES[0].soap);
    assert.equal(out.nextVisit, "3 meses");
    assert.deepEqual(out.periodontal, { plaque: "20%" });
  });

  it("aplicar dos veces la misma plantilla no la duplica", () => {
    const tpl = DENTAL_DEFAULT_TEMPLATES[0].soap;
    const una = applyTemplateToNote({ ...VACIA, subjective: "Nota previa." }, tpl);
    assert.deepEqual(applyTemplateToNote(una, tpl), una);
  });

  it("un campo vacío en la plantilla deja el campo como estaba", () => {
    const out = applyTemplateToNote({ ...VACIA, plan: "Mi plan." }, { S: "s [x]", O: "", A: "", P: "" });
    assert.equal(out.plan, "Mi plan.");
    assert.equal(out.objective, "");
  });
});

describe("la cita de la nota", () => {
  it("con exactamente UNA cita viva ese día, es esa", () => {
    assert.equal(pickSingleAppointmentOfDay([{ id: "a", status: "CONFIRMED" }]), "a");
    assert.equal(
      pickSingleAppointmentOfDay([{ id: "a", status: "CANCELLED" }, { id: "b", status: "IN_PROGRESS" }, { id: "c", status: "NO_SHOW" }]),
      "b",
    );
  });

  it("con DOS citas el mismo día, o con ninguna, no se adivina", () => {
    assert.equal(pickSingleAppointmentOfDay([{ id: "a", status: "CONFIRMED" }, { id: "b", status: "COMPLETED" }]), null);
    assert.equal(pickSingleAppointmentOfDay([]), null);
    assert.equal(pickSingleAppointmentOfDay([{ id: "a", status: "CANCELLED" }]), null);
  });

  it("el servidor solo acepta el id si es LA cita de hoy, de ese doctor y ya cercana", () => {
    const now = new Date("2026-09-19T16:00:00Z");
    const ctx = { doctorId: "dr", now };
    const hoy = [{ id: "a", status: "CONFIRMED", doctorId: "dr", startsAt: now }];
    assert.equal(resolveNoteAppointmentId("a", hoy, ctx), "a");
    assert.equal(resolveNoteAppointmentId("de_otra_clinica", hoy, ctx), null);
    assert.equal(resolveNoteAppointmentId("a", [...hoy, { id: "b", status: "SCHEDULED", doctorId: "dr", startsAt: now }], ctx), null);
    assert.equal(resolveNoteAppointmentId("a", [], ctx), null);
    assert.equal(resolveNoteAppointmentId("a", hoy, { doctorId: "otra", now }), null, "cita de otro doctor");
    assert.equal(resolveNoteAppointmentId("a", [{ id: "a", status: "CONFIRMED", startsAt: now }], ctx), null, "cita sin doctor");
    const tarde = [{ ...hoy[0], startsAt: new Date(now.getTime() + MAX_EARLY_MS + 60_000) }];
    assert.equal(resolveNoteAppointmentId("a", tarde, ctx), null, "cita que aún queda lejos");
    const pasada = [{ ...hoy[0], startsAt: new Date(now.getTime() - 6 * 3600_000), status: "COMPLETED" }];
    assert.equal(resolveNoteAppointmentId("a", pasada, ctx), "a", "la nota escrita después de atender sí se liga");
    for (const raro of [undefined, null, "", "   ", 7, {}, [], "x".repeat(101)]) {
      assert.equal(sanitizeAppointmentId(raro), null);
      assert.equal(resolveNoteAppointmentId(raro, hoy, ctx), null);
    }
  });
});

describe("la ficha dental sigue conectada", () => {
  const root = join(__dirname, "../../../../..");
  const form = readFileSync(join(root, "src/components/clinical/dental-form.tsx"), "utf8");

  it("monta el selector del módulo dental y aplica sin pisar", () => {
    assert.equal(DENTAL_MODULE, "dental");
    assert.match(form, /<EvolutionTemplatePicker\s+module=\{DENTAL_MODULE\}/);
    assert.match(form, /applyTemplateToNote\(f, tpl\.soapTemplate\)/);
    assert.ok(!form.includes("applyTemplateToSoap"), "applyTemplateToSoap tiene un modo «replace» que borra");
  });

  it("manda la cita de hoy al crear la nota, y solo si hay una", () => {
    assert.match(form, /fetchTodayAppointmentId\(patientId\)/);
    assert.match(form, /\.\.\.\(appointmentId \? \{ appointmentId \} : \{\}\)/);
    assert.match(form, /pickSingleAppointmentOfDay\(/);
  });

  it("el enum ClinicalModule tiene `dental` y su ALTER va solo en su archivo", () => {
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    const bloque = schema.slice(schema.indexOf("enum ClinicalModule {"));
    assert.match(bloque.slice(0, bloque.indexOf("}")), /^\s*dental\s*$/m);
    const sql = readFileSync(join(root, "sql/clinical-module-dental-enum.sql"), "utf8");
    const sentencias = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join(" ");
    assert.equal(sentencias.trim(), `ALTER TYPE "ClinicalModule" ADD VALUE IF NOT EXISTS 'dental';`);
  });

  it("es.json y en.json tienen las mismas claves nuevas", () => {
    const claves = (lang: string) => {
      const d = JSON.parse(readFileSync(join(root, `src/i18n/dictionaries/${lang}.json`), "utf8"));
      const f = d.clinical.dentalForm;
      return [...Object.keys(f.templates).map((k) => `templates.${k}`), "linkedToTodayAppointment" in f ? "linked" : "—"].sort();
    };
    assert.deepEqual(claves("es"), claves("en"));
    assert.ok(claves("es").includes("templates.unfilledWarning") && claves("es").includes("linked"));
  });
});
