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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { separacionCuerpoPie, textoVisiblePorPagina, textosPintados } from "@/lib/pdf/__tests__/_texto-del-pdf";

const CLINICA = "clinic_1";

/** Lo que la consulta real le pidió a Prisma. */
let selectPedido: Record<string, unknown> | null = null;
/** La clínica que devuelve el doble; cada prueba la cambia. */
let clinicRow: Record<string, unknown> = {};
/** Lo que una prueba quiera cambiar de la factura (conceptos, UUID…). */
let facturaExtra: Record<string, unknown> = {};
/** ws1-t10: las condiciones de cobro (`invoice_payment_terms`) de la factura; `null` = de un solo pago. */
let condicionesFila: Record<string, unknown> | null = null;
/** ws1-t10: si el doble de la base sabe contestar SQL crudo (sin él, el comprobante sale como siempre). */
let sqlCrudo = true;

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
      // La sonda `to_regclass` y la lectura de `invoice_payment_terms`.
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (!sqlCrudo) throw new Error("sin SQL crudo");
        const sql = strings.join("?");
        if (sql.includes("to_regclass")) return [{ existe: true }];
        return condicionesFila ? [condicionesFila] : [];
      },
      invoice: {
        findFirst: async ({ where, select }: any) => {
          selectPedido = select;
          // El doble respeta el filtro de tenant: si alguien quitara el
          // clinicId de la consulta, esto lo canta en vez de seguir verde.
          if (where?.clinicId !== CLINICA) return null;
          return { ...invoiceRow(), ...facturaExtra };
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

  it("factura larga y timbrada: el pie no tacha el cuerpo en ninguna página", async () => {
    // El pie más alto que puede salir: clínica + leyenda, UUID del CFDI y
    // «Página N de M». Con 45 conceptos el comprobante pagina y el Subtotal
    // cae al final de una hoja, justo encima del filete del pie.
    clinica({ logoUrl: `${base}/logo-ancho.png` });
    facturaExtra = {
      cfdiUuid: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
      items: Array.from({ length: 45 }, (_, i) => ({
        description: `Concepto ${i + 1} · Limpieza y profilaxis dental`,
        quantity: 1,
        unitPrice: 100,
        total: 100,
      })),
    };
    try {
      const out = await generar();
      const hojas = textoVisiblePorPagina(out!.buffer);
      assert.ok(hojas.length > 1, `el caso tiene que paginar: ${hojas.length}`);
      for (const h of hojas) assert.match(h, /Página \d+ de \d+/, "una hoja sale sin su pie");
      const medidas = separacionCuerpoPie(out!.buffer, (s) => /Página \d+ de|Comprobante|UUID/.test(s));
      for (const [i, m] of medidas.entries()) {
        assert.ok(
          m.separacion >= 18,
          `hoja ${i + 1}: el cuerpo baja hasta y=${m.cuerpoMasBajo.toFixed(1)} y el pie sube hasta y=${m.pieMasAlto.toFixed(1)} — el filete tacha un renglón`,
        );
      }
    } finally {
      facturaExtra = {};
    }
  });

  it("sigue aislando por clínica: otra clínica no ve la factura", async () => {
    clinica();
    const { buildInvoicePrintPdf } = await import("../print-pdf");
    assert.equal(await buildInvoicePrintPdf("inv_1", "otra_clinica"), null);
  });
});

// ── ws1-t10 · el PDF de una factura A PLAZOS explica cómo se paga ─────────

/** Todo lo que el PDF pinta, en un solo texto (renglones unidos por espacio). */
function textoDe(buf: Buffer): string {
  return textosPintados(buf).flat().map((t) => t.s).join(" ");
}

