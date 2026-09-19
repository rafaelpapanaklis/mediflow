/**
 * WS1-T3 · Nota de evolución en la ficha del paciente.
 *
 * Run: npm run test:nota-evolucion-documento
 *
 * Lo que se prueba es lo que puede hacer daño:
 *  · en «Nueva nota» salen SOLO las plantillas NOTA_EVOLUCION de ESA clínica;
 *  · una nota firmada se relee IDÉNTICA aunque cambie la plantilla, la cédula
 *    del doctor o el logo: el documento congela sus datos al firmarse;
 *  · un paciente no ve las notas de otro, ni una clínica las de otra;
 *  · sin logo o sin cédula se puede firmar, pero el aviso dice qué falta — y en
 *    la cabecera el hueco es `null`, nunca un dato inventado;
 *  · lo firmado no se reescribe.
 *
 * El servicio es el REAL (y el saneado y la interpolación de ws1-t1 también).
 * Solo se sustituye la base por una falsa que evalúa el `where` que recibe; un
 * `where` que no sabe evaluar LANZA, así una prueba no pasa por accidente.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createNota,
  getNota,
  getNotaParaEditar,
  listNotas,
  listNotaTemplates,
  previewNota,
  signNota,
  updateNotaDraft,
  type NotaDb,
  type NotaResult,
} from "../_lib/service";

/* ─── la base falsa ────────────────────────────────────────────────────── */

type Fila = Record<string, any>;

let tablas: Record<string, Fila[]> = {};
let secuencia = 0;

function cumple(f: Fila, where: Fila, modelo: string): boolean {
  for (const [clave, esperado] of Object.entries(where ?? {})) {
    if (esperado === undefined) {
      // Es justo el fallo que se quiere cazar: Prisma descarta la clave y no filtra.
      throw new Error(`base falsa: ${modelo}.where.${clave} es undefined (no filtraría nada)`);
    }
    if (esperado !== null && typeof esperado === "object") {
      throw new Error(`base falsa: ${modelo}.where.${clave} no está soportado`);
    }
    if (!(clave in f)) throw new Error(`base falsa: ${modelo} no tiene la columna ${clave}`);
    if (f[clave] !== esperado) return false;
  }
  return true;
}

const copia = <T,>(v: T): T => structuredClone(v);

function modelo(nombre: string) {
  const filas = () => tablas[nombre];
  return {
    findMany: async ({ where, orderBy }: Fila = {}) => {
      const r = filas().filter((f) => cumple(f, where, nombre));
      if (orderBy && !Array.isArray(orderBy) && orderBy.createdAt === "desc") {
        r.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return copia(r);
    },
    findFirst: async ({ where }: Fila = {}) => copia(filas().find((f) => cumple(f, where, nombre)) ?? null),
    findUnique: async ({ where }: Fila) => copia(filas().find((f) => cumple(f, where, nombre)) ?? null),
    create: async ({ data }: Fila) => {
      secuencia += 1;
      const fila = {
        id: `doc_${secuencia}`,
        firmaDoctorUrl: null,
        firmaPacienteUrl: null,
        createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, secuencia)),
        updatedAt: new Date(),
        ...copia(data),
      };
      filas().push(fila);
      return copia(fila);
    },
    updateMany: async ({ where, data }: Fila) => {
      const dianas = filas().filter((f) => cumple(f, where, nombre));
      dianas.forEach((f) => Object.assign(f, copia(data)));
      return { count: dianas.length };
    },
  };
}

const db = {
  patientDocument: modelo("patientDocument"),
  documentTemplate: modelo("documentTemplate"),
  patient: modelo("patient"),
  clinic: modelo("clinic"),
  user: modelo("user"),
} as unknown as NotaDb;

function plantilla(id: string, clinicId: string, kind: string, name: string, extra: Fila = {}): Fila {
  return {
    id, clinicId, kind, name,
    body: "<p>Paciente [NOMBRE_PACIENTE], atendido por [NOMBRE_DOCTOR] el [FECHA].</p>",
    isActive: true, createdById: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    ...extra,
  };
}

