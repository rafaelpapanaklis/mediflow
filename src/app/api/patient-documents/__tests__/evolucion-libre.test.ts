/**
 * WS1-T1 · La evolución que se puede escribir en blanco.
 *
 * Run: npm run test:evolucion-libre
 *
 * El ticket (cliente del 19-sep-2026): «al intentar registrar una evolución me
 * envía a Plantillas. Necesitamos poder escribir una evolución libre en cada
 * consulta y usar una plantilla únicamente cuando sea conveniente».
 *
 * Estas pruebas FALLAN si alguien vuelve a poner el peaje:
 *  · se crea y se FIRMA una nota sin `templateId`, y se relee idéntica;
 *  · una clínica SIN ninguna plantilla escribe notas: no hay callejón;
 *  · elegir una plantilla con texto ya escrito NO lo pisa;
 *  · el HTML se sigue saneando: `<script>` y `onclick=` no se guardan;
 *  · una nota libre firmada sale bien en el PDF y al imprimirla.
 *
 * El servicio, el saneado y el PDF son los REALES. Solo la base es falsa, y un
 * `where` que no sabe evaluar LANZA: una prueba no pasa por accidente.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createNota,
  getNota,
  getNotaParaEditar,
  limpiarTitulo,
  listNotas,
  listNotaTemplates,
  previewNota,
  signNota,
  tituloPorDefecto,
  updateNotaDraft,
  MAX_TITLE_LENGTH,
  type NotaDb,
  type NotaResult,
} from "../_lib/service";
import { notaParaPdf } from "../_lib/nota-pdf";
import { combinarConPlantilla } from "@/lib/patient-documents/combinar-plantilla";
import { renderizarPdf } from "@/lib/patient-documents/pdf";
import { htmlATexto } from "@/lib/patient-documents/html-a-bloques";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";

/* ─── la base falsa ────────────────────────────────────────────────────── */

type Fila = Record<string, any>;

let tablas: Record<string, Fila[]> = {};
let secuencia = 0;
/** Cuántas veces se consultó la tabla de plantillas. Una nota libre: cero. */
let consultasDePlantilla = 0;

function cumple(f: Fila, where: Fila, modelo: string): boolean {
  for (const [clave, esperado] of Object.entries(where ?? {})) {
    if (esperado === undefined) {
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
  const filas = () => {
    if (nombre === "documentTemplate") consultasDePlantilla += 1;
    return tablas[nombre];
  };
  return {
    findMany: async ({ where }: Fila = {}) => copia(filas().filter((f) => cumple(f, where, nombre))),
    findFirst: async ({ where }: Fila = {}) => copia(filas().find((f) => cumple(f, where, nombre)) ?? null),
    findUnique: async ({ where }: Fila) => copia(filas().find((f) => cumple(f, where, nombre)) ?? null),
    create: async ({ data }: Fila) => {
      secuencia += 1;
      const fila = {
        id: `doc_${secuencia}`,
        createdAt: new Date(Date.UTC(2026, 8, 20, 12, 0, secuencia)),
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

const PLANTILLA_ORTO = {
  id: "t_orto", clinicId: "cA", kind: "NOTA_EVOLUCION", name: "Control de ortodoncia",
  body: "<p>Control de [NOMBRE_PACIENTE]. Se cambia arco.</p>",
  isActive: true, createdById: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
};

beforeEach(() => {
  secuencia = 0;
  consultasDePlantilla = 0;
  tablas = {
    patientDocument: [],
    // cA tiene una plantilla; cSIN no tiene NINGUNA (el callejón del ticket).
    documentTemplate: [copia(PLANTILLA_ORTO)],
    patient: [
      { id: "p1", clinicId: "cA", firstName: "Ana", lastName: "López", patientNumber: "0007", dob: null, curp: null, curpStatus: null },
      { id: "p5", clinicId: "cSIN", firstName: "Saúl", lastName: "Nuevo", patientNumber: "0001", dob: null, curp: null, curpStatus: null },
    ],
    clinic: [
      { id: "cA", name: "Dental Sol", logoUrl: null, timezone: "America/Mexico_City", city: "Mérida", address: "Calle 60 #123", state: "Yucatán", phone: null },
      { id: "cSIN", name: "Clínica Recién Llegada", logoUrl: null, timezone: "America/Mexico_City", city: null, address: null, state: null, phone: null },
    ],
    user: [
      { id: "dA", clinicId: "cA", isActive: true, firstName: "Laura", lastName: "Pérez", cedulaProfesional: "1234567", especialidad: "Ortodoncia", cedulaEspecialidad: null },
      { id: "dS", clinicId: "cSIN", isActive: true, firstName: "Sara", lastName: "Sola", cedulaProfesional: "7654321", especialidad: null, cedulaEspecialidad: null },
    ],
  };
});

// 19 de septiembre de 2026, 18:00 en México.
const TARDE = new Date("2026-09-20T00:00:00Z");
const DIA_SIGUIENTE = new Date("2026-09-21T00:00:00Z");

function valor<T>(r: NotaResult<T>): T {
  if (r.ok === false) throw new Error(`se esperaba ok y falló con ${r.code}`);
  return r.value;
}
const codigo = <T,>(r: NotaResult<T>): string | null => (r.ok === false ? r.code : null);

const LIBRE = "<p>Acude a control. Se cambia arco superior a 0.016 NiTi. Cita en 4 semanas.</p>";

/* ─── sin plantilla: crear, firmar, releer ─────────────────────────────── */

test("se crea y se FIRMA una nota SIN templateId, y se relee idéntica", async () => {
  const firmada = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE, sign: true }, TARDE));
  assert.equal(firmada.status, "SIGNED");
  assert.equal(firmada.body, LIBRE);
  assert.equal(tablas.patientDocument[0].templateId, null, "una nota libre se guarda con templateId = null");
  assert.equal(consultasDePlantilla, 0, "una nota libre no consulta ninguna plantilla");

  // Cambia TODO alrededor: la nota firmada es la foto y no se mueve.
  tablas.user[0].cedulaProfesional = "0000000";
  tablas.clinic[0].name = "Otro Nombre";
  tablas.documentTemplate.length = 0;
  const releida = await getNota(db, "cA", firmada.id);
  assert.deepEqual(releida, firmada);
});

test("borrador libre → se edita → se firma, todo sin plantilla", async () => {
  const borrador = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE }, TARDE));
  assert.equal(borrador.status, "DRAFT");
  const editado = valor(await updateNotaDraft(db, "cA", borrador.id, "dA", `${LIBRE}<p>Sin molestias.</p>`, TARDE));
  assert.ok(editado.body.includes("Sin molestias."));
  const firmada = valor(await signNota(db, "cA", borrador.id, "dA", undefined, TARDE));
  assert.equal(firmada.status, "SIGNED");
  assert.equal(firmada.body, editado.body);
  assert.equal(consultasDePlantilla, 0);
});

