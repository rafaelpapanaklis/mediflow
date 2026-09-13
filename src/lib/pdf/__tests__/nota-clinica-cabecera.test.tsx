/**
 * LA NOTA CLÍNICA CON LA CABECERA COMÚN (integración #235 + #236).
 *
 * Run: npm run test:nota-cabecera
 *
 * El #236 puso la cabecera común (`ClinicLetterhead`: logo arriba a la
 * izquierda + nombre y datos de la clínica) en el comprobante, la orden de
 * laboratorio y la carta de referencia. La nota clínica se quedó con la vieja,
 * la que pone «DaleControl» arriba y el nombre de la clínica a un lado, porque
 * el #235 estaba tocando ese mismo archivo en paralelo. Resultado: tres
 * documentos con el logo de la clínica y uno sin él.
 *
 * Lo que se fija aquí:
 *   · la nota usa la cabecera común, con las mismas reglas de logo que las
 *     otras tres (proporción real, sin logo manda el nombre en grande);
 *   · la cabecera NO se repite por página; la identidad de una hoja suelta la
 *     lleva el pie, que es `fixed` y dice de qué clínica es y qué página es;
 *   · lo del #235 sigue en pie: el aviso de adendas ARRIBA, antes del cuerpo,
 *     y la frase de adendas en el pie fijo de TODAS las páginas;
 *   · la ruta pide a la base los datos del membrete y baja el logo — y si el
 *     logo no se puede bajar, el PDF sale igual.
 *
 * Necesita --experimental-test-module-mocks: ejecuta el route handler de
 * verdad con Prisma, la auth y la visibilidad sustituidos. El renderer NO se
 * sustituye: se envuelve para quedarse con el elemento y el PDF sale de verdad.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as reactPdf from "@react-pdf/renderer";
import { ownPrivateRecordsOnly } from "@/lib/clinical/record-scope";
import { makePng } from "./_imagenes-de-prueba";
import { textosPintados, textoVisiblePorPagina } from "./_texto-del-pdf";

const { Text, Image: PdfImage } = reactPdf;

// ── Dobles de la ruta ──────────────────────────────────────────────────

let selectPedido: Record<string, any> | null = null;
let fila: any = null;

mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () => ({ id: "u1", clinicId: "cli_1", role: "ADMIN", permissionsOverride: [] }),
  },
});
// `@/lib/branches` importa "server-only"; la función real vive en record-scope.
mock.module("@/lib/branches", { namedExports: { ownPrivateRecordsOnly } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      medicalRecord: {
        findFirst: async ({ where, select }: any) => {
          selectPedido = select;
          return fila && where.id === fila.id && where.clinicId === "cli_1" ? fila : null;
        },
      },
    },
  },
});

let elementoCapturado: any = null;
mock.module("@react-pdf/renderer", {
  namedExports: {
    ...reactPdf,
    renderToBuffer: async (el: any) => {
      elementoCapturado = el;
      return reactPdf.renderToBuffer(el);
    },
  },
});

// ── Recorrer el árbol ──────────────────────────────────────────────────

interface Nodo {
  type: unknown;
  props: Record<string, any>;
  /** Algún ancestro (o él mismo) va `fixed`: se pinta en todas las páginas. */
  enFijo: boolean;
}

function walk(node: ReactNode, visit: (n: Nodo) => void, enFijo = false): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const hijo of node) walk(hijo, visit, enFijo);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, any>>;
  const props = el.props ?? {};
  const fijo = enFijo || Boolean(props.fixed);
  visit({ type: el.type, props, enFijo: fijo });
  if (typeof el.type === "function") {
    walk((el.type as (p: Record<string, any>) => ReactNode)(props), visit, fijo);
    return;
  }
  walk(props.children, visit, fijo);
}

function textoDeNodo(n: Nodo): string {
  if (typeof n.props.render === "function") {
    const salida = n.props.render({ pageNumber: 2, totalPages: 3, subPageNumber: 2, subPageTotalPages: 3 });
    return typeof salida === "string" ? salida : "";
  }
  const c = n.props.children;
  return (Array.isArray(c) ? c : [c])
    .filter((x) => typeof x === "string" || typeof x === "number")
    .join("");
}

/** Los textos del documento en orden, con si van en zona fija. */
function textos(doc: ReactNode): Array<{ t: string; enFijo: boolean; nodo: Nodo }> {
  const out: Array<{ t: string; enFijo: boolean; nodo: Nodo }> = [];
  walk(doc, (n) => {
    if (n.type !== Text) return;
    const t = textoDeNodo(n);
    if (t) out.push({ t, enFijo: n.enFijo, nodo: n });
  });
  return out;
}