beforeEach(() => {
  secuencia = 0;
  tablas = {
    patientDocument: [],
    documentTemplate: [
      plantilla("t_endo", "cA", "NOTA_EVOLUCION", "Endodoncia"),
      plantilla("t_limp", "cA", "NOTA_EVOLUCION", "Limpieza"),
      plantilla("t_cons", "cA", "CONSENTIMIENTO", "Consentimiento general"),
      plantilla("t_off", "cA", "NOTA_EVOLUCION", "Apagada", { isActive: false }),
      plantilla("t_del", "cA", "NOTA_EVOLUCION", "Borrada", { deletedAt: new Date() }),
      plantilla("t_otra", "cB", "NOTA_EVOLUCION", "De otra clínica"),
    ],
    patient: [
      { id: "p1", clinicId: "cA", firstName: "Ana", lastName: "López Ruiz", patientNumber: "0007", dob: new Date("1990-03-10T12:00:00Z") },
      { id: "p2", clinicId: "cA", firstName: "Beto", lastName: "Mora", patientNumber: null },
      { id: "p9", clinicId: "cB", firstName: "Zoe", lastName: "Otra", patientNumber: null },
    ],
    clinic: [
      { id: "cA", name: "Dental Sol", logoUrl: "https://cdn/logo-a.png", timezone: "America/Mexico_City", city: "Mérida" },
      { id: "cB", name: "Otra Clínica", logoUrl: null, timezone: "America/Mexico_City" },
    ],
    user: [
      { id: "dA", clinicId: "cA", isActive: true, firstName: "Laura", lastName: "Pérez", cedulaProfesional: "1234567" },
      { id: "dA2", clinicId: "cA", isActive: true, firstName: "Iván", lastName: "Sin Cédula", cedulaProfesional: null },
      { id: "dB", clinicId: "cB", isActive: true, firstName: "Omar", lastName: "Ajeno", cedulaProfesional: "  " },
    ],
  };
});

// 13 de agosto de 2026, 23:43 en México = 14 de agosto 05:43 UTC.
const NOCHE_MX = new Date("2026-08-14T05:43:00Z");

function valor<T>(r: NotaResult<T>): T {
  if (r.ok === false) throw new Error(`se esperaba ok y falló con ${r.code}`);
  return r.value;
}
function codigo<T>(r: NotaResult<T>): string | null {
  return r.ok === false ? r.code : null;
}

const firmar = (extra: Fila = {}) =>
  createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_endo", sign: true, ...extra }, NOCHE_MX);

/* ─── plantillas de «Nueva nota» ───────────────────────────────────────── */

test("«Nueva nota» ofrece SOLO las plantillas NOTA_EVOLUCION activas de ESA clínica", async () => {
  assert.deepEqual(
    (await listNotaTemplates(db, "cA")).map((t) => t.name).sort(),
    ["Endodoncia", "Limpieza"],
  );
  assert.deepEqual((await listNotaTemplates(db, "cB")).map((t) => t.name), ["De otra clínica"]);
});

test("no se crea una nota con una plantilla de consentimiento, apagada, borrada o de otra clínica", async () => {
  for (const templateId of ["t_cons", "t_off", "t_del", "t_otra", "no_existe"]) {
    const r = await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId }, NOCHE_MX);
    assert.equal(codigo(r), "TEMPLATE_NOT_FOUND", templateId);
    const p = await previewNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId }, NOCHE_MX);
    assert.equal(codigo(p), "TEMPLATE_NOT_FOUND", templateId);
  }
  assert.equal(tablas.patientDocument.length, 0);
});

/* ─── la cabecera sale sola ────────────────────────────────────────────── */

test("la cabecera se arma sola y la fecha es la de la CLÍNICA, no la del servidor", async () => {
  const nota = valor(await firmar());
  assert.deepEqual(nota.encabezado, {
    pacienteNombre: "Ana López Ruiz",
    fecha: "13 de agosto de 2026", // en UTC ya era día 14
    clinicaNombre: "Dental Sol",
    logoUrl: "https://cdn/logo-a.png",
    doctorNombre: "Laura Pérez",
    cedula: "1234567",
  });
  assert.equal(nota.title, "Endodoncia");
  assert.equal(nota.status, "SIGNED");
  assert.equal(nota.body, "<p>Paciente Ana López Ruiz, atendido por Laura Pérez el 13 de agosto de 2026.</p>");
  assert.deepEqual(nota.faltantes, []);
});