test("sin plantilla Y sin texto no hay nota: BODY_REQUIRED, no una fila vacía", async () => {
  assert.equal(codigo(await createNota(db, "cA", { patientId: "p1", doctorId: "dA" }, TARDE)), "BODY_REQUIRED");
  assert.equal(codigo(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: "<p> </p>" }, TARDE)), "BODY_REQUIRED");
  assert.equal(tablas.patientDocument.length, 0);
});

test("una plantilla NOMBRADA que no vale sigue siendo un error: no se convierte en nota libre a escondidas", async () => {
  for (const templateId of ["no-existe", "t_de_otra_clinica"]) {
    const r = await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId, body: LIBRE }, TARDE);
    assert.equal(codigo(r), "TEMPLATE_NOT_FOUND");
  }
});

/* ─── una clínica sin plantillas ───────────────────────────────────────── */

test("una clínica SIN ninguna plantilla abre la hoja en blanco, escribe y firma: no hay callejón", async () => {
  assert.deepEqual(await listNotaTemplates(db, "cSIN"), []);

  const hoja = valor(await previewNota(db, "cSIN", { patientId: "p5", doctorId: "dS" }, TARDE));
  assert.equal(hoja.templateId, null);
  assert.equal(hoja.body, "");
  assert.equal(hoja.encabezado.pacienteNombre, "Saúl Nuevo");
  assert.equal(hoja.encabezado.doctorNombre, "Sara Sola");
  assert.ok(hoja.tituloPorDefecto.trim());

  const firmada = valor(await createNota(db, "cSIN", { patientId: "p5", doctorId: "dS", body: LIBRE, sign: true }, TARDE));
  assert.equal(firmada.status, "SIGNED");
  assert.equal((await listNotas(db, "cSIN", "p5")).length, 1);
  // Y no se cuela en la otra clínica.
  assert.equal(await getNota(db, "cA", firmada.id), null);
});

test("la hoja en blanco no consulta la tabla de plantillas", async () => {
  valor(await previewNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: null }, TARDE));
  valor(await previewNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "" }, TARDE));
  assert.equal(consultasDePlantilla, 0);
});

/* ─── el título ────────────────────────────────────────────────────────── */

