/**
 * ws1-t2 — Equipo: «Módulos de especialidades» (casilla Ortodoncia).
 *
 * Run: npx tsx --test src/lib/team/__tests__/modulos-especialidades.test.ts
 *
 *  · casilla ↔ Permisos: leen y escriben el MISMO permiso por persona.
 *  · deshabilitada sin el módulo contratado («Contrata el módulo para activarla»).
 *  · desmarcar no quita casos: quien ya lleva un caso lo conserva; solo deja de
 *    ofrecerse en los nuevos.
 *  · recepción (y cualquier rol que no sea doctor, o sede no dental) sin sección.
 *  · editar no borra nada que no se tocó (T1 de la cédula sigue).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getEffectivePermissions } from "@/lib/auth/permissions";
import {
  LLAVE_MODULO_ORTODONCIA,
  overrideConAcceso,
  tieneAccesoOrtodoncia,
} from "@/lib/orthodontics/acceso-doctor";
import { atiendePacientes, opcionesDeDoctorTratante } from "@/lib/orthodontics/doctores-tratantes";
import { formDeMiembro, parcheDeCambios } from "../parche-miembro";
import {
  MODULOS_ESPECIALIDADES,
  accesoParaAlta,
  accesoQueViaja,
  estadoDeCasilla,
  respuestaDeCasilla,
  seccionModulosVisible,
} from "../modulos-especialidades";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** Aplica lo que el servidor haría con la casilla y devuelve la persona resultante. */
function guardar(
  u: { role: string; permissionsOverride: string[] },
  marcada: boolean,
): { role: string; permissionsOverride: string[] } {
  const nuevo = overrideConAcceso(u, respuestaDeCasilla(marcada));
  assert.ok(nuevo, "no debe dejar a la persona sin permisos");
  return { ...u, permissionsOverride: nuevo };
}

/** Lo que Equipo → Permisos muestra como marcado para esa persona. */
function marcadoEnPermisos(u: { role: string; permissionsOverride: string[] }): boolean {
  return getEffectivePermissions({ role: u.role as never, permissionsOverride: u.permissionsOverride }).includes(LLAVE_MODULO_ORTODONCIA);
}

test("la lista de módulos hoy es solo Ortodoncia y su llave es el permiso por persona", () => {
  assert.deepEqual(MODULOS_ESPECIALIDADES.map((m) => m.id), ["ortodoncia"]);
  assert.equal(MODULOS_ESPECIALIDADES[0].llave, "specialties.orthodontics");
  assert.equal(MODULOS_ESPECIALIDADES[0].llave, LLAVE_MODULO_ORTODONCIA);
});

test("casilla ↔ Permisos: marcar y desmarcar escriben lo que Permisos lee, y nunca se contradicen", () => {
  let u = { role: "DOCTOR", permissionsOverride: ["today.view", "patients.view"] };
  assert.equal(marcadoEnPermisos(u), false);
  u = guardar(u, true);
  assert.equal(marcadoEnPermisos(u), true, "Permisos ve la llave puesta");
  assert.equal(tieneAccesoOrtodoncia(u), true);
  u = guardar(u, false);
  assert.equal(marcadoEnPermisos(u), false, "Permisos ve la llave quitada");
  assert.equal(tieneAccesoOrtodoncia(u), false);
  assert.deepEqual(u.permissionsOverride, ["today.view", "patients.view"], "el resto de sus permisos no se toca");
});

test("casilla ↔ Permisos: lo que se quita o se da en Permisos se ve en la casilla al abrir el modal", () => {
  // Doctor sin override (default del rol, que trae el módulo): casilla marcada.
  const porDefecto = { role: "DOCTOR", permissionsOverride: [] as string[] };
  assert.equal(estadoDeCasilla({ contratado: true, puedeCambiar: true, respuesta: tieneAccesoOrtodoncia(porDefecto) ? "ortodoncista" : "solo_dental" }).marcada, true);
  // Le quitaron la llave en Permisos: casilla desmarcada.
  const sinLlave = { role: "DOCTOR", permissionsOverride: ["today.view"] };
  assert.equal(estadoDeCasilla({ contratado: true, puedeCambiar: true, respuesta: tieneAccesoOrtodoncia(sinLlave) ? "ortodoncista" : "solo_dental" }).marcada, false);
  // Quien hoy tenía «También ortodoncista» (llave puesta) queda marcado sin migrar nada.
  const teniaTambien = { role: "DOCTOR", permissionsOverride: ["today.view", LLAVE_MODULO_ORTODONCIA] };
  assert.equal(estadoDeCasilla({ contratado: true, puedeCambiar: true, respuesta: tieneAccesoOrtodoncia(teniaTambien) ? "ortodoncista" : "solo_dental" }).marcada, true);
});