test("el texto que escribe el doctor se sanea en el servidor y los datos se escapan", async () => {
  tablas.patient[0].firstName = "<img src=x onerror=alert(1)>";
  const nota = valor(await firmar({
    body: '<p onclick="x()">Dolor en 36 de [NOMBRE_PACIENTE]</p><script>alert(1)</script>',
  }));
  assert.ok(!/<script|<img|onclick/i.test(nota.body), nota.body);
  assert.ok(nota.body.includes("&lt;img"), "el nombre se pinta como texto, no como etiqueta");
  assert.ok(nota.body.includes("Dolor en 36 de"));
});

test("los marcadores de edad, expediente y lugar se rellenan con el dato real, no con un hueco", async () => {
  tablas.documentTemplate[0].body = "<p>[EDAD_PACIENTE] · exp. [EXPEDIENTE_PACIENTE] · [LUGAR] · céd. [CEDULA_DOCTOR]</p>";
  const nota = valor(await firmar());
  assert.equal(nota.body, "<p>36 años · exp. 0007 · Mérida · céd. 1234567</p>");
});

test("una nota más larga de lo que el saneado admite se RECHAZA: nunca se firma truncada", async () => {
  const relleno = '<span style="mso-x:1">a</span>'.repeat(8000); // > 200k de entrada, < 100k ya saneada
  assert.ok(relleno.length > 200_000);
  assert.equal(codigo(await firmar({ body: `<p>${relleno}</p><p>ULTIMA LINEA</p>` })), "BODY_TOO_LONG");
  const borrador = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_endo" }, NOCHE_MX));
  assert.equal(codigo(await signNota(db, "cA", borrador.id, "dA", `<p>${relleno}</p>`, new Date())), "BODY_TOO_LONG");
  assert.equal(tablas.patientDocument.length, 1);
  assert.equal(tablas.patientDocument[0].status, "DRAFT");
});

test("al reabrir un borrador propio, la cabecera y el aviso son los de HOY (los que se van a firmar)", async () => {
  const input = { patientId: "p1", doctorId: "dA2", templateId: "t_endo" };
  const borrador = valor(await createNota(db, "cA", input, NOCHE_MX));
  assert.deepEqual(borrador.faltantes, ["cedula"]);

  tablas.user.find((u) => u.id === "dA2")!.cedulaProfesional = "5550001";
  const hoy = new Date("2026-08-20T18:00:00Z");
  const abierto = (await getNotaParaEditar(db, "cA", borrador.id, "dA2", hoy))!;
  assert.deepEqual(abierto.faltantes, []);
  assert.equal(abierto.encabezado.cedula, "5550001");
  assert.equal(abierto.encabezado.fecha, "20 de agosto de 2026");
  assert.equal(abierto.body, borrador.body);
  // Abrir no guarda nada, y a otro usuario se le enseña lo guardado.
  assert.equal(tablas.patientDocument[0].encabezado.cedula, null);
  assert.deepEqual(await getNotaParaEditar(db, "cA", borrador.id, "dA", hoy), await getNota(db, "cA", borrador.id));

  // Y una FIRMADA jamás se repinta con datos de hoy, ni para su autor.
  const firmada = valor(await signNota(db, "cA", borrador.id, "dA2", undefined, hoy));
  tablas.user.find((u) => u.id === "dA2")!.cedulaProfesional = "0000000";
  assert.deepEqual(await getNotaParaEditar(db, "cA", firmada.id, "dA2", new Date("2027-01-01T18:00:00Z")), firmada);
});

test("una nota vacía no se guarda", async () => {
  assert.equal(codigo(await firmar({ body: "<p>  </p><br>" })), "BODY_REQUIRED");
});

/* ─── lo firmado dice lo que decía ─────────────────────────────────────── */

test("una nota firmada se relee idéntica después de cambiar o borrar la plantilla original", async () => {
  const firmada = valor(await firmar());
  const t = tablas.documentTemplate.find((x) => x.id === "t_endo")!;
  t.name = "Endodoncia v2";
  t.body = "<p>Texto nuevo</p>";
  assert.deepEqual(await getNota(db, "cA", firmada.id), firmada);

  t.deletedAt = new Date();
  tablas.patientDocument[0].templateId = null; // lo que hace onDelete: SetNull
  assert.deepEqual(await getNota(db, "cA", firmada.id), firmada);
  assert.equal((await listNotas(db, "cA", "p1"))[0].title, "Endodoncia");
});