test("el título NUNCA queda vacío: el del doctor, o el de la plantilla, o «Nota de evolución» con su fecha", async () => {
  const sin = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE }, TARDE));
  assert.equal(sin.title, `Nota de evolución · ${sin.encabezado.fecha}`);
  assert.ok(sin.encabezado.fecha.includes("19 de septiembre de 2026"), "la fecha es la de la CLÍNICA");

  const espacios = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE, title: "   \n " }, TARDE));
  assert.equal(espacios.title, sin.title);

  const propio = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE, title: "  Control   mensual\n#4 " }, TARDE));
  assert.equal(propio.title, "Control mensual #4");

  const dePlantilla = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_orto", body: LIBRE }, TARDE));
  assert.equal(dePlantilla.title, "Control de ortodoncia");
  assert.equal(tablas.patientDocument.at(-1)!.templateId, "t_orto");

  const gana = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_orto", body: LIBRE, title: "Urgencia" }, TARDE));
  assert.equal(gana.title, "Urgencia", "lo que escribe el doctor manda sobre el nombre de la plantilla");

  for (const n of await listNotas(db, "cA", "p1")) assert.ok(n.title.trim(), "la lista se lee por el título");
});

test("el título es texto plano y acotado: ni objetos, ni saltos, ni un libro", () => {
  assert.equal(limpiarTitulo({ $ne: "" }), "");
  assert.equal(limpiarTitulo(42), "");
  assert.equal(limpiarTitulo("a\u0000b\tc"), "a b c");
  assert.equal(limpiarTitulo("x".repeat(500)).length, MAX_TITLE_LENGTH);
  assert.equal(tituloPorDefecto(""), "Nota de evolución");
});

test("el título por defecto sigue a la fecha de la firma; uno escrito a mano no se toca", async () => {
  const b1 = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE }, TARDE));
  const b2 = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE, title: "Control #4" }, TARDE));
  // Al REABRIR el borrador ya se ve el título con el que se va a firmar.
  const reabierto = await getNotaParaEditar(db, "cA", b1.id, "dA", DIA_SIGUIENTE);
  assert.equal(reabierto!.title, `Nota de evolución · ${reabierto!.encabezado.fecha}`);
  assert.equal((await getNotaParaEditar(db, "cA", b2.id, "dA", DIA_SIGUIENTE))!.title, "Control #4");
  const f1 = valor(await signNota(db, "cA", b1.id, "dA", undefined, DIA_SIGUIENTE));
  const f2 = valor(await signNota(db, "cA", b2.id, "dA", undefined, DIA_SIGUIENTE));
  assert.ok(f1.encabezado.fecha.includes("20 de septiembre"));
  assert.equal(f1.title, `Nota de evolución · ${f1.encabezado.fecha}`, "un título con la fecha de ayer sería mentira");
  assert.equal(f2.title, "Control #4");
});

/* ─── la plantilla es opcional, y no pisa ──────────────────────────────── */

test("elegir una plantilla con texto ya escrito NO lo pisa: se añade debajo y se avisa", () => {
  const escrito = "<p>Paciente refiere molestia leve en el 36.</p>";
  const plantilla = "<p>Control de Ana López. Se cambia arco.</p>";
  const r = combinarConPlantilla(escrito, "Paciente refiere molestia leve en el 36.", plantilla);
  assert.equal(r.anadida, true);
  assert.ok(r.html.startsWith(escrito), "lo escrito va primero y entero");
  assert.ok(r.html.endsWith(plantilla));
});

test("con la hoja vacía la plantilla la rellena, aunque el editor tenga su <br> fantasma", () => {
  const plantilla = "<p>Control.</p>";
  for (const [html, texto] of [["", ""], ["<p><br></p>", ""], ["<br>", "  \n"]]) {
    assert.deepEqual(combinarConPlantilla(html, texto, plantilla), { html: plantilla, anadida: false });
  }
});

test("lo combinado (texto propio + plantilla) se guarda entero y con los marcadores rellenos", async () => {
  const rellena = valor(await previewNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_orto" }, TARDE));
  assert.equal(rellena.title, "Control de ortodoncia");
  const { html } = combinarConPlantilla(LIBRE, "Acude a control.", rellena.body);
  const nota = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", templateId: "t_orto", body: html, sign: true }, TARDE));
  assert.ok(nota.body.includes("0.016 NiTi"));
  assert.ok(nota.body.includes("Control de Ana López"));
});

/* ─── el saneado no se relaja ──────────────────────────────────────────── */

const SUCIO =
  '<p onclick="robar()">Evolución <b style="color:red">favorable</b></p>' +
  "<script>alert(1)</script>" +
  '<img src=x onerror="alert(2)"><a href="javascript:alert(3)">ver</a>' +
  "<iframe src=//malo></iframe>";

function limpio(html: string) {
  for (const malo of ["<script", "alert(1)", "onclick", "onerror", "javascript:", "<iframe", "<img", "<a ", "style="]) {
    assert.ok(!html.includes(malo), `se guardó «${malo}»: ${html}`);
  }
  assert.ok(html.includes("<p>Evolución <b>favorable</b></p>"), html);
}

test("una nota LIBRE se sanea igual que una de plantilla: <script> y onclick= no se guardan", async () => {
  const creada = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: SUCIO }, TARDE));
  limpio(creada.body);
  limpio(tablas.patientDocument[0].body);

  const editada = valor(await updateNotaDraft(db, "cA", creada.id, "dA", `<p>Más.</p>${SUCIO}`, TARDE));
  limpio(editada.body);
  const firmada = valor(await signNota(db, "cA", creada.id, "dA", SUCIO, TARDE));
  limpio(firmada.body);
  limpio(tablas.patientDocument[0].body);
});