function imagenes(doc: ReactNode): Nodo[] {
  const out: Nodo[] = [];
  walk(doc, (n) => {
    if (n.type === PdfImage) out.push(n);
  });
  return out;
}

function estiloPlano(style: unknown): Record<string, any> {
  const lista = (Array.isArray(style) ? style.flat(Infinity) : [style]) as Array<Record<string, any> | undefined>;
  return Object.assign({}, ...lista.filter(Boolean));
}

// ── Datos ──────────────────────────────────────────────────────────────

const CLINICA = {
  clinicName: "Clínica Sonrisa",
  clinicAddress: "Av. Juárez 123, Col. Centro",
  clinicCity: "Guadalajara",
  clinicState: "Jalisco",
  clinicPhone: "33 1234 5678",
  clinicEmail: "hola@clinicasonrisa.mx",
};
const NOMBRE_LARGO = "Clínica Dental y Especialidades del Valle de Guadalupe";
const dataUrl = (w: number, h: number) => `data:image/png;base64,${makePng(w, h).toString("base64")}`;

const ADENDA_1 = {
  text: "Donde dice «pieza 26» debe decir «pieza 27». Error de captura.",
  authorName: "Dr/a. Ana Ruiz",
  createdAt: "2026-09-02T14:32:00.000Z",
};

async function cargarDocumento() {
  return import("@/lib/pdf/clinical-note-document");
}
async function cargarCabecera() {
  return import("@/lib/pdf/clinic-letterhead");
}

async function nota(extra: Record<string, unknown> = {}) {
  const { ClinicalNoteDocument } = await cargarDocumento();
  const props = {
    ...CLINICA,
    patientName: "Laura Menéndez",
    patientDob: "1988-03-04T00:00:00.000Z",
    patientGender: "Femenino",
    doctorName: "Dr/a. Ana Ruiz",
    visitDate: "2026-09-01T16:30:00.000Z",
    generatedAt: "2026-09-12T18:00:00.000Z",
    status: "SIGNED" as const,
    signedAt: "2026-09-01T17:05:00.000Z",
    subjective: "Dolor en pieza 26 al masticar.",
    objective: "Caries oclusal profunda en pieza 26.",
    assessment: "Pulpitis reversible en pieza 26.",
    plan: "Resina compuesta y control en 15 días.",
    diagnoses: [{ code: "K02.1", description: "Caries de la dentina" }],
    procedures: ["Resina compuesta oclusal"],
    ...extra,
  };
  return ClinicalNoteDocument(props as any);
}

// ── 1. La cabecera común ───────────────────────────────────────────────

describe("la nota clínica lleva la cabecera común, como los otros tres documentos", () => {
  it("usa ClinicLetterhead y ya no pinta «DaleControl» como marca arriba", async () => {
    const { ClinicLetterhead } = await cargarCabecera();
    const doc = await nota();
    let cabeceras = 0;
    walk(doc, (n) => {
      if (n.type === ClinicLetterhead) cabeceras++;
    });
    assert.equal(cabeceras, 1, "la nota no usa la cabecera común");

    const t = textos(doc);
    assert.equal(t[0]?.t, "Clínica Sonrisa", "lo primero de la hoja tiene que ser la clínica");
    assert.equal(
      t.some((x) => x.t.trim() === "DaleControl"),
      false,
      "sigue saliendo la marca DaleControl como cabecera",
    );
  });

  it("imprime dirección, teléfono y correo de la clínica", async () => {
    const plano = textos(await nota()).map((x) => x.t).join("\n");
    for (const dato of ["Av. Juárez 123", "Guadalajara, Jalisco", "33 1234 5678", "hola@clinicasonrisa.mx"]) {
      assert.ok(plano.includes(dato), `falta en la cabecera: ${dato}`);
    }
  });

  for (const [caso, w, h, aspect] of [
    ["cuadrado", 400, 400, 1],
    ["apaisado", 800, 200, 4],
    ["vertical", 200, 600, 1 / 3],
  ] as const) {
    it(`logo ${caso}: UNA imagen, encajada con su proporción`, async () => {
      const { logoBox } = await cargarCabecera();
      const imgs = imagenes(await nota({ clinicLogoDataUrl: dataUrl(w, h), clinicLogoAspect: aspect }));
      assert.equal(imgs.length, 1, "debería haber exactamente un logo");
      const box = estiloPlano(imgs[0].props.style);
      assert.equal(box.objectFit, "contain");
      assert.deepEqual({ width: box.width, height: box.height }, logoBox(aspect));
    });
  }

  it("sin logo: ningún hueco de imagen y el nombre en grande", async () => {
    const { clinicNameFontSize } = await cargarCabecera();
    const doc = await nota({ clinicLogoDataUrl: null });
    assert.equal(imagenes(doc).length, 0);
    const nombre = textos(doc).find((x) => x.t === "Clínica Sonrisa");
    assert.ok(nombre, "el nombre tiene que estar pintado");
    assert.equal(estiloPlano(nombre!.nodo.props.style).fontSize, clinicNameFontSize("Clínica Sonrisa", false));
  });

  it("nombre larguísimo: baja de tamaño", async () => {
    const { clinicNameFontSize } = await cargarCabecera();
    const doc = await nota({ clinicName: NOMBRE_LARGO, clinicLogoDataUrl: null });
    const nombre = textos(doc).find((x) => x.t === NOMBRE_LARGO);
    assert.ok(nombre);
    assert.equal(estiloPlano(nombre!.nodo.props.style).fontSize, clinicNameFontSize(NOMBRE_LARGO, false));
  });
});