test("deshabilitada sin el módulo contratado, aunque la persona traiga la llave", () => {
  const e = estadoDeCasilla({ contratado: false, puedeCambiar: true, respuesta: "ortodoncista" });
  assert.deepEqual(e, { marcada: false, deshabilitada: true, motivo: "sin_modulo" });
  const f = estadoDeCasilla({ contratado: false, puedeCambiar: true, respuesta: "" });
  assert.equal(f.deshabilitada, true);
  assert.equal(f.motivo, "sin_modulo");
});

test("con el módulo: editable para quien cambia permisos; solo lectura para los demás", () => {
  assert.deepEqual(
    estadoDeCasilla({ contratado: true, puedeCambiar: true, respuesta: "solo_dental" }),
    { marcada: false, deshabilitada: false, motivo: null },
  );
  assert.deepEqual(
    estadoDeCasilla({ contratado: true, puedeCambiar: false, respuesta: "ortodoncista" }),
    { marcada: true, deshabilitada: true, motivo: "solo_dueno" },
  );
});

test("la pantalla dice «Contrata el módulo para activarla» y ya no pregunta dos veces", () => {
  const comp = leer("src/app/dashboard/team/modulos-especialidades.tsx");
  assert.match(comp, /Contrata el módulo para activarla/);
  assert.match(comp, /type="checkbox"/);
  const cliente = leer("src/app/dashboard/team/team-client.tsx");
  for (const viejo of ["CampoAccesoOrtodoncia", "especialidadFija", "especialidadFijaPorOrto", "especialidadOrtoMarcaAcceso", "También ortodoncista", "Solo dental"]) {
    assert.equal(cliente.includes(viejo), false, `sobra «${viejo}» en team-client`);
  }
  const textos = leer("src/app/dashboard/team/textos-equipo.ts");
  assert.equal(textos.includes("Al ser también ortodoncista"), false);
  // «Especialidad» ya no se bloquea ni se reescribe.
  assert.doesNotMatch(cliente, /disabled=\{especialidad/);
  assert.equal(leer("src/lib/orthodontics/acceso-doctor.ts").includes("especialidadSegunAcceso"), false);
});

test("desmarcar no quita casos: deja de ofrecerse como doctor tratante, pero el caso conserva su id", () => {
  const conModulo = { id: "d1", firstName: "Ana", lastName: "Ruiz", role: "DOCTOR", permissionsOverride: ["today.view", LLAVE_MODULO_ORTODONCIA] };
  const otro = { id: "d2", firstName: "Beto", lastName: "Paz", role: "DOCTOR", permissionsOverride: [] as string[] };
  assert.deepEqual(opcionesDeDoctorTratante([conModulo, otro]).map((o) => o.id).sort(), ["d1", "d2"]);

  // Se desmarca a Ana: sale de la lista de casos NUEVOS…
  const sinModulo = { ...conModulo, permissionsOverride: overrideConAcceso(conModulo, "solo_dental")! };
  assert.equal(atiendePacientes(sinModulo), false);
  assert.deepEqual(opcionesDeDoctorTratante([sinModulo, otro]).map((o) => o.id), ["d2"]);

  // …y la escritura no toca ningún caso: el PATCH de miembro solo escribe `permissionsOverride`.
  const patch = leer("src/app/api/team/[id]/route.ts");
  assert.doesNotMatch(patch, /orthodonticTreatmentPlan/, "el PATCH de Equipo no reasigna casos");
  assert.doesNotMatch(leer("src/app/api/team/route.ts"), /orthodonticTreatmentPlan/);

  // Un caso ya abierto con Ana sigue guardando: repetir el mismo doctor no se re-valida.
  const validar = leer("src/lib/orthodontics/validar-personas-del-caso.ts");
  assert.match(validar, /actuales/, "lo que el caso ya tiene no se re-valida");
});

test("el cajón «Datos del caso» sigue mostrando al doctor actual aunque ya no tenga el módulo", () => {
  const cajon = leer("src/components/specialties/orthodontics/redesign/drawers/DrawerCaseSettings.tsx");
  assert.match(cajon, /!doctors\.some\(\(d\) => d\.id === treatingDoctorId\)/);
});

test("recepción (y todo lo que no sea un doctor de sede dental) no ve la sección", () => {
  assert.equal(seccionModulosVisible({ role: "DOCTOR", sedeDental: true }), true);
  for (const role of ["RECEPTIONIST", "READONLY", "ADMIN", "SUPER_ADMIN"]) {
    assert.equal(seccionModulosVisible({ role, sedeDental: true }), false, role);
  }
  assert.equal(seccionModulosVisible({ role: "DOCTOR", sedeDental: false }), false, "barbería, inmuebles, instituto…");
  // Y la pantalla de verdad pasa el rol y la sede.
  assert.match(leer("src/app/dashboard/team/team-client.tsx"), /seccionModulosVisible\(\{ role: form\.role, sedeDental \}\)/);
  assert.match(leer("src/app/dashboard/team/page.tsx"), /sedeDental=\{user\.clinic\.category === "DENTAL"\}/);
});

test("alta: un doctor con el módulo arranca SIN Ortodoncia (desmarcada) hasta que se marque", () => {
  assert.equal(accesoParaAlta({ aplica: true, respuesta: "" }), "solo_dental");
  assert.equal(accesoParaAlta({ aplica: true, respuesta: "ortodoncista" }), "ortodoncista");
  assert.equal(accesoParaAlta({ aplica: true, respuesta: "solo_dental" }), "solo_dental");
  assert.equal(accesoParaAlta({ aplica: false, respuesta: "ortodoncista" }), "", "sin módulo o sin ser doctor no viaja nada");
});

test("editar solo manda la casilla si se cambió (guardar el teléfono no reescribe permisos)", () => {
  assert.equal(accesoQueViaja({ inicial: "ortodoncista", actual: "ortodoncista" }), undefined);
  assert.equal(accesoQueViaja({ inicial: "solo_dental", actual: "solo_dental" }), undefined);
  assert.equal(accesoQueViaja({ inicial: "", actual: "" }), undefined, "sin módulo no viaja");
  assert.equal(accesoQueViaja({ inicial: "solo_dental", actual: "ortodoncista" }), "ortodoncista");
  assert.equal(accesoQueViaja({ inicial: "ortodoncista", actual: "solo_dental" }), "solo_dental");
});

test("editar no borra nada que no se tocó: la casilla no mete campos al parche ni reescribe la especialidad", () => {
  const guardado = {
    firstName: "Ana", lastName: "Ruiz", email: "a@x.com", role: "DOCTOR", specialty: "Endodoncia",
    color: "#3b82f6", phone: "555", services: ["Limpieza"], cedulaProfesional: "1234567",
    especialidad: "Endodoncia", cedulaEspecialidad: "7654321",
  };
  const inicial = formDeMiembro(guardado);
  // Solo se cambia la casilla: el parche de datos queda vacío (la casilla viaja aparte).
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial }), {});
  // Se cambia el teléfono Y la casilla: el parche lleva solo el teléfono, la cédula no se envía.
  const parche = parcheDeCambios(inicial, { ...inicial, phone: "999" });
  assert.deepEqual(parche, { phone: "999" });
  // La pantalla ya no inyecta `specialty` al cambiar la casilla.
  const cliente = leer("src/app/dashboard/team/team-client.tsx");
  assert.doesNotMatch(cliente, /cambioAcceso && \{ specialty/);
  assert.match(cliente, /accesoOrtodoncia: acceso,/);
});