test("el título con HTML se queda en texto: no llega etiqueta alguna a ejecutarse", async () => {
  const n = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: LIBRE, title: "<script>x</script>Control" }, TARDE));
  // Es una cadena plana: React la escapa al pintarla y el PDF la imprime como texto.
  assert.equal(n.title, "<script>x</script>Control");
  const doc = notaParaPdf(n, "America/Mexico_City");
  assert.equal(doc.titulo, n.title);
});

/* ─── PDF e impresión ──────────────────────────────────────────────────── */

test("una nota libre firmada sale bien en el PDF: su título, su texto y su firma", async () => {
  const firmada = valor(await createNota(db, "cA", { patientId: "p1", doctorId: "dA", body: `${LIBRE}<ul><li>Higiene buena</li></ul>`, sign: true }, TARDE));
  const releida = await getNota(db, "cA", firmada.id);
  assert.ok(releida);
  const doc = notaParaPdf(releida, "America/Mexico_City");
  assert.equal(doc.firmado, true);
  assert.ok(doc.firmadoEl);

  const pdf = await renderizarPdf(doc, null);
  const texto = textoVisiblePorPagina(pdf).join(" ").replace(/\s+/g, " ");
  assert.ok(texto.includes("Nota de evolución"), texto);
  assert.ok(texto.includes("19 de septiembre de 2026"));
  assert.ok(texto.includes("0.016 NiTi"), texto);
  assert.ok(texto.includes("Higiene buena"));
  assert.ok(texto.includes("Ana López"));
  assert.ok(texto.includes("Laura Pérez"));
  assert.ok(htmlATexto(releida.body).includes("Cita en 4 semanas"), "el texto del envío también lo lleva");
});

const RAIZ = join(__dirname, "../../../../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

test("una nota libre se lee e imprime por el MISMO visor que las demás", () => {
  const panel = leer("src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx");
  assert.ok(panel.includes("<NotaVisor nota={vista.nota}"));
  // El visor no mira de dónde salió la nota: ni `templateId` ni plantilla.
  assert.ok(!leer("src/components/dashboard/nota-evolucion/nota-documento.tsx").includes("templateId"));
});

/* ─── el peaje no vuelve ───────────────────────────────────────────────── */

test("el servidor no exige templateId ni en el alta ni en la hoja en blanco", () => {
  for (const ruta of ["src/app/api/patient-documents/route.ts", "src/app/api/patient-documents/preview/route.ts"]) {
    const codigoFuente = leer(ruta);
    assert.ok(!/!patientId\s*\|\|\s*!templateId/.test(codigoFuente), `${ruta} vuelve a exigir templateId`);
    assert.ok(!codigoFuente.includes("templateId requeridos"), ruta);
  }
});

test("la pantalla abre la hoja, no un selector, y no manda a Administración → Plantillas", () => {
  const panel = leer("src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx");
  assert.ok(panel.startsWith('"use client";'));
  assert.ok(!panel.includes("/dashboard/plantillas"), "ese enlace ERA el callejón del ticket");
  assert.ok(!panel.includes('tipo: "elegir"'), "no hay una vista de elegir plantilla antes de escribir");
  assert.ok(panel.includes("combinarConPlantilla"), "la plantilla entra por la regla de no pisar");
  // Lo que se firma es el título que la hoja enseña, no otro que decida el servidor.
  assert.ok(panel.includes("title: titulo.trim() || hoja.tituloPorDefecto"));
  // «Nueva nota» pide la hoja en blanco: la URL del preview SIN templateId.
  assert.ok(/preview\?patientId=\$\{encodeURIComponent\(patientId\)\}`\)/.test(panel));
});

test("es.json y en.json llevan las claves nuevas, las mismas y sin vacías", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).notaEvolucionDoc;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).notaEvolucionDoc;
  for (const d of [es, en]) {
    for (const k of ["placeholder", "titleLabel", "titlePlaceholder", "useTemplate", "templateApplied", "templateAppended"]) {
      assert.ok(typeof d.editor[k] === "string" && d.editor[k].trim(), `editor.${k}`);
    }
    assert.ok(d.editor.templateApplied.includes("{name}"));
    assert.ok(d.pick.empty.trim());
    assert.equal(d.pick.goToTemplates, undefined, "el enlace a Plantillas ya no existe");
  }
});
