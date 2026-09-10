/**
 * Las tres herramientas de PACIENTES: `pacientes_nuevos`,
 * `pacientes_inactivos`, `buscar_paciente`.
 *
 * Run: npm run test:sabina-pacientes
 *
 * Aquí lo que se vigila es sobre todo QUIÉN ve a QUIÉN, porque es donde una
 * herramienta bien intencionada filtra un expediente:
 *
 *  · el scope sale de `buildPatientWhere`, así que un DOCTOR ve los pacientes
 *    que le pinta /dashboard/patients y ni uno más;
 *  · una paciente con `visibleUserIds` no vacío la ven SOLO esos usuarios y
 *    cualquier admin — la lista concede Y restringe;
 *  · un paciente cancelado por ARCO (`deletedAt`) no sale en ninguna lista;
 *  · y ninguna de las tres manda alergias, padecimientos, medicación ni notas.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { buildPatientSearchSql } from "@/lib/patients/patient-search";
import { ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import { CL_NORTE, HOY_N, adminNorte, base, doctorNorte, recepcionNorte } from "./siembra";

const RANGO = { desde: sumarDias(HOY_N, -10), hasta: HOY_N };

/* ══════════════════════════════════════════════════════════════════════
 * pacientes_nuevos
 * ══════════════════════════════════════════════════════════════════════ */

test("pacientes_nuevos: cuenta las altas del rango y compara con el tramo anterior", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // En los últimos 11 días: Carla (-5), Paula (-4), Dora (-2), Elías (-1).
  // El cancelado por ARCO (-3) NO cuenta.
  assert.equal(r.datos.nuevos.total, 4);
  // El tramo anterior es del MISMO tamaño (11 días): sólo Beto (-20).
  assert.equal(r.datos.periodoAnterior, 1);
  assert.equal(r.datos.variacionPct, 300);
});

test("🔴 pacientes_nuevos: el paciente cancelado por ARCO no sale en la lista", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(JSON.stringify(r).indexOf("Borrado"), -1);
  assert.equal(JSON.stringify(r).indexOf("P0007"), -1);
});

test("pacientes_nuevos: el desglose por origen es exacto, no una muestra de la página", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.porOrigen[0].origen, "Google");
  assert.equal(r.datos.porOrigen[0].altas, 2);
  const total = r.datos.porOrigen.reduce((a, b) => a + b.altas, 0);
  assert.equal(total, r.datos.nuevos.total, "el desglose suma el total");
  // Quien no tiene origen capturado sale como «sin registrar», no se descarta.
  assert.equal(
    r.datos.porOrigen.some((o) => o.origen === "sin registrar"),
    true,
  );
});

test("🔴 pacientes_nuevos: un DOCTOR ve SUS pacientes, igual que en /dashboard/patients", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", doctorNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // De las cuatro altas ve DOS, y son exactamente las que le pinta la pantalla:
  //   · Carla — es su paciente (`primaryDoctorId`);
  //   · Elías — no es su paciente, pero TIENE una cita con él (la cancelada de
  //     hace cinco días), y ésa es una de las tres heurísticas de
  //     `buildPatientWhere`: quien atiende a alguien puede verlo.
  // Dora es de su compañera y no ha pasado por su agenda; Paula está restringida
  // al admin, y ahí la lista manda sobre las heurísticas.
  assert.equal(r.datos.nuevos.total, 2);
  assert.deepEqual(
    r.datos.nuevos.filas.map((f) => f.paciente).sort(),
    ["Carla Gomez", "Elias Ruiz"],
  );
  assert.equal(JSON.stringify(r).indexOf("Restringida"), -1);
  assert.equal(JSON.stringify(r).indexOf("Dora"), -1);
});

test("pacientes_nuevos: no manda nada clínico", async () => {
  const r = await ejecutarHerramienta("pacientes_nuevos", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.datos.nuevos.filas[0]).sort(), [
    "alta",
    "etapa",
    "folio",
    "origen",
    "paciente",
  ]);
});

/* ══════════════════════════════════════════════════════════════════════
 * pacientes_inactivos
 * ══════════════════════════════════════════════════════════════════════ */

test("pacientes_inactivos: el criterio es el del barrido de reactivación", async () => {
  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(base()), { dias: 180 });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Irma (CHECKED_OUT hace 600 días) e Inés (COMPLETED hace 400).
  assert.equal(r.datos.inactivos.total, 2);
  assert.deepEqual(
    r.datos.inactivos.filas.map((f) => f.paciente),
    ["Irma Antigua", "Ines Vieja"],
    "primero el que lleva más tiempo sin venir: es el orden en que se llama",
  );
});

