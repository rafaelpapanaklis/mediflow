// ws1-t12 — ticket BEVADENT (tercero): arcos por arcada al firmar (4b), «Otro arco…» con arcada (4c), el material exacto
// (4d) y «En los próximos 7 días» sin los ya atendidos (12c).
// Correr: npm run test:orto-arcos-y-controles
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cambiosAlFirmarConArco, type PasoDeArco } from "../secuencia-de-arcos";
import { ETIQUETA_DE_MATERIAL, MATERIALES_DE_ARCO, materialParaGuardar, textoDeArco } from "../material-de-arco";
import { materialesNuevosEnLaBase, olvidarMaterialesEnLaBase } from "../material-de-arco-db";
import { controlesDeLaSemana, controlPendiente, type CitaDeControl } from "../controles-modulo";
import { WIRE_MATERIAL_OPTIONS } from "@/components/specialties/orthodontics/redesign/drawers/wire-options";

// ── 4b · cerrar solo el arco de la arcada que cambia ─────────────────────────────────────────────────────────────────

const visita = new Date("2026-10-02T18:00:00Z");
const inicio = new Date("2026-09-01T18:00:00Z");
const paso = (id: string, status: PasoDeArco["status"], arcada: "sup" | "inf" | "ambas", applied: Date | null = null): PasoDeArco => ({
  id,
  status,
  appliedDate: applied,
  completedDate: null,
  archUpper: arcada !== "inf",
  archLower: arcada !== "sup",
});
const resumen = (c: ReturnType<typeof cambiosAlFirmarConArco>) => c.map((x) => [x.id, x.status]);

test("4b: cambiar el arco SUPERIOR no da por terminado el INFERIOR (el caso de BEVADENT)", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [paso("sup-014", "ACTIVE", "sup", inicio), paso("inf-014", "ACTIVE", "inf", inicio), paso("sup-016", "PLANNED", "sup")],
    arcoNuevoId: "sup-016",
    arcoAnteriorId: "sup-014",
    fecha: visita,
  });
  assert.deepEqual(resumen(cambios), [["sup-016", "ACTIVE"], ["sup-014", "COMPLETED"]]);
});

test("4b: un arco de las dos arcadas sigue «actual» si el nuevo es solo de una (sigue puesto en la otra)", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [paso("ambas-014", "ACTIVE", "ambas", inicio), paso("inf-016", "PLANNED", "inf")],
    arcoNuevoId: "inf-016",
    arcoAnteriorId: "ambas-014",
    fecha: visita,
  });
  assert.deepEqual(resumen(cambios), [["inf-016", "ACTIVE"]]);
});

test("4b: un arco nuevo de las dos arcadas reemplaza a los de cada arcada", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [paso("sup-014", "ACTIVE", "sup", inicio), paso("inf-014", "ACTIVE", "inf", inicio), paso("ambas-016", "PLANNED", "ambas")],
    arcoNuevoId: "ambas-016",
    fecha: visita,
  });
  assert.deepEqual(resumen(cambios), [["ambas-016", "ACTIVE"], ["sup-014", "COMPLETED"], ["inf-014", "COMPLETED"]]);
  assert.equal(cambios[1]!.completedDate?.toISOString(), visita.toISOString());
});

test("4b: el arco de llegada nunca marcado se cierra solo si es de la misma arcada", () => {
  const otraArcada = cambiosAlFirmarConArco({
    pasos: [paso("inf-014", "PLANNED", "inf"), paso("sup-016", "PLANNED", "sup")],
    arcoNuevoId: "sup-016",
    arcoAnteriorId: "inf-014",
    fecha: visita,
  });
  assert.deepEqual(resumen(otraArcada), [["sup-016", "ACTIVE"]]);
  const mismaArcada = cambiosAlFirmarConArco({
    pasos: [paso("sup-014", "PLANNED", "sup"), paso("sup-016", "PLANNED", "sup")],
    arcoNuevoId: "sup-016",
    arcoAnteriorId: "sup-014",
    fecha: visita,
  });
  assert.deepEqual(resumen(mismaArcada), [["sup-016", "ACTIVE"], ["sup-014", "COMPLETED"]]);
});