// ── 2. Paginación: cabecera una vez, pie en todas ──────────────────────

describe("la cabecera no se repite; el pie sí, y sostiene la identidad", () => {
  it("la cabecera con logo NO va fixed", async () => {
    const doc = await nota({ clinicLogoDataUrl: dataUrl(400, 400), clinicLogoAspect: 1 });
    for (const img of imagenes(doc)) assert.equal(img.enFijo, false, "el logo se repetiría en cada página");
    const nombre = textos(doc).find((x) => x.t === "Clínica Sonrisa");
    assert.equal(nombre?.enFijo, false, "la cabecera se repetiría en cada página");
  });

  it("el pie fijo dice de qué clínica es la nota y qué página es", async () => {
    const fijos = textos(await nota()).filter((x) => x.enFijo).map((x) => x.t).join("\n");
    assert.match(fijos, /Clínica Sonrisa · Nota clínica/, "una hoja suelta no dice de qué clínica es");
    assert.match(fijos, /Página 2 de 3/, "sin número de página, una hoja suelta se pierde");
    assert.match(fijos, /NOM-024-SSA3-2012/, "se perdió la leyenda de la NOM-024");
  });
});

// ── 3. Lo del #235 convive con la cabecera ─────────────────────────────

describe("las adendas del #235 siguen igual con la cabecera nueva", () => {
  it("el aviso va ARRIBA: después de la cabecera y antes del cuerpo", async () => {
    const t = textos(await nota({ addenda: [ADENDA_1] })).map((x) => x.t);
    const cabecera = t.indexOf("Clínica Sonrisa");
    const aviso = t.findIndex((x) => /esta nota tiene 1 adenda/i.test(x));
    const cuerpo = t.indexOf("Subjetivo (S)");
    assert.ok(cabecera >= 0 && aviso >= 0 && cuerpo >= 0, JSON.stringify({ cabecera, aviso, cuerpo }));
    assert.ok(cabecera < aviso && aviso < cuerpo, "el aviso de adendas no está entre la cabecera y la nota");
  });

  it("la frase de adendas va en zona fija (todas las páginas), junto al pie con la clínica", async () => {
    const t = textos(await nota({ addenda: [ADENDA_1, { ...ADENDA_1, createdAt: "2026-09-03T10:00:00.000Z" }] }));
    const frase = t.find((x) => /Este documento incluye 2 adendas posteriores a la firma/.test(x.t));
    assert.ok(frase, "se perdió la frase del pie");
    assert.equal(frase!.enFijo, true, "la frase de adendas ya no se repite en todas las páginas");
    assert.ok(t.some((x) => x.enFijo && /Clínica Sonrisa · Nota clínica/.test(x.t)));
  });

  it("sin adendas no aparece nada de adendas", async () => {
    const plano = textos(await nota()).map((x) => x.t).join("\n");
    assert.equal(/adenda/i.test(plano), false);
  });
});

// ── 3b. En el PAPEL: lo que de verdad cae dentro de cada hoja ──────────
//
// El árbol puede estar bien y el PDF no: @react-pdf 4.x re-resuelve estilos en
// las páginas con `render` («Página N de M») y multiplica otra vez el
// `lineHeight: 1.5` de la página, que lanza el pie fuera del papel. Aquí se
// lee el PDF final con la posición de cada texto.