test("🔴 pacientes_inactivos: quien YA tiene cita no es un paciente perdido", async () => {
  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(base()), { dias: 180 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Iván no vino en 200 días, pero vuelve en 10: no hay a quién reactivar.
  assert.equal(JSON.stringify(r).indexOf("Agendado"), -1);
});

test("pacientes_inactivos: sin ninguna visita cumplida no cuenta como inactivo", async () => {
  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(base()), { dias: 180 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Ismael sólo tiene una cita CANCELADA: nunca fue paciente de la casa.
  assert.equal(JSON.stringify(r).indexOf("Nuncavino"), -1);
});

test("pacientes_inactivos: `dias` mueve el corte, y CHECKED_OUT cuenta como visita", async () => {
  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(base()), { dias: 60 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Con el corte en 60 días entra también Iris (última visita hace 100).
  assert.deepEqual(
    r.datos.inactivos.filas.map((f) => f.paciente),
    ["Irma Antigua", "Ines Vieja", "Iris Reciente"],
  );
  assert.equal(r.datos.inactivos.filas[0].diasSinVenir >= 599, true);
});

test("pacientes_inactivos: lleva el teléfono, porque el punto es poder llamarles", async () => {
  const r = await ejecutarHerramienta("pacientes_inactivos", adminNorte(base()), { dias: 180 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.inactivos.filas[0].telefono, "5511110005");
  assert.deepEqual(Object.keys(r.datos.inactivos.filas[0]).sort(), [
    "diasSinVenir",
    "folio",
    "paciente",
    "telefono",
    "ultimaVisita",
  ]);
});

/* ══════════════════════════════════════════════════════════════════════
 * buscar_paciente
 * ══════════════════════════════════════════════════════════════════════ */

test("buscar_paciente: encuentra por nombre, por folio y por teléfono", async () => {
  const db = base();
  const ctx = adminNorte(db);

  const porNombre = await ejecutarHerramienta("buscar_paciente", ctx, { termino: "Ana" });
  assert.equal(porNombre.ok, true);
  if (porNombre.ok) {
    assert.equal(porNombre.datos.resultados.total, 1);
    assert.equal(porNombre.datos.resultados.filas[0].paciente, "Ana Perez");
  }

  // El folio es lo que trae impreso el recibo del paciente.
  const porFolio = await ejecutarHerramienta("buscar_paciente", ctx, { termino: "P0002" });
  assert.equal(porFolio.ok, true);
  if (porFolio.ok) assert.equal(porFolio.datos.resultados.filas[0].paciente, "Beto Munoz");

  // El número copiado de WhatsApp, sin espacios.
  const porTel = await ejecutarHerramienta("buscar_paciente", ctx, { termino: "5598765432" });
  assert.equal(porTel.ok, true);
  if (porTel.ok) assert.equal(porTel.datos.resultados.filas[0].paciente, "Beto Munoz");
});

test("buscar_paciente: devuelve contacto y próxima cita, NUNCA expediente ni saldo", async () => {
  const r = await ejecutarHerramienta("buscar_paciente", adminNorte(base()), { termino: "Ana" });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const p = r.datos.resultados.filas[0];
  assert.deepEqual(Object.keys(p).sort(), [
    "correo",
    "edad",
    "estado",
    "folio",
    "proximaCita",
    "paciente",
    "telefono",
    "ultimaVisita",
  ].sort());
  assert.equal(p.telefono, "+52 55 1234 5678");
  // Ni saldo, ni alergias, ni padecimientos, ni notas, ni el token del portal.
  const json = JSON.stringify(r);
  for (const prohibido of ["saldo", "balance", "allergies", "notes", "portalToken", "curp"]) {
    assert.equal(json.indexOf(prohibido), -1, `el buscador filtró "${prohibido}"`);
  }
});

test("🔴 buscar_paciente: la paciente restringida sólo aparece para quien puede verla", async () => {
  const db = base();

  const admin = await ejecutarHerramienta("buscar_paciente", adminNorte(db), { termino: "Restringida" });
  assert.equal(admin.ok, true);
  if (admin.ok) assert.equal(admin.datos.resultados.total, 1);

  const doc = await ejecutarHerramienta("buscar_paciente", doctorNorte(db), { termino: "Restringida" });
  assert.equal(doc.ok, false, "para el doctor esa paciente no existe");
  assert.equal((doc as any).motivo, "sin_datos");

  const recep = await ejecutarHerramienta("buscar_paciente", recepcionNorte(db), { termino: "Restringida" });
  assert.equal(recep.ok, false, "ni para recepción: la lista concede Y restringe");
});

test("🔴 buscar_paciente: el paciente cancelado por ARCO no se puede encontrar", async () => {
  const r = await ejecutarHerramienta("buscar_paciente", adminNorte(base()), { termino: "Borrado" });
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_datos");
});

test("buscar_paciente: si la consulta normalizada falla, cae al criterio de siempre y lo DICE", async () => {
  // El doble no habla SQL, así que aquí se ejercita justo esa caída: peor que no
  // encontrar a "Pérez" sin acento es no encontrar a nadie.
  const r = await ejecutarHerramienta("buscar_paciente", adminNorte(base()), { termino: "Ana" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.busquedaDegradada, true);
  assert.equal(r.datos.resultados.total, 1, "degradada, pero sigue encontrando");
});

test("buscar_paciente: un término de puros comodines de LIKE no devuelve el padrón", async () => {
  // `%` es comodín en LIKE. Si se dejara pasar, «buscar %» sería «devuélveme
  // todos» — el mismo fallo que el hallazgo 41, por otra puerta.
  const r = await ejecutarHerramienta("buscar_paciente", adminNorte(base()), { termino: "%" });
  assert.equal(
    r.ok === false || (r.ok && r.datos.resultados.total < 10),
    true,
    `un comodín devolvió ${r.ok ? (r as any).datos.resultados.total : 0} pacientes`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * el criterio de la consulta NORMALIZADA (el camino bueno del buscador)
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 la consulta normalizada va acotada por clinicId y sin acentos", () => {
  const tokens = patientSearchTokens("Pérez");
  const sql: any = buildPatientSearchSql({ clinicIds: [CL_NORTE], tokens, limit: 5000 });
  const texto: string = sql.sql;

  // El tenant viaja como PARÁMETRO (no interpolado) y está en el WHERE.
  assert.equal((sql.values as unknown[]).indexOf(CL_NORTE) !== -1, true, "falta el clinicId");
  assert.match(texto, /"clinicId" IN/);
  // Y el paciente cancelado por ARCO queda fuera ya en la consulta.
  assert.match(texto, /"deletedAt" IS NULL/);
  // Sin acentos: `translate(lower(...))`, no `unaccent` — que es una EXTENSIÓN y
  // en esta base no está instalada.
  assert.match(texto, /translate\(lower\(/);
  assert.equal(texto.indexOf("unaccent"), -1);
  // El término llega ya normalizado, así que "Pérez" busca "perez".
  assert.equal((sql.values as unknown[]).indexOf("perez") !== -1, true);
});

test("🔴 el teléfono se compara por dígitos Y por los últimos 10", () => {
  // Ojo: el término se parte por ESPACIOS, así que "+52 55 1234 5678" son cuatro
  // trozos cortos y ninguno llega a 10 dígitos — ahí sólo aplica el `contains`.
  // La vía de los últimos 10 entra con el número pegado, que es como llega
  // copiado de WhatsApp.
  const pegado = buildPatientSearchSql({
    clinicIds: [CL_NORTE],
    tokens: patientSearchTokens("+525512345678"),
    limit: 5000,
  }) as any;
  assert.match(pegado.sql as string, /regexp_replace/, "compara por dígitos");
  assert.match(pegado.sql as string, /right\(/, "y por los últimos 10");
  assert.equal((pegado.values as unknown[]).indexOf("5512345678") !== -1, true);

  const espaciado = buildPatientSearchSql({
    clinicIds: [CL_NORTE],
    tokens: patientSearchTokens("55 1234 5678"),
    limit: 5000,
  }) as any;
  assert.match(espaciado.sql as string, /regexp_replace/, "los trozos cortos van por contains");
});

test("los términos se normalizan igual en los dos lados de la comparación", () => {
  // "Pérez" tecleado encuentra a "Perez" guardado y al contrario, porque el
  // término también pierde el acento antes de comparar.
  const conAcento = patientSearchTokens("Pérez");
  const sinAcento = patientSearchTokens("Perez");
  assert.equal(conAcento[0].text, "perez");
  assert.equal(sinAcento[0].text, "perez");

  // Y el teléfono se compara por sus últimos 10 dígitos, con lada o sin ella.
  const conLada = patientSearchTokens("+525512345678");
  assert.equal(conLada[0].last10, "5512345678");
});