test("4b: sin dato de arcada (filas viejas) cuenta como las dos, igual que antes", () => {
  const cambios = cambiosAlFirmarConArco({
    pasos: [
      { id: "a", status: "ACTIVE", appliedDate: inicio, completedDate: null },
      { id: "b", status: "PLANNED", appliedDate: null, completedDate: null, archUpper: false, archLower: false },
    ],
    arcoNuevoId: "b",
    fecha: visita,
  });
  assert.deepEqual(resumen(cambios), [["b", "ACTIVE"], ["a", "COMPLETED"]]);
});

test("4b: la firma lee la arcada de cada paso (el select de signTreatmentCard la pide)", () => {
  const fuente = readFileSync(path.join(process.cwd(), "src/app/actions/orthodontics/signTreatmentCard.ts"), "utf8");
  const bloque = fuente.slice(fuente.indexOf("prisma.orthoWireStep.findMany"), fuente.indexOf("cambiosAlFirmarConArco({"));
  assert.match(bloque, /archUpper: true/);
  assert.match(bloque, /archLower: true/);
});

// ── 4c · «Otro arco…» pregunta la arcada ─────────────────────────────────────────────────────────────────────────────

test("4c: «Otro arco…» manda la arcada elegida y pinta la fila tal como se guardó", () => {
  const fuente = readFileSync(
    path.join(process.cwd(), "src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"),
    "utf8",
  );
  const form = fuente.slice(fuente.indexOf("function OtroArcoForm("), fuente.indexOf("function wireText("));
  assert.ok(form.length > 0);
  assert.doesNotMatch(form, /archUpper: true/, "ya no es siempre de las dos arcadas");
  assert.doesNotMatch(form, /archLower: true/);
  assert.match(form, /Superior/);
  assert.match(form, /Inferior/);
  assert.match(form, /props\.onCreated\(res\.data\.paso\)/, "el material y la arcada salen de lo guardado");
  assert.doesNotMatch(form, /dbMaterial/, "nada de adivinar el material en la pantalla");
});

// ── 4d · el material elegido es el que se guarda ─────────────────────────────────────────────────────────────────────

test("4d: cada opción del selector se guarda como sí misma (Cr-Co y Multi-stranded ya no son acero)", () => {
  const guardado = Object.fromEntries(
    WIRE_MATERIAL_OPTIONS.map((o) => {
      const r = materialParaGuardar(o.key, true);
      return [o.key, r.ok ? r.material : r.error];
    }),
  );
  assert.deepEqual(guardado, {
    NITI_SUPER: "NITI_SUPERELASTIC",
    NITI_THERMO: "NITI_THERMAL",
    NITI_CONV: "NITI",
    SS: "SS",
    TMA: "TMA",
    MULTI: "MULTISTRANDED",
    CRCO: "CR_CO",
  });
  // Ninguna opción distinta termina en el mismo valor.
  assert.equal(new Set(Object.values(guardado)).size, WIRE_MATERIAL_OPTIONS.length);
});

test("4d: sin el SQL, Cr-Co y Multi-stranded NO se guardan como acero; los NiTi caen en «NiTi»", () => {
  for (const clave of ["CRCO", "MULTI"]) {
    const r = materialParaGuardar(clave, false);
    assert.equal(r.ok, false, clave);
    if (!r.ok) assert.match(r.error, /aún no está disponible/);
  }
  assert.deepEqual(materialParaGuardar("NITI_THERMO", null), { ok: true, material: "NITI" });
  assert.deepEqual(materialParaGuardar("SS", false), { ok: true, material: "SS" });
  assert.deepEqual(materialParaGuardar("BETA_TITANIUM", false), { ok: true, material: "BETA_TITANIUM" });
  assert.equal(materialParaGuardar("ORO", true).ok, false);
});

test("4d: cada valor guardado tiene nombre legible (la ficha nunca pinta «CR_CO»)", () => {
  for (const m of MATERIALES_DE_ARCO) assert.ok(ETIQUETA_DE_MATERIAL[m] && !ETIQUETA_DE_MATERIAL[m].includes("_"), m);
  assert.equal(textoDeArco({ material: "CR_CO", gauge: "016" }), "Cr-Co 016");
  assert.equal(textoDeArco({ material: "NITI", gauge: "014" }), "NiTi 014");
  assert.equal(textoDeArco({ material: "OTRO", gauge: "014" }), "OTRO 014");
});

