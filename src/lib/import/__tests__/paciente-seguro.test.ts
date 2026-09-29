/**
 * ws1-t12 — ¿A QUÉ paciente va cada fila? Regla de Rafael: si el ID del sistema de origen no alcanza, se desempata con
 * TODOS los datos de la fila (nombre completo, teléfono, correo, fecha de nacimiento, CURP) y solo se asigna con 2 datos
 * fuertes de UN candidato; un nombre solo, un teléfono de familia o un empate van «a revisar». Y el ID de un duplicado
 * omitido al importar pacientes se recuerda apuntando al paciente que se quedó (solo si es la misma persona).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/paciente-seguro.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const DUENO = "u_dueno";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
    user: [{ id: DUENO, clinicId: CLINICA, firstName: "Ana", lastName: "Dueña", role: "SUPER_ADMIN", isActive: true }],
    patient: [], importExternalIds: [], appointment: [], invoice: [], payment: [], quote: [], guardian: [],
  };
}
let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");
const seguro = () => import("../dentalink/paciente-seguro");
const csv = (t: string) => new File(["﻿" + t], "archivo.csv", { type: "text/csv" });
async function correr(entidad: string, file: File, dryRun = true): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], { file, clinicId: CLINICA, userId: DUENO, role: "SUPER_ADMIN", dryRun, skipDuplicates: true, origin: "dentalink", valueMapping: null });
}
const tabla = (m: string) => base.tablas[m] ?? [];
const externos = () => tabla("importExternalIds").filter((e) => e.entity === "patient");
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

// ───────────────────────── Parte pura ─────────────────────────

const ficha = (id: string, nombre: string, extra: Partial<{ tel: string; email: string; dob: string; doc: string }> = {}) => ({ id, nombre, tel: "", email: "", dob: "", doc: "", ...extra });
const dato = (nombre: string, extra: Partial<{ tel: string; email: string; dob: string; doc: string }> = {}) => ({ nombre, tel: "", email: "", dob: "", doc: "", ...extra });

test("nombre completo: las palabras de uno están en el otro y comparten al menos dos", async () => {
  const { mismoNombreCompleto: m } = await seguro();
  assert.equal(m("Guadalupe Ortiz", "María Guadalupe Ortiz Villagómez"), true);
  assert.equal(m("MARÍA LÓPEZ", "maria lopez"), true);
  assert.equal(m("Guadalupe", "Guadalupe Ortiz"), false, "un nombre de pila solo no es un nombre completo");
  assert.equal(m("María López", "María Pérez"), false);
  assert.equal(m("Juan Pérez", "Juana Pérez"), false);
});

test("2 datos fuertes de UN candidato → seguro y dice por qué; un dato solo o un empate → a revisar", async () => {
  const { emparejarPorDatos: e } = await seguro();
  const juan = ficha("p1", "Juan Pérez", { tel: "5551110000", email: "j@x.mx", dob: "1990-1-5" });
  const mama = ficha("p2", "María Pérez", { tel: "5551110000" }); // el celular de la familia
  // nombre + teléfono
  assert.deepEqual(e(dato("Juan Pérez", { tel: "5551110000" }), [juan, mama]), { tipo: "seguro", id: "p1", por: ["nombre", "teléfono"] });
  // nombre + fecha de nacimiento (el teléfono cambió)
  assert.deepEqual(e(dato("Juan Pérez", { tel: "5559998888", dob: "1990-1-5" }), [juan]), { tipo: "seguro", id: "p1", por: ["nombre", "fecha de nacimiento"] });
  // correo + cédula exactos, sin nombre
  const conCurp = ficha("p3", "Otro Nombre", { email: "z@x.mx", doc: "ABCD900101HDFRRN09" });
  assert.deepEqual(e(dato("", { email: "z@x.mx", doc: "ABCD900101HDFRRN09" }), [conCurp]), { tipo: "seguro", id: "p3", por: ["correo", "cédula/CURP"] });
  // solo el teléfono compartido: NO basta
  const soloTel = e(dato("Luis Pérez", { tel: "5551110000" }), [juan, mama]);
  assert.equal(soloTel.tipo, "revisar");
  assert.match((soloTel as any).motivo, /solo coincide el teléfono \(2 pacientes\)/);
  // solo el nombre: NO basta (puede ser un homónimo)
  const soloNombre = e(dato("Juan Pérez"), [juan]);
  assert.equal(soloNombre.tipo, "revisar");
  assert.match((soloNombre as any).motivo, /solo coincide el nombre/);
  // sin ningún candidato
  assert.deepEqual(e(dato("Nadie"), []), { tipo: "ninguno" });
});

test("dos candidatos igual de buenos → empate, a revisar; una fecha o cédula distinta descarta al candidato", async () => {
  const { emparejarPorDatos: e } = await seguro();
  const a = ficha("a", "Ana López", { tel: "5550001111" });
  const b = ficha("b", "Ana López", { tel: "5550001111" }); // homónima con el mismo teléfono
  const empate = e(dato("Ana López", { tel: "5550001111" }), [a, b]);
  assert.equal(empate.tipo, "revisar");
  assert.equal((empate as any).candidatos.length, 2);
  assert.match((empate as any).motivo, /empate/);
  // Con la fecha de nacimiento de la fila, una se descarta y la otra queda clara.
  const a2 = { ...a, dob: "2001-3-3" }, b2 = { ...b, dob: "1975-8-9" };
  assert.deepEqual(e(dato("Ana López", { tel: "5550001111", dob: "1975-8-9" }), [a2, b2]), { tipo: "seguro", id: "b", por: ["nombre", "teléfono", "fecha de nacimiento"] });
  // Misma cédula distinta = otra persona aunque compartan nombre y teléfono.
  const c = ficha("c", "Ana López", { tel: "5550001111", doc: "AAAA000101MDFRRN01" });
  const cedula = e(dato("Ana López", { tel: "5550001111", doc: "BBBB000101MDFRRN02" }), [c]);
  assert.equal(cedula.tipo, "revisar", "coincide nombre y teléfono pero la CURP es otra: lo mira una persona, no se asigna solo");
  assert.match((cedula as any).motivo, /coincide en nombre \+ teléfono con un paciente, pero su cédula\/CURP es distinta/);
  // Sin la fecha de nacimiento de la ficha no hay contradicción posible.
  assert.equal(e(dato("Ana López", { tel: "5550001111", dob: "1999-1-1" }), [a]).tipo, "seguro");
  // Nombre + correo iguales pero la fecha de nacimiento difiere (un dato mal capturado o un homónimo): a revisar, diciendo cuál no cuadra.
  const hijo = ficha("h", "Benjamín Ruiz Soto", { email: "familia@x.mx", dob: "2006-9-4" });
  const distinta = e(dato("Benjamín Ruiz Soto", { email: "familia@x.mx", dob: "2006-7-4" }), [hijo]);
  assert.equal(distinta.tipo, "revisar");
  assert.match((distinta as any).motivo, /coincide en nombre \+ correo con un paciente, pero su fecha de nacimiento es distinta/);
});

// ───────────────────────── Por el motor: filas con un ID que no está importado ─────────────────────────

const PACIENTES = "# Paciente,Nombre,Apellidos,Celular,E-Mail,Fecha de nac.";
const CITAS = "# Paciente,Nombre Paciente,Apellidos Paciente,Celular,E-Mail,Fecha de nac.,Fecha Cita,Hora Inicio Cita,Hora Fin Cita,Nombre Profesional Cita";
const cita = (id: string, n: string, a: string, cel: string, mail = "", dob = "") => `${id},${n},${a},${cel},${mail},${dob},2030-10-05,09:00:00,09:30:00,Ana Dueña`;

test("a QUIÉN va una fila con ID que no existe: por ID, por 2 datos (con el motivo), o a revisar — nunca por un solo dato", async () => {
  base = crearBase(semilla());
  await correr("patients", csv([PACIENTES,
    "10,María,López Ruiz,5551110001,maria@x.mx,1980-04-02",
    "11,María,López Ruiz,5551110002,,1995-07-07", // homónima con otro teléfono y otra fecha: paciente aparte
    "12,Pedro,Gómez,5552220000,,",                 // comparte celular con su mamá
    "13,Rosa,Gómez,5552220000,,",
  ].join("\n") + "\n"), false);
  assert.equal(tabla("patient").length, 4);
  const cit = await correr("appointments", csv([CITAS,
    cita("10", "María", "López Ruiz", "5551110001"),                   // 2: por ID
    cita("900", "María", "López Ruiz", "5551110001"),                  // 3: ID nuevo, nombre + teléfono de UNA → seguro
    cita("901", "María", "López Ruiz", ""),                            // 4: solo el nombre y hay dos homónimas → a revisar
    cita("902", "María", "López Ruiz", "", "", "1995-07-07"),          // 5: nombre + fecha de nacimiento → la homónima 11
    cita("903", "Luis", "Gómez", "5552220000"),                        // 6: celular de la familia y otro nombre → a revisar
    cita("904", "Rosa", "Gómez", "5552220000"),                        // 7: nombre + teléfono compartido → Rosa
    cita("905", "", "", "5552220000"),                                 // 8: solo el teléfono compartido → a revisar
    cita("906", "Nadie", "Conocido", "5550000000"),                    // 9: sin candidato
  ].join("\n") + "\n"));
  const idDe = (n: string) => tabla("patient").find((p) => p.firstName === n.split(" ")[0] && (n.includes("Ruiz2") ? p.phone === "5551110002" : true))?.id;
  const maria = tabla("patient").find((p) => p.phone === "5551110001")!.id;
  const maria2 = tabla("patient").find((p) => p.phone === "5551110002")!.id;
  const rosa = tabla("patient").find((p) => p.firstName === "Rosa")!.id;
  assert.equal(fila(cit, 2).data.patientId, maria);
  assert.deepEqual(fila(cit, 2).warnings.filter((w: string) => /no existe/.test(w)), []);
  assert.equal(fila(cit, 3).data.patientId, maria);
  assert.match(fila(cit, 3).warnings.join(" "), /El ID 900 no existe.*se emparejó por nombre \+ teléfono con «María López Ruiz»/);
  assert.equal(fila(cit, 4).status, "error");
  assert.match(fila(cit, 4).errors.join(" "), /A revisar.*900|A revisar.*901.*solo coincide el nombre \(2 pacientes\)/);
  assert.equal(fila(cit, 5).data.patientId, maria2);
  assert.match(fila(cit, 5).warnings.join(" "), /por nombre \+ fecha de nacimiento/);
  assert.equal(fila(cit, 6).status, "error");
  assert.match(fila(cit, 6).errors.join(" "), /A revisar.*903.*solo coincide el teléfono/);
  assert.equal(fila(cit, 7).data.patientId, rosa);
  assert.match(fila(cit, 7).warnings.join(" "), /por nombre \+ teléfono/);
  assert.equal(fila(cit, 8).status, "error");
  assert.match(fila(cit, 8).errors.join(" "), /A revisar.*905/);
  assert.equal(fila(cit, 9).status, "error");
  assert.match(fila(cit, 9).errors.join(" "), /Paciente con ID 906 no encontrado/);
  void idDe;
});

test("mismo nombre y correo pero otra fecha de nacimiento: no se asigna solo, dice qué no cuadra", async () => {
  base = crearBase(semilla());
  await correr("patients", csv([PACIENTES, "64,Benjamín,Ruiz Soto,5551110040,familia@x.mx,2006-09-04", "233,Angela,Ruiz,5551110041,familia@x.mx,1975-08-29"].join("\n") + "\n"), false);
  const cit = await correr("appointments", csv([CITAS, cita("1", "Benjamín", "Ruiz Soto", "5559990000", "familia@x.mx", "2006-07-04")].join("\n") + "\n"));
  assert.equal(fila(cit, 2).status, "error");
  assert.match(fila(cit, 2).errors.join(" "), /A revisar: el ID 1 .*coincide en nombre \+ correo con un paciente, pero su fecha de nacimiento es distinta/);
  // Con la misma fecha sí es él: nombre + correo + fecha.
  const igual = await correr("appointments", csv([CITAS, cita("1", "Benjamín", "Ruiz Soto", "5559990000", "familia@x.mx", "2006-09-04")].join("\n") + "\n"));
  assert.equal(fila(igual, 2).status, "ok");
  assert.match(fila(igual, 2).warnings.join(" "), /por nombre \+ correo \+ fecha de nacimiento/);
});

test("los mismos criterios en saldos y en el historial de citas", async () => {
  base = crearBase(semilla());
  await correr("patients", csv([PACIENTES, "10,María,López Ruiz,5551110001,maria@x.mx,1980-04-02", "12,Pedro,Gómez,5552220000,,"].join("\n") + "\n"), false);
  const saldos = await correr("balances", csv("# Tratamiento,Paciente,Nombre Paciente,Apellidos Paciente,Celular,Mora\n1,910,María,López Ruiz,5551110001,600\n2,911,María,López Ruiz,,600\n3,912,Luis,Gómez,5552220000,600\n"));
  assert.match(fila(saldos, 2).warnings.join(" "), /por nombre \+ teléfono/);
  assert.equal(fila(saldos, 3).status, "error");
  assert.match(fila(saldos, 3).errors.join(" "), /A revisar/);
  assert.equal(fila(saldos, 4).status, "error");
  const hist = await correr("appointmentHistory", csv("# Paciente,Nombre Paciente,Apellidos Paciente,Celular,Fecha Cita,Hora Inicio Cita,Hora Fin Cita,Nombre Profesional Cita,Estado Cita\n913,María,López Ruiz,5551110001,2026-01-05,09:00:00,10:00:00,Ana Dueña,Atendido\n914,María,López Ruiz,,2026-01-06,09:00:00,10:00:00,Ana Dueña,Atendido\n"));
  assert.match(fila(hist, 2).warnings.join(" "), /por nombre \+ teléfono/);
  assert.equal(fila(hist, 3).status, "error");
  assert.match(fila(hist, 3).errors.join(" "), /A revisar/);
});

// ───────────────────────── Los duplicados omitidos de «Pacientes» recuerdan su ID ─────────────────────────

test("un duplicado omitido (la misma persona) recuerda su ID apuntando al paciente que se quedó; un teléfono de familia NO", async () => {
  base = crearBase(semilla());
  const archivo = () => csv([PACIENTES,
    "20,Guadalupe,Ortiz,5553330000,,",                                   // se queda
    "21,María Guadalupe,Ortiz Villagómez,5553330000,,",                  // misma persona (nombre completo + teléfono): duplicado
    "22,Omar,López Bernabé,5554440000,,2002-02-05",                      // se queda
    "23,Omar,López Bernabé,5554449999,,2002-02-05",                      // mismo nombre y fecha con otro teléfono: duplicado
    "24,Rosa,Ortiz,5553330000,,",                                        // celular de la familia: paciente APARTE
  ].join("\n") + "\n");
  const prev = await correr("patients", archivo());
  assert.equal(prev.validos, 3);
  assert.equal(prev.duplicados, 2);
  assert.match(fila(prev, 3).warnings.join(" "), /Su ID 21 se recordará como el de este mismo paciente \(coinciden nombre \+ teléfono\)/);
  assert.match(fila(prev, 5).warnings.join(" "), /coinciden nombre \+ fecha de nacimiento/);
  assert.equal(fila(prev, 6).status, "ok", "la familia con otro nombre no es duplicado");
  await correr("patients", archivo(), false);
  assert.equal(tabla("patient").length, 3);
  const idDe = (ext: string) => externos().find((e) => e.externalId === ext)?.localId;
  assert.equal(idDe("21"), idDe("20"), "el ID del duplicado apunta al paciente que se quedó");
  assert.equal(idDe("23"), idDe("22"));
  assert.notEqual(idDe("24"), idDe("20"), "la familia es otro paciente");
  assert.equal(externos().length, 5);
});

test("reimportar «Pacientes» ya importados registra los ID de los duplicados omitidos SIN duplicar a nadie (BEVADENT)", async () => {
  base = crearBase(semilla());
  // Como quedó BEVADENT: el archivo entró y los duplicados se omitieron sin recordar su ID.
  await correr("patients", csv([PACIENTES, "20,Guadalupe,Ortiz,5553330000,,", "22,Omar,López Bernabé,5554440000,,2002-02-05", "24,Rosa,Ortiz,5553330000,,"].join("\n") + "\n"), false);
  assert.equal(externos().length, 3);
  const completo = () => csv([PACIENTES,
    "20,Guadalupe,Ortiz,5553330000,,", "21,María Guadalupe,Ortiz Villagómez,5553330000,,",
    "22,Omar,López Bernabé,5554440000,,2002-02-05", "23,Omar,López Bernabé,5554449999,,2002-02-05", "24,Rosa,Ortiz,5553330000,,",
  ].join("\n") + "\n");
  const prev = await correr("patients", completo());
  assert.deepEqual([prev.validos, prev.duplicados], [0, 2]);
  const res = await correr("patients", completo(), false);
  assert.equal(res.created, 0);
  assert.equal(tabla("patient").length, 3, "nadie se duplica");
  assert.equal(externos().length, 5, "y los dos ID omitidos ya están recordados");
  const idDe = (ext: string) => externos().find((e) => e.externalId === ext)?.localId;
  assert.equal(idDe("21"), idDe("20"));
  assert.equal(idDe("23"), idDe("22"));
  // Repetir otra vez no cambia nada.
  await correr("patients", completo(), false);
  assert.equal(externos().length, 5);
  // Y ahora una cita con ese ID llega a su paciente POR ID, sin aviso.
  const cit = await correr("appointments", csv([CITAS, cita("21", "María Guadalupe", "Ortiz Villagómez", "5553330000")].join("\n") + "\n"));
  assert.equal(fila(cit, 2).data.patientId, idDe("20"));
  assert.deepEqual(fila(cit, 2).warnings.filter((w: string) => /no existe/.test(w)), []);
});
