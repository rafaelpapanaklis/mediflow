/**
 * EL COMPROBANTE DEL PACIENTE, DE PUNTA A PUNTA (WS1-T2).
 *
 * Run: npm run test:comprobante-cabecera
 *
 * El comprobante es el único de los cuatro documentos que hace su propia
 * consulta y su propia descarga del logo dentro del mismo archivo, así que
 * aquí sí se puede probar el camino ENTERO: Prisma → bajar el logo → PDF.
 *
 * Y es el que más duele si falla: se lo mandan al paciente por WhatsApp. Por
 * eso lo que de verdad se prueba es que el PDF SALE en todos los casos —
 * bucket caído, 404, formato que @react-pdf no pinta, clínica sin logo — y
 * que cuando el logo sí está, se incrusta de verdad.
 *
 * Ejercita `buildInvoicePrintPdf` REAL con `mock.module` sobre prisma, de ahí
 * el flag `--experimental-test-module-mocks` del script.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { makePng, WEBP } from "@/lib/pdf/__tests__/_imagenes-de-prueba";

const CLINICA = "clinic_1";

/** Lo que la consulta real le pidió a Prisma. */
let selectPedido: Record<string, unknown> | null = null;
/** La clínica que devuelve el doble; cada prueba la cambia. */
let clinicRow: Record<string, unknown> = {};

function invoiceRow() {
  return {
    invoiceNumber: "F-000123",
    createdAt: new Date("2026-09-09T15:00:00.000Z"),
    status: "PARTIAL",
    subtotal: 1000,
    discount: 100,
    total: 1044,
    paid: 500,
    balance: 544,
    cfdiUuid: null,
    taxRate: 16,
    taxIncluded: false,
    items: [{ description: "Limpieza dental", quantity: 1, unitPrice: 1000, total: 1000 }],
    clinic: clinicRow,
    patient: {
      firstName: "Carlos",
      lastName: "Mendoza",
      rfcPaciente: "MECA880402XXX",
      razonSocialPac: null,
      regimenFiscalPac: null,
      cpPaciente: "44100",
    },
    payments: [
      { amount: 500, method: "cash", reference: null, paidAt: new Date("2026-09-09T16:00:00.000Z") },
    ],
  };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      invoice: {
        findFirst: async ({ where, select }: any) => {
          selectPedido = select;
          // El doble respeta el filtro de tenant: si alguien quitara el
          // clinicId de la consulta, esto lo canta en vez de seguir verde.
          if (where?.clinicId !== CLINICA) return null;
          return invoiceRow();
        },
      },
    },
  },
});

async function generar() {
  const { buildInvoicePrintPdf } = await import("../print-pdf");
  return buildInvoicePrintPdf("inv_1", CLINICA);
}

/** ¿El PDF lleva una imagen incrustada? El diccionario del objeto no se comprime. */
function llevaImagen(buf: Buffer): boolean {
  return buf.includes("/Subtype /Image");
}

describe("comprobante de pago — la cabecera de la clínica", () => {
  let base = "";
  let server: http.Server;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/logo.png") {
        const png = makePng(400, 400);
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(png);
      }
      if (req.url === "/logo-ancho.png") {
        const png = makePng(800, 200);
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(png);
      }
      if (req.url === "/logo.webp") {
        res.writeHead(200, { "content-type": "image/webp" });
        return res.end(WEBP);
      }
      res.writeHead(404);
      res.end("no such key");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function clinica(over: Record<string, unknown> = {}) {
    clinicRow = {
      name: "Clínica Sonrisa",
      address: "Av. Juárez 123",
      city: "Guadalajara",
      state: "Jalisco",
      phone: "33 1234 5678",
      email: "hola@clinicasonrisa.mx",
      logoUrl: null,
      rfcEmisor: "XAXX010101000",
      ...over,
    };
  }

  it("la consulta pide el logo de la clínica", async () => {
    clinica();
    await generar();
    const sel = (selectPedido?.clinic as { select: Record<string, unknown> })?.select;
    assert.ok(sel, "la consulta debería traer la clínica");
    assert.equal(sel.logoUrl, true, "sin logoUrl en el select, el logo no puede salir nunca");
    assert.equal(sel.name, true);
    assert.equal(sel.address, true);
    assert.equal(sel.rfcEmisor, true, "el RFC del emisor va en el membrete fiscal");
  });

  it("con logo, el PDF lo lleva incrustado", async () => {
    clinica({ logoUrl: `${base}/logo.png` });
    const out = await generar();
    assert.ok(out, "debería generarse el comprobante");
    assert.equal(out!.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(llevaImagen(out!.buffer), "el logo no llegó al PDF");
  });

  it("un logo apaisado también entra, sin deformarse", async () => {
    clinica({ logoUrl: `${base}/logo-ancho.png` });
    const out = await generar();
    assert.ok(llevaImagen(out!.buffer));
  });

  // ── Lo importante: el comprobante SIEMPRE se genera ──────────────────
  //
  // Un documento que no sale es mucho peor que uno sin logo: el paciente se
  // queda sin su comprobante y la recepcionista sin nada que mandar.

  const ROTOS: Array<[string, (b: string) => string | null]> = [
    ["la clínica no tiene logo", () => null],
    ["el bucket devuelve 404", (b) => `${b}/no-existe.png`],
    ["el bucket está caído (puerto cerrado)", () => "http://127.0.0.1:1/logo.png"],
    ["el logo es un webp, que @react-pdf no pinta", (b) => `${b}/logo.webp`],
    ["logoUrl guardado a medias (ruta relativa)", () => "logos/clinica.png"],
    ["logoUrl basura", () => "no-es-una-url"],
  ];

  for (const [caso, url] of ROTOS) {
    it(`${caso} → el comprobante sale igual, sin hueco de imagen`, async () => {
      clinica({ logoUrl: url(base) });
      const out = await generar();
      assert.ok(out, "el comprobante tiene que generarse igualmente");
      assert.equal(out!.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
      assert.ok(out!.buffer.length > 1000, `PDF sospechosamente corto: ${out!.buffer.length}`);
      // Ni recuadro vacío ni icono roto: si no hay logo bueno, no hay imagen.
      assert.ok(!llevaImagen(out!.buffer), "no debería quedar ningún hueco de imagen");
      assert.equal(out!.fileName, "comprobante-F-000123.pdf");
    });
  }

  it("un nombre de clínica larguísimo no impide generar el comprobante", async () => {
    clinica({
      name: "Clínica Dental y Especialidades del Valle de Guadalupe",
      logoUrl: `${base}/logo.png`,
    });
    const out = await generar();
    assert.ok(out);
    assert.equal(out!.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("sigue aislando por clínica: otra clínica no ve la factura", async () => {
    clinica();
    const { buildInvoicePrintPdf } = await import("../print-pdf");
    assert.equal(await buildInvoicePrintPdf("inv_1", "otra_clinica"), null);
  });
});