test("4d: el schema declara los mismos valores que el código", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const bloque = schema.slice(schema.indexOf("enum OrthoWireMaterial {"));
  const valores = bloque.slice(bloque.indexOf("{") + 1, bloque.indexOf("}")).split(/\s+/).filter(Boolean);
  assert.deepEqual([...valores].sort(), [...MATERIALES_DE_ARCO].sort());
  const sql = readFileSync(path.join(process.cwd(), "sql/ws1-t12-material-de-arco.sql"), "utf8");
  for (const m of ["NITI_SUPERELASTIC", "NITI_THERMAL", "MULTISTRANDED", "CR_CO"]) {
    assert.match(sql, new RegExp(`^ALTER TYPE "OrthoWireMaterial" ADD VALUE IF NOT EXISTS '${m}';$`, "m"));
  }
});

test("4d: sin los valores en la base se pregunta UNA vez cada 10 min; con ellos, nunca más", async () => {
  olvidarMaterialesEnLaBase();
  let preguntas = 0;
  const viejos = async () => {
    preguntas += 1;
    return ["NITI", "SS", "TMA", "BETA_TITANIUM"].map((enumlabel) => ({ enumlabel }));
  };
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(await materialesNuevosEnLaBase(viejos, t0 + i * 1000), false);
  assert.equal(preguntas, 1);
  const todos = async () => {
    preguntas += 1;
    return MATERIALES_DE_ARCO.map((enumlabel) => ({ enumlabel }));
  };
  assert.equal(await materialesNuevosEnLaBase(todos, t0 + 11 * 60 * 1000), true);
  assert.equal(await materialesNuevosEnLaBase(todos, t0 + 999 * 60 * 1000), true);
  assert.equal(preguntas, 2);
  olvidarMaterialesEnLaBase();
  const falla = async () => {
    throw new Error("sin conexión");
  };
  assert.equal(await materialesNuevosEnLaBase(falla, t0), false, "si no se puede preguntar, no se escribe un valor dudoso");
  olvidarMaterialesEnLaBase();
});

// ── 12c · «En los próximos 7 días» cuenta solo lo que sigue por atender ──────────────────────────────────────────────

const ZONA = "America/Mexico_City";
const HOY = "2026-10-02";
const cita = (status: string, iso: string, nombre = status): CitaDeControl =>
  ({
    appointmentId: `${nombre}-${iso}`,
    patientId: `p-${nombre}`,
    patientName: nombre,
    startsAt: new Date(iso),
    status,
    doctorName: null,
    hoja: null,
    treatmentPlanId: "caso-1",
    progreso: null,
  }) as unknown as CitaDeControl;

test("12c: una cita futura ya atendida se lista, pero no cuenta como control agendado", () => {
  const semana = controlesDeLaSemana(
    [cita("COMPLETED", "2026-10-06T18:00:00Z", "Atendida antes"), cita("SCHEDULED", "2026-10-06T19:00:00Z", "Agendada")],
    HOY,
    ZONA,
  );
  assert.deepEqual(semana.proximosDias.map((d) => d.citas.map((c) => c.patientName)), [["Atendida antes", "Agendada"]]);
  assert.equal(semana.totalProximos, 1);
  assert.equal(semana.atendidosProximos, 1);
});

test("12c: pendiente = ni cancelada, ni falta, ni atendida", () => {
  const estados = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "NO_SHOW", "CANCELLED"];
  assert.deepEqual(
    estados.filter(controlPendiente),
    ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"],
  );
  const semana = controlesDeLaSemana(
    estados.map((s, i) => cita(s, `2026-10-0${3 + (i % 4)}T1${i}:00:00Z`)),
    HOY,
    ZONA,
  );
  assert.equal(semana.totalProximos, 5);
  assert.equal(semana.atendidosProximos, 2);
});

test("12c: la tarjeta dice «N controles agendados · M ya atendidos» con la misma regla", () => {
  const fuente = readFileSync(path.join(process.cwd(), "src/components/specialties/orthodontics/modulo/vista-controles.tsx"), "utf8");
  assert.match(fuente, /controlPendiente\(c\.status\)/, "el número de cada día usa la regla de pendientes");
  assert.doesNotMatch(fuente, /d\.citas\.filter\(\(c\) => c\.status !== "CANCELLED"\)\.length/);
  assert.match(fuente, /semana\.atendidosProximos/);
});