test("una nota firmada se relee idéntica después de cambiar la cédula, el nombre del doctor o el logo", async () => {
  const firmada = valor(await firmar());
  const doctor = tablas.user.find((u) => u.id === "dA")!;
  doctor.cedulaProfesional = "9999999";
  doctor.lastName = "Pérez de Gómez";
  tablas.clinic[0].logoUrl = "https://cdn/logo-nuevo.png";
  tablas.patient[0].lastName = "Casada";

  const releida = await getNota(db, "cA", firmada.id);
  assert.deepEqual(releida, firmada);
  assert.equal(releida!.encabezado.cedula, "1234567");
  assert.equal((await listNotas(db, "cA", "p1"))[0].doctorNombre, "Laura Pérez");
});

test("lo firmado no se edita ni se vuelve a firmar", async () => {
  const firmada = valor(await firmar());
  assert.equal(codigo(await updateNotaDraft(db, "cA", firmada.id, "dA", "<p>otra cosa</p>", new Date())), "ALREADY_SIGNED");
  assert.equal(codigo(await signNota(db, "cA", firmada.id, "dA", "<p>otra cosa</p>", new Date())), "ALREADY_SIGNED");
  assert.deepEqual(await getNota(db, "cA", firmada.id), firmada);
});

test("un borrador lo edita y lo firma solo su autor, y al firmar congela los datos de ESE momento", async () => {
  const borrador = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_endo" }, NOCHE_MX));
  assert.equal(borrador.status, "DRAFT");
  assert.equal(borrador.signedAt, null);

  assert.equal(codigo(await updateNotaDraft(db, "cA", borrador.id, "dA2", "<p>intruso</p>", new Date())), "NOT_AUTHOR");
  assert.equal(codigo(await signNota(db, "cA", borrador.id, "dA2", undefined, new Date())), "NOT_AUTHOR");

  // Corrige su cédula ANTES de firmar: la nota lleva la corregida.
  tablas.user.find((u) => u.id === "dA")!.cedulaProfesional = "7654321";
  const firmada = valor(await signNota(db, "cA", borrador.id, "dA", "<p>Evolución favorable.</p>", new Date("2026-08-15T18:00:00Z")));
  assert.equal(firmada.status, "SIGNED");
  assert.equal(firmada.body, "<p>Evolución favorable.</p>");
  assert.equal(firmada.encabezado.cedula, "7654321");
  assert.equal(firmada.encabezado.fecha, "15 de agosto de 2026");
});

/* ─── aislamiento ──────────────────────────────────────────────────────── */

test("un paciente no ve las notas de otro, ni una clínica las de otra", async () => {
  const deAna = valor(await firmar());
  valor(await createNota(db, "cA", { patientId: "p2", doctorId: "dA", templateId: "t_limp", sign: true }, NOCHE_MX));
  valor(await createNota(db, "cB", { patientId: "p9", doctorId: "dB", templateId: "t_otra", sign: true }, NOCHE_MX));

  assert.deepEqual((await listNotas(db, "cA", "p1")).map((n) => n.id), [deAna.id]);
  assert.deepEqual((await listNotas(db, "cA", "p2")).map((n) => n.title), ["Limpieza"]);
  // Mismo id de paciente pedido desde otra clínica: nada.
  assert.deepEqual(await listNotas(db, "cB", "p1"), []);
  assert.equal(await getNota(db, "cB", deAna.id), null);
  assert.equal(codigo(await signNota(db, "cB", deAna.id, "dB", undefined, new Date())), "NOT_FOUND");
});

test("no se crea una nota sobre un paciente de otra clínica ni con un doctor de otra clínica", async () => {
  assert.equal(codigo(await createNota(db, "cA", { patientId: "p9", doctorId: "dA", templateId: "t_endo" }, NOCHE_MX)), "PATIENT_NOT_FOUND");
  assert.equal(codigo(await createNota(db, "cA", { patientId: "p1", doctorId: "dB", templateId: "t_endo" }, NOCHE_MX)), "DOCTOR_NOT_FOUND");
  assert.equal(tablas.patientDocument.length, 0);
});