/** Como la de Rafael Clínica: total $38,000, enganche $8,000 + 15 pagos de $2,000, pagado $20,000 (enganche + 6 cuotas). */
function facturaAPlazos() {
  facturaExtra = {
    invoiceNumber: "PRUEBA-ORTO-0003",
    status: "PARTIAL",
    subtotal: 38000, discount: 0, total: 38000, paid: 20000, balance: 18000, taxRate: 0,
    items: [{ description: "Tratamiento de ortodoncia", quantity: 1, unitPrice: 38000, total: 38000 }],
    payments: [
      { amount: 8000, method: "transfer", reference: null, paidAt: new Date("2026-02-01T18:00:00.000Z") },
      { amount: 4000, method: "cash", reference: null, paidAt: new Date("2026-03-05T18:00:00.000Z") },
      { amount: 8000, method: "debit", reference: "AUT-1", paidAt: new Date("2026-04-05T18:00:00.000Z") },
    ],
  };
  condicionesFila = {
    invoiceId: "inv_1", modo: "plazos", metodo: null, enganche: 8000, numPagos: 15,
    frecuencia: "MONTHLY", primerPago: new Date("2026-02-01T00:00:00.000Z"), difiereConSuBanco: false,
  };
}

describe("comprobante de pago — factura a plazos (ws1-t10)", () => {
  after(() => { facturaExtra = {}; condicionesFila = null; sqlCrudo = true; });

  it("dice la forma de pago con la misma frase de la tarjeta y pinta el calendario completo", async () => {
    facturaAPlazos();
    const out = await generar();
    const t = textoDe(out!.buffer);
    if (process.env.VER_PDF) console.log(t);
    assert.match(t, /Forma de pago:/i);
    assert.match(t, /Enganche de \$8,000\.00 y 15 pagos mensuales de \$2,000\.00, el primero el 1 de marzo de 2026/);
    assert.match(t, /Plan de pagos/i);
    assert.match(t, /Enganche/);
    assert.match(t, /Pago 1 de 15/);
    assert.match(t, /Pago 15 de 15/);
    // Fechas dd/mm/aaaa con año: el enganche el 01/02/2026, la cuota 15 el 01/05/2027.
    assert.match(t, /01\/02\/2026/);
    assert.match(t, /01\/05\/2027/);
    // Concepto y total de siempre.
    assert.match(t, /Tratamiento de ortodoncia/);
    assert.match(t, /\$38,000\.00/);
  });

  it("cada cuota dice si está pagada (con su fecha), por vencer o vencida; y hay Pagado / Saldo", async () => {
    facturaAPlazos();
    const t = textoDe((await generar())!.buffer);
    assert.match(t, /Pagado el 01\/02\/2026/, "el enganche se saldó con el primer movimiento");
    assert.match(t, /Pagado el 05\/04\/2026/, "las cuotas siguientes, cuando el acumulado las alcanzó");
    assert.match(t, /Vencido/, "la cuota 7 venció el 01/09/2026");
    assert.match(t, /Por vencer/);
    assert.match(t, /Pagos recibidos/i);
    assert.match(t, /05\/03\/2026/);
    assert.match(t, /Transferencia/);
    assert.match(t, /Pagado/);
    assert.match(t, /Saldo/);
    assert.match(t, /\$20,000\.00/);
    assert.match(t, /\$18,000\.00/);
  });

  it("una factura de un solo pago (con o sin condiciones) sale IGUAL que siempre", async () => {
    facturaExtra = {};
    condicionesFila = null;
    const base = textoDe((await generar())!.buffer);
    assert.doesNotMatch(base, /Forma de pago|Plan de pagos|Pagos recibidos/i);
    assert.match(base, /Pagos realizados/i);
    assert.match(base, /Saldo pendiente/i);

    condicionesFila = { invoiceId: "inv_1", modo: "unico", metodo: "cash", enganche: 0, numPagos: 0, frecuencia: "MONTHLY", primerPago: null, difiereConSuBanco: false };
    const unico = textoDe((await generar())!.buffer);
    assert.doesNotMatch(unico, /Forma de pago|Plan de pagos/i);
    assert.match(unico, /Pagos realizados/i);
  });

  it("sin SQL crudo (tabla o base caída) el comprobante sale igual y no se cae", async () => {
    facturaAPlazos();
    sqlCrudo = false;
    try {
      const out = await generar();
      assert.ok(out);
      assert.doesNotMatch(textoDe(out!.buffer), /Plan de pagos/i);
    } finally {
      sqlCrudo = true;
    }
  });

  it("la lectura de las condiciones va acotada por la clínica de la sesión", async () => {
    const fuente = readFileSync(join(__dirname, "..", "print-pdf.tsx"), "utf8");
    assert.match(fuente, /leerCondicionesDeFacturas\(prisma, \{ clinicId, invoiceIds: \[id\] \}\)/);
  });
});
