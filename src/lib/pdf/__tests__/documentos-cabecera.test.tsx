/**
 * LA CABECERA EN LOS DOCUMENTOS QUE SALEN DE LA CLÍNICA (WS1-T2).
 *
 * Run: npm run test:pdf-documentos
 *
 * La orden de laboratorio la recibe un PROVEEDOR y la carta de referencia OTRO
 * MÉDICO. Las dos salían con el nombre de la clínica y nada más: ni dirección,
 * ni teléfono, ni correo, ni logo. Quien las recibía no tenía cómo contestar.
 *
 * Se prueba en dos niveles:
 *   1. El ÁRBOL que devuelve el componente — ahí se ve si el dato está pintado
 *      y si hay (o no hay) una imagen de logo. Es lo que fallaba antes.
 *   2. El PDF DE VERDAD (`renderToBuffer`) con las tres formas de logo, sin
 *      logo y con un nombre larguísimo: que salga siempre, en todos los casos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToBuffer, Text, Image as PdfImage } from "@react-pdf/renderer";
import { LabOrderDocument, type LabOrderDocumentProps } from "../lab-order-document";
import {
  ReferralLetterDocument,
  type ReferralLetterDocumentProps,
} from "../referral-letter-document";
import { logoBox, clinicNameFontSize } from "../clinic-letterhead";
import { makePng } from "./_imagenes-de-prueba";

// ── Recorrer el árbol ──────────────────────────────────────────────────
//
// Los documentos son funciones puras que devuelven elementos de React, así que
// se pueden recorrer sin renderizar nada. Los componentes propios (la cabecera)
// se expanden llamándolos: no tienen hooks ni estado.

interface Nodo {
  type: unknown;
  props: Record<string, unknown>;
}

function walk(node: ReactNode, visit: (n: Nodo) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const hijo of node) walk(hijo, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  visit({ type: el.type, props: el.props ?? {} });
  // Componente propio (ClinicLetterhead): se ejecuta para ver lo que pinta.
  if (typeof el.type === "function") {
    const fn = el.type as (p: Record<string, unknown>) => ReactNode;
    walk(fn(el.props ?? {}), visit);
    return;
  }
  walk((el.props as { children?: ReactNode })?.children, visit);
}

/**
 * Todo el texto del documento, aplanado. Los `Text` con `render` (la
 * paginación) no tienen hijos: se les pide su contenido como si estuviéramos
 * en la página 2 de 3, que es justo el caso que importa aquí.
 */
function textos(doc: ReactNode): string {
  const trozos: string[] = [];
  walk(doc, (n) => {
    if (n.type !== Text) return;
    if (typeof n.props.render === "function") {
      const render = n.props.render as (c: Record<string, number>) => unknown;
      const salida = render({ pageNumber: 2, totalPages: 3, subPageNumber: 2, subPageTotalPages: 3 });
      if (typeof salida === "string") trozos.push(salida);
      return;
    }
    const c = n.props.children;
    const plano = (Array.isArray(c) ? c : [c])
      .filter((x) => typeof x === "string" || typeof x === "number")
      .join("");
    if (plano) trozos.push(plano);
  });
  return trozos.join("\n");
}

/** Las imágenes del documento (los logos son las únicas de estos dos). */
function imagenes(doc: ReactNode): Nodo[] {
  const out: Nodo[] = [];
  walk(doc, (n) => {
    if (n.type === PdfImage) out.push(n);
  });
  return out;
}

/** fontSize resuelto del `Text` cuyo contenido es exactamente `str`. */
function tamanoDe(doc: ReactNode, str: string): number | undefined {
  let size: number | undefined;
  walk(doc, (n) => {
    if (n.type !== Text || n.props.children !== str) return;
    const estilos = (Array.isArray(n.props.style) ? n.props.style : [n.props.style]) as Array<
      Record<string, unknown> | undefined
    >;
    for (const e of estilos) if (e && typeof e.fontSize === "number") size = e.fontSize;
  });
  return size;
}

// ── Datos de ejemplo ───────────────────────────────────────────────────