describe("en el PDF impreso, con adendas que obligan a paginar", () => {
  const LARGA = "Exposición pulpar puntiforme no visible en la radiografía previa; se documenta con fotografía intraoral. ".repeat(40);
  const VARIAS = [
    ADENDA_1,
    { text: LARGA, authorName: "Dr/a. Ana Ruiz", createdAt: "2026-09-03T10:00:00.000Z" },
    { text: "Control de 15 días sin síntomas.", authorName: "Dr/a. Luis Prado", createdAt: "2026-09-16T18:10:00.000Z" },
  ];

  async function pdf(extra: Record<string, unknown>) {
    return reactPdf.renderToBuffer((await nota(extra)) as Parameters<typeof reactPdf.renderToBuffer>[0]);
  }
  async function paginas(extra: Record<string, unknown>) {
    return textoVisiblePorPagina(await pdf(extra));
  }

  it("cada hoja lleva el pie con la clínica, la NOM-024, su página y el aviso de adendas", async () => {
    const hojas = await paginas({ clinicLogoDataUrl: dataUrl(800, 200), clinicLogoAspect: 4, addenda: VARIAS });
    assert.ok(hojas.length > 1, `el caso tiene que paginar: ${hojas.length} página(s)`);
    const numeros = new Set<string>();
    for (const texto of hojas) {
      assert.match(texto, /Clínica Sonrisa · Nota clínica del/, "una hoja sale sin decir de qué clínica es");
      assert.match(texto, /NOM-024-SSA3-2012/, "una hoja sale sin la leyenda de la NOM-024");
      assert.match(texto, /Este documento incluye 3 adendas posteriores a la firma/, "una hoja sale sin el aviso de adendas");
      const n = /Página (\d+) de (\d+)/.exec(texto);
      assert.ok(n, "una hoja sale sin número de página");
      assert.equal(Number(n![2]), hojas.length);
      numeros.add(n![1]);
    }
    assert.equal(numeros.size, hojas.length, "los números de página se repiten o faltan");
  });

  // Medidas en el PDF final (líneas base, en pt desde abajo). El pie hereda el
  // interlineado de la página (15 pt por renglón de 8 pt) y su filete queda
  // ~16 pt por encima de la línea base de su renglón más alto, «<clínica> ·
  // Nota clínica del…». Un texto de 10 pt baja ~2 pt por debajo de su línea
  // base y sube ~7. De ahí los mínimos. Con 80 letras de clínica —el tope al
  // darla de alta— el renglón no parte; con más de ~83 parte en dos, el pie
  // crece 15 pt y estos mínimos dejan de cumplirse (límite conocido).
  const NOMBRE_80 = "Clínica Dental Integral y Centro de Especialidades Odontológicas del Bajío, S.C.";
  const MUCHOS = Array.from({ length: 70 }, (_, i) => `Procedimiento ${i + 1}`);

  function medidas(buf: Buffer) {
    return textosPintados(buf).map((ts) => {
      const renglon1 = ts.find((t) => t.s.includes("Nota clínica del"))?.y ?? NaN;
      const frase = ts.find((t) => t.s.includes("Este documento incluye"))?.y ?? null;
      const cuerpo = ts
        .filter((t) => t.y > renglon1 + 0.5 && (frase == null || Math.abs(t.y - frase) > 0.5))
        .map((t) => t.y);
      return { renglon1, frase, cuerpoMasBajo: Math.min(...cuerpo) };
    });
  }

  it("sin adendas y con varias hojas llenas: el filete del pie no toca el cuerpo", async () => {
    const buf = await pdf({ clinicName: NOMBRE_80, procedures: MUCHOS });
    const hojas = medidas(buf);
    assert.ok(hojas.length > 1, `el caso tiene que paginar: ${hojas.length}`);
    for (const [i, h] of hojas.entries()) {
      assert.ok(h.cuerpoMasBajo - h.renglon1 >= 25, `hoja ${i + 1}: cuerpo en y=${h.cuerpoMasBajo}, pie en y=${h.renglon1}`);
    }
  });

  it("con adendas: pie, frase de adendas y cuerpo, cada uno en su sitio", async () => {
    const buf = await pdf({ clinicName: NOMBRE_80, procedures: MUCHOS.slice(0, 20), addenda: VARIAS });
    const hojas = medidas(buf);
    assert.ok(hojas.length > 1, `el caso tiene que paginar: ${hojas.length}`);
    for (const [i, h] of hojas.entries()) {
      assert.ok(h.frase != null, `hoja ${i + 1}: sin frase de adendas`);
      assert.ok(h.frase! - h.renglon1 >= 20, `hoja ${i + 1}: la frase (y=${h.frase}) toca el filete del pie (renglón en y=${h.renglon1})`);
      assert.ok(h.cuerpoMasBajo - h.frase! >= 15, `hoja ${i + 1}: el cuerpo (y=${h.cuerpoMasBajo}) se mete bajo la frase (y=${h.frase})`);
    }
  });

  it("las hojas salen en orden, cada una con su número", async () => {
    const hojas = await paginas({ procedures: MUCHOS, addenda: VARIAS });
    hojas.forEach((t, i) => assert.match(t, new RegExp(`Página ${i + 1} de ${hojas.length}`)));
  });

  it("el membrete (con sus datos) sale UNA vez, y el aviso de arriba también", async () => {
    const hojas = await paginas({ addenda: VARIAS });
    const conDireccion = hojas.filter((t) => t.includes("Av. Juárez 123"));
    assert.equal(conDireccion.length, 1, "el membrete se repite o no sale");
    assert.equal(hojas.filter((t) => /ATENCIÓN: ESTA NOTA TIENE 3 ADENDAS|Atención: esta nota tiene 3 adendas/i.test(t)).length, 1);
  });

  it("sin adendas: una hoja, con su pie y sin mencionar adendas", async () => {
    const hojas = await paginas({});
    assert.equal(hojas.length, 1);
    assert.match(hojas[0], /Clínica Sonrisa · Nota clínica del/);
    assert.match(hojas[0], /Página 1 de 1/);
    assert.doesNotMatch(hojas[0], /adenda/i);
  });
});

