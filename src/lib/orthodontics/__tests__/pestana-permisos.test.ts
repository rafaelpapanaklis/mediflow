/**
 * X2 / MAPA 19 — quién ve qué de la pestaña «Ortodoncia» de la ficha.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/pestana-permisos.test.ts
 *
 *  · Sin la llave del módulo (`specialties.orthodontics`) no hay pestaña.
 *  · Con la llave y sin expediente (`medicalRecord.view`): cara administrativa,
 *    sin diagnóstico ni nada clínico (y el servidor ni lo carga).
 *  · Con las dos: la pestaña clínica — también en solo lectura (decisión 3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasPermission } from "@/lib/auth/permissions";
import { vistaOrtoPorPermisos, type AccesoOrtoFicha } from "../pestana-ficha";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

function vistaPara(user: { role: string; permissionsOverride?: string[] }, acceso: AccesoOrtoFicha = "completo") {
  return vistaOrtoPorPermisos({
    acceso,
    llaveModulo: hasPermission(user, "specialties.orthodontics"),
    verExpediente: hasPermission(user, "medicalRecord.view"),
  });
}

test("la regla pura: contrato primero, luego llave del módulo, luego expediente", () => {
  for (const acceso of ["completo", "solo-lectura"] as const) {
    assert.equal(vistaOrtoPorPermisos({ acceso, llaveModulo: true, verExpediente: true }), "clinica");
    assert.equal(vistaOrtoPorPermisos({ acceso, llaveModulo: true, verExpediente: false }), "administrativa");
    assert.equal(vistaOrtoPorPermisos({ acceso, llaveModulo: false, verExpediente: true }), "oculta");
    assert.equal(vistaOrtoPorPermisos({ acceso, llaveModulo: false, verExpediente: false }), "oculta");
  }
  // Sin módulo y sin caso que conservar: nadie, ni con todas las llaves.
  assert.equal(vistaOrtoPorPermisos({ acceso: "oculto", llaveModulo: true, verExpediente: true }), "oculta");
});

test("defaults por rol: doctor y admin clínico, recepción administrativa, solo lectura sin pestaña", () => {
  assert.equal(vistaPara({ role: "DOCTOR" }), "clinica");
  assert.equal(vistaPara({ role: "ADMIN" }), "clinica");
  assert.equal(vistaPara({ role: "SUPER_ADMIN" }), "clinica");
  assert.equal(vistaPara({ role: "RECEPTIONIST" }), "administrativa", "recepción no ve el diagnóstico");
  assert.equal(vistaPara({ role: "READONLY" }), "oculta", "solo lectura no tiene specialties.* ni expediente");
});

test("decisión 3: sin módulo contratado, quien tiene las dos llaves conserva la LECTURA", () => {
  assert.equal(vistaPara({ role: "DOCTOR" }, "solo-lectura"), "clinica");
  assert.equal(vistaPara({ role: "RECEPTIONIST" }, "solo-lectura"), "administrativa");
});

test("overrides: quitarle «Ortodoncia» a una doctora le quita la pestaña; darle expediente a recepción le abre lo clínico", () => {
  assert.equal(
    vistaPara({ role: "DOCTOR", permissionsOverride: ["patients.view", "medicalRecord.view", "medicalRecord.edit"] }),
    "oculta",
  );
  assert.equal(
    vistaPara({ role: "RECEPTIONIST", permissionsOverride: ["patients.view", "specialties.orthodontics", "medicalRecord.view"] }),
    "clinica",
  );
  assert.equal(
    vistaPara({ role: "DOCTOR", permissionsOverride: ["patients.view", "specialties.orthodontics"] }),
    "administrativa",
  );
});

test("la ficha solo carga el caso en la vista clínica y pasa la cara administrativa aparte", () => {
  const pagina = leer("src/app/dashboard/patients/[id]/page.tsx");
  assert.match(pagina, /hasPermission\(permsUser, "specialties\.orthodontics"\)/);
  assert.match(pagina, /verExpediente: hasPermission\(permsUser, "medicalRecord\.view"\)/);
  assert.match(pagina, /if \(orthoVista === "clinica"\) \{\s*const redesign = await loadOrthoRedesignData\(/);
  assert.equal((pagina.match(/loadOrthoRedesignData\(/g) ?? []).length, 1, "un solo sitio carga lo clínico");
  assert.match(pagina, /orthoSoloAdministrativo=\{orthoSoloAdministrativo\}/);

  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /tab === "ortodoncia" && orthoSoloAdministrativo && \(\s*<OrtodonciaAdministrativa/);
  assert.match(ficha, /tab === "ortodoncia" && !orthoSoloAdministrativo && \(/);

  const aviso = leer("src/components/specialties/orthodontics/redesign/OrtodonciaAdministrativa.tsx");
  assert.match(aviso, /Lo clínico del caso lo ven doctores/);
  assert.doesNotMatch(aviso, /Section[A-Z]\w+|diagnosis|orthoData/i);
});