const CLINICA = {
  clinicName: "Clínica Sonrisa",
  clinicAddress: "Av. Juárez 123, Col. Centro",
  clinicCity: "Guadalajara",
  clinicState: "Jalisco",
  clinicPhone: "33 1234 5678",
  clinicEmail: "hola@clinicasonrisa.mx",
};

const NOMBRE_LARGO = "Clínica Dental y Especialidades del Valle de Guadalupe";

const dataUrl = (w: number, h: number) =>
  `data:image/png;base64,${makePng(w, h).toString("base64")}`;

function ordenLab(extra: Partial<LabOrderDocumentProps> = {}): LabOrderDocumentProps {
  return {
    ...CLINICA,
    doctorAuthorName: "Dra. Ana Ruiz",
    doctorAuthorCedula: "1234567",
    partnerName: "Laboratorio Dental del Bajío",
    partnerContact: "Luis Pérez · 477 000 0000",
    partnerAddress: "Blvd. López Mateos 900, León",
    generatedAt: "2026-09-09T15:00:00.000Z",
    patientName: "Carlos Mendoza",
    patientDob: "1988-04-02T00:00:00.000Z",
    module: "implants",
    orderType: "Corona",
    toothFdi: 26,
    shadeGuide: "A2",
    dueDate: "2026-09-20T00:00:00.000Z",
    spec: [{ label: "Material", value: "Zirconia" }],
    notes: "Contacto proximal ligero.",
    ...extra,
  };
}

function referencia(extra: Partial<ReferralLetterDocumentProps> = {}): ReferralLetterDocumentProps {
  return {
    ...CLINICA,
    doctorAuthorName: "Dr. Julio Vega",
    doctorAuthorCedula: "7654321",
    module: "endodontics",
    generatedAt: "2026-09-09T15:00:00.000Z",
    patientName: "María Torres",
    patientDob: "1979-11-20T00:00:00.000Z",
    patientGender: "Femenino",
    contactName: "Dra. Paula Nieto",
    contactSpecialty: "Cirugía maxilofacial",
    contactClinicName: "Centro Quirúrgico Río",
    contactPhone: "55 9876 5432",
    contactEmail: "paula@centrorio.mx",
    reason: "Valoración de tercer molar incluido.",
    summary: "Tratamiento de conductos concluido en 46.",
    ...extra,
  };
}

const DOCUMENTOS: Array<[string, (e?: any) => ReactNode]> = [
  ["orden de laboratorio", (e = {}) => LabOrderDocument(ordenLab(e))],
  ["carta de referencia", (e = {}) => ReferralLetterDocument(referencia(e))],
];

// ── 1. El dato está pintado ────────────────────────────────────────────

describe("quien recibe el documento sabe de dónde viene", () => {
  for (const [nombre, hacer] of DOCUMENTOS) {
    it(`${nombre}: imprime dirección, teléfono y correo de la clínica`, () => {
      const t = textos(hacer());
      assert.match(t, /Clínica Sonrisa/, "falta el nombre de la clínica");
      assert.match(t, /Av\. Juárez 123/, "falta la dirección: el proveedor no sabe dónde entregar");
      assert.match(t, /Guadalajara/, "falta la ciudad");
      assert.match(t, /Jalisco/, "falta el estado");
      assert.match(t, /33 1234 5678/, "falta el teléfono: no hay a quién llamar");
      assert.match(t, /hola@clinicasonrisa\.mx/, "falta el correo");
    });

    it(`${nombre}: el pie lleva la clínica y la paginación en TODAS las hojas`, () => {
      const t = textos(hacer());
      // El membrete solo sale en la primera página; en una hoja suelta la
      // identidad la sostiene el pie, que es el que va `fixed`.
      assert.match(t, /Clínica Sonrisa · (Orden de laboratorio|Hoja de referencia)/);
      assert.match(t, /Página 2 de 3/, "sin número de página, una hoja suelta se pierde");
    });

    it(`${nombre}: el membrete NO se repite en cada página`, () => {
      let fijos = 0;
      walk(hacer(), (n) => {
        if (n.props.fixed && n.props.accent) fijos++;
      });
      assert.equal(fijos, 0, "la cabecera con logo no debe repetirse por página");
    });
  }
});