// ── 4. La ruta: base → logo → PDF ──────────────────────────────────────

describe("GET /api/clinical-notes/[id]/pdf baja el logo y no se cae sin él", () => {
  let server: http.Server;
  let base = "";
  const PNG_APAISADO = makePng(800, 200);

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/logo.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG_APAISADO);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  function filaNota(logoUrl: string | null) {
    return {
      id: "rec_1",
      patientId: "pat_1",
      visitDate: new Date("2026-09-01T16:30:00.000Z"),
      subjective: "Dolor en pieza 26.",
      objective: null,
      assessment: null,
      plan: null,
      specialtyData: { status: "SIGNED", signedAt: "2026-09-01T17:05:00.000Z", addenda: [ADENDA_1] },
      doctor: { firstName: "Ana", lastName: "Ruiz" },
      patient: { firstName: "Laura", lastName: "Menéndez", dob: null, gender: null },
      clinic: {
        name: "Clínica Sonrisa",
        address: "Av. Juárez 123",
        city: "Guadalajara",
        state: "Jalisco",
        phone: "33 1234 5678",
        email: "hola@clinicasonrisa.mx",
        logoUrl,
      },
      diagnoses_v2: [],
    };
  }

  async function imprimir(logoUrl: string | null) {
    fila = filaNota(logoUrl);
    elementoCapturado = null;
    selectPedido = null;
    const { GET } = await import("@/app/api/clinical-notes/[id]/pdf/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("https://dalecontrol.test/api/clinical-notes/rec_1/pdf"), {
      params: { id: "rec_1" },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf, props: elementoCapturado?.props ?? {} };
  }

  it("pide a la base todo lo que usa el membrete", async () => {
    const { CLINIC_LETTERHEAD_SELECT } = await cargarCabecera();
    await imprimir(null);
    assert.deepEqual(selectPedido?.clinic, { select: CLINIC_LETTERHEAD_SELECT });
  });

  it("con logo: lo baja, lo pasa con su proporción y el PDF lleva la imagen", async () => {
    const { status, buf, props } = await imprimir(`${base}/logo.png`);
    assert.equal(status, 200);
    assert.match(String(props.clinicLogoDataUrl), /^data:image\/png;base64,/);
    assert.equal(props.clinicLogoAspect, 4);
    assert.equal(props.clinicAddress, "Av. Juárez 123");
    assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(buf.toString("latin1"), /\/Subtype \/Image/, "el PDF no incrusta el logo");
  });

  for (const [caso, url] of [
    ["logo que da 404", () => `${base}/no-existe.png`],
    ["logo en un puerto cerrado", () => "http://127.0.0.1:9/logo.png"],
    ["clínica sin logo", () => null],
  ] as const) {
    it(`${caso}: el PDF sale igual, sin imagen y con el nombre`, async () => {
      const { status, buf, props } = await imprimir(url());
      assert.equal(status, 200);
      assert.equal(props.clinicLogoDataUrl, null);
      assert.equal(props.clinicName, "Clínica Sonrisa");
      assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
      assert.doesNotMatch(buf.toString("latin1"), /\/Subtype \/Image/);
    });
  }
});