test("las notas salen de la más nueva a la más vieja, y un consentimiento de la misma tabla no se cuela", async () => {
  valor(await firmar());
  valor(await firmar({ templateId: "t_limp" }));
  tablas.patientDocument.push({
    ...copia(tablas.patientDocument[0]), id: "doc_consent", kind: "CONSENTIMIENTO", title: "Consentimiento",
    createdAt: new Date(Date.UTC(2026, 8, 2)),
  });
  assert.deepEqual((await listNotas(db, "cA", "p1")).map((n) => n.title), ["Limpieza", "Endodoncia"]);
  assert.equal(await getNota(db, "cA", "doc_consent"), null);
});

test("sin clinicId o sin patientId se corta ANTES de consultar", async () => {
  await assert.rejects(() => listNotas(db, "", "p1"), /clinicId ausente/);
  await assert.rejects(() => listNotas(db, undefined as unknown as string, "p1"), /clinicId ausente/);
  await assert.rejects(() => listNotas(db, "cA", ""), /patientId ausente/);
  await assert.rejects(() => getNota(db, "", "doc_1"), /clinicId ausente/);
});

/* ─── sin logo o sin cédula ────────────────────────────────────────────── */

test("sin cédula y sin logo: el aviso dice QUÉ falta antes de firmar, y aun así se puede firmar", async () => {
  tablas.clinic[0].logoUrl = "   ";
  const input = { patientId: "p1", doctorId: "dA2", templateId: "t_endo" };

  const previa = valor(await previewNota(db, "cA", input, NOCHE_MX));
  assert.deepEqual(previa.faltantes, ["cedula", "logo"]);
  assert.equal(tablas.patientDocument.length, 0, "previsualizar no guarda nada");

  const nota = valor(await createNota(db, "cA", { ...input, sign: true }, NOCHE_MX));
  assert.equal(nota.status, "SIGNED");
  // El hueco es null: quien pinta omite la línea. Nunca "N/A", "—" ni "S/N".
  assert.equal(nota.encabezado.cedula, null);
  assert.equal(nota.encabezado.logoUrl, null);
  assert.deepEqual(nota.faltantes, ["cedula", "logo"]);
});

test("solo falta una cosa: el aviso nombra esa y no la otra", async () => {
  const sinCedula = valor(await previewNota(db, "cA", { patientId: "p1", doctorId: "dA2", templateId: "t_endo" }, NOCHE_MX));
  assert.deepEqual(sinCedula.faltantes, ["cedula"]);
  tablas.clinic[0].logoUrl = null;
  const sinLogo = valor(await previewNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_endo" }, NOCHE_MX));
  assert.deepEqual(sinLogo.faltantes, ["logo"]);
});

/* ─── la pantalla y el menú ────────────────────────────────────────────── */

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

test("la opción está en la sección Clínico de la ficha, sin bandera que la apague", () => {
  const nav = leer("src/components/dashboard/patient-detail/patient-nav-items.ts");
  const linea = nav.split("\n").find((l) => l.includes('id: "nota-evolucion"'));
  assert.ok(linea, "falta el ítem nota-evolucion");
  assert.ok(linea!.includes('section: "clinico"'));
  assert.ok(linea!.includes('labelKey: "patients.tabs.notaEvolucion"'));
});

test("es.json y en.json tienen las mismas claves de la pantalla, y ninguna vacía", () => {
  const hojas = (o: any, pre = ""): string[] =>
    Object.keys(o).flatMap((k) => (typeof o[k] === "object" ? hojas(o[k], `${pre}${k}.`) : [`${pre}${k}`]));
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.ok(es.notaEvolucionDoc && en.notaEvolucionDoc);
  assert.deepEqual(hojas(es.notaEvolucionDoc).sort(), hojas(en.notaEvolucionDoc).sort());
  for (const d of [es, en]) {
    assert.ok(d.patients.tabs.notaEvolucion);
    hojas(d.notaEvolucionDoc).forEach((k) => {
      const v = k.split(".").reduce((o: any, p) => o[p], d.notaEvolucionDoc);
      assert.ok(typeof v === "string" && v.trim(), k);
    });
  }
});

test("el aviso enlaza a donde se rellena lo que falta: Equipo (cédula) y Configuración (logo)", () => {
  const panel = leer("src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx");
  assert.ok(panel.includes('"/dashboard/team"'));
  assert.ok(panel.includes('"/dashboard/settings"'));
  assert.ok(panel.startsWith('"use client";'));
});