// ── 2. El logo, y su ausencia ──────────────────────────────────────────

describe("el logo va arriba a la izquierda, y si no hay, manda el nombre", () => {
  for (const [nombre, hacer] of DOCUMENTOS) {
    it(`${nombre}: con logo se pinta UNA imagen, encajada sin deformar`, () => {
      const imgs = imagenes(hacer({ clinicLogoDataUrl: dataUrl(800, 200), clinicLogoAspect: 4 }));
      assert.equal(imgs.length, 1, "debería haber exactamente un logo");
      const estilos = (imgs[0].props.style as Array<Record<string, unknown>>).flat();
      const box = Object.assign({}, ...estilos) as Record<string, unknown>;
      assert.equal(box.objectFit, "contain");
      assert.deepEqual({ width: box.width, height: box.height }, logoBox(4));
    });

    it(`${nombre}: SIN logo no queda ningún hueco de imagen`, () => {
      // Esto es lo que prohibió Rafael: ni recuadro vacío, ni icono roto.
      assert.equal(imagenes(hacer({ clinicLogoDataUrl: null })).length, 0);
      assert.equal(imagenes(hacer()).length, 0);
    });

    it(`${nombre}: SIN logo el nombre de la clínica sale en grande`, () => {
      const conLogo = tamanoDe(
        hacer({ clinicLogoDataUrl: dataUrl(400, 400), clinicLogoAspect: 1 }),
        "Clínica Sonrisa",
      );
      const sinLogo = tamanoDe(hacer({ clinicLogoDataUrl: null }), "Clínica Sonrisa");
      assert.ok(sinLogo, "el nombre tiene que estar pintado igualmente");
      assert.equal(sinLogo, clinicNameFontSize("Clínica Sonrisa", false));
      assert.ok(sinLogo! > conLogo!, `sin logo debería ser mayor: ${sinLogo} vs ${conLogo}`);
    });

    it(`${nombre}: un nombre larguísimo baja de tamaño en vez de desbordar`, () => {
      const largo = tamanoDe(
        hacer({ clinicName: NOMBRE_LARGO, clinicLogoDataUrl: null }),
        NOMBRE_LARGO,
      );
      assert.equal(largo, clinicNameFontSize(NOMBRE_LARGO, false));
      assert.ok(largo! < clinicNameFontSize("Clínica Sonrisa", false));
    });
  }
});

// ── 3. El PDF sale, siempre ────────────────────────────────────────────

describe("el PDF se genera en los seis escenarios", () => {
  const ESCENARIOS: Array<[string, Record<string, unknown>]> = [
    ["logo cuadrado", { clinicLogoDataUrl: dataUrl(400, 400), clinicLogoAspect: 1 }],
    ["logo apaisado", { clinicLogoDataUrl: dataUrl(800, 200), clinicLogoAspect: 4 }],
    ["logo vertical", { clinicLogoDataUrl: dataUrl(200, 600), clinicLogoAspect: 1 / 3 }],
    ["sin logo", { clinicLogoDataUrl: null }],
    // El bucket falló: `fetchClinicLogo` devolvió null y aquí llega null. El
    // documento no puede enterarse de la diferencia.
    ["logo que no se pudo bajar", { clinicLogoDataUrl: null, clinicLogoAspect: null }],
    ["nombre de clínica larguísimo", { clinicName: NOMBRE_LARGO, clinicLogoDataUrl: null }],
  ];

  for (const [nombre, hacer] of DOCUMENTOS) {
    for (const [caso, extra] of ESCENARIOS) {
      it(`${nombre} · ${caso}`, async () => {
        // El árbol se construye como ReactNode; renderToBuffer pide su propio
        // tipo de elemento. Se estrecha con su firma en vez de con `any`, que
        // obligaría a un eslint-disable y la config de este repo no tiene esa
        // regla definida (rompe el lint, ver quote-pdf.ts:97).
        const buf = await renderToBuffer(hacer(extra) as Parameters<typeof renderToBuffer>[0]);
        assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "no es un PDF");
        assert.ok(buf.length > 1000, `PDF sospechosamente corto: ${buf.length} bytes`);
      });
    }
  }
});
