/**
 * A quién se le manda una factura o un recibo (ws1-t10): al RESPONSABLE DE PAGO del caso cuando lo hay.
 *
 *   npm run test:factura-destinatarios
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  destinatariosDeEnvio,
  estadoDeEnvioEnFicha,
  opcionesDeDestinoEnFicha,
  esDestinoDeEnvio,
  nombreConParentesco,
  type PersonaDeContacto,
} from "../destinatarios";
import { buildPaymentNotice } from "../payment-notice";

const paciente = (o: Partial<PersonaDeContacto> = {}): PersonaDeContacto => ({ nombre: "Sofía Ruiz", telefono: "5511111111", correo: "sofia@x.mx", ...o });
const madre = (o: Partial<PersonaDeContacto> = {}): PersonaDeContacto => ({ nombre: "Laura Ruiz", parentesco: "madre", telefono: "5522222222", correo: "laura@x.mx", ...o });

describe("destinatariosDeEnvio", () => {
  it("sin responsable: al paciente, como siempre (WhatsApp y correo)", () => {
    for (const canal of ["telefono", "correo"] as const) {
      const r = destinatariosDeEnvio({ paciente: paciente(), responsable: null, canal });
      assert.deepEqual(r.destinatarios.map((d) => [d.rol, d.valor]), [["paciente", canal === "telefono" ? "5511111111" : "sofia@x.mx"]]);
      assert.equal(r.sinContacto, false);
    }
  });

  it("con responsable con teléfono: al responsable (auto), no al paciente", () => {
    const r = destinatariosDeEnvio({ paciente: paciente(), responsable: madre(), canal: "telefono" });
    assert.deepEqual(r.destinatarios.map((d) => [d.rol, d.nombre, d.valor]), [["responsable", "Laura Ruiz", "5522222222"]]);
  });

  it("el responsable no tiene ese canal: cae al paciente (auto)", () => {
    const r = destinatariosDeEnvio({ paciente: paciente(), responsable: madre({ telefono: "  " }), canal: "telefono" });
    assert.deepEqual(r.destinatarios.map((d) => d.rol), ["paciente"]);
  });

  it("'ambos' manda a los dos; con un solo dato disponible, al que lo tiene; si comparten el número, un solo mensaje", () => {
    assert.deepEqual(destinatariosDeEnvio({ paciente: paciente(), responsable: madre(), canal: "correo", destino: "ambos" }).destinatarios.map((d) => d.rol), ["responsable", "paciente"]);
    assert.deepEqual(destinatariosDeEnvio({ paciente: paciente({ telefono: null }), responsable: madre(), canal: "telefono", destino: "ambos" }).destinatarios.map((d) => d.rol), ["responsable"]);
    const igual = destinatariosDeEnvio({ paciente: paciente({ telefono: "5522222222" }), responsable: madre(), canal: "telefono", destino: "ambos" });
    assert.equal(igual.destinatarios.length, 1, "el tutor dio el mismo número del hijo");
  });

  it("'paciente' y 'responsable' explícitos mandan solo a ese", () => {
    assert.deepEqual(destinatariosDeEnvio({ paciente: paciente(), responsable: madre(), canal: "telefono", destino: "paciente" }).destinatarios.map((d) => d.rol), ["paciente"]);
    assert.deepEqual(destinatariosDeEnvio({ paciente: paciente(), responsable: madre(), canal: "telefono", destino: "responsable" }).destinatarios.map((d) => d.rol), ["responsable"]);
  });

  it("el aviso de «no tiene» solo sale si NINGUNO tiene", () => {
    const ninguno = destinatariosDeEnvio({ paciente: paciente({ telefono: "" }), responsable: madre({ telefono: null }), canal: "telefono" });
    assert.equal(ninguno.sinContacto, true);
    assert.match(ninguno.motivo!, /Ni el responsable de pago \(Laura Ruiz \(madre\)\) ni el paciente tienen teléfono registrado/);
    // Con que uno tenga, no hay aviso.
    assert.equal(destinatariosDeEnvio({ paciente: paciente({ telefono: "" }), responsable: madre(), canal: "telefono" }).sinContacto, false);
    assert.equal(destinatariosDeEnvio({ paciente: paciente(), responsable: madre({ telefono: null }), canal: "telefono" }).sinContacto, false);
  });

  it("sin responsable y sin dato del paciente: el motivo habla solo del paciente", () => {
    const r = destinatariosDeEnvio({ paciente: paciente({ correo: "" }), responsable: null, canal: "correo" });
    assert.equal(r.sinContacto, true);
    assert.equal(r.motivo, "El paciente no tiene correo registrado.");
  });

  it("un correo que no parece correo no cuenta (el del responsable inválido cae al del paciente)", () => {
    const r = destinatariosDeEnvio({ paciente: paciente(), responsable: madre({ correo: "no-es-correo" }), canal: "correo" });
    assert.deepEqual(r.destinatarios.map((d) => d.rol), ["paciente"]);
    assert.equal(destinatariosDeEnvio({ paciente: paciente({ correo: "x" }), responsable: madre({ correo: "y" }), canal: "correo" }).sinContacto, true);
  });

  it("destino explícito a quien no tiene el dato: motivo de ESE", () => {
    const r = destinatariosDeEnvio({ paciente: paciente(), responsable: madre({ telefono: null }), canal: "telefono", destino: "responsable" });
    assert.match(r.motivo!, /^El responsable de pago \(Laura Ruiz \(madre\)\) no tiene teléfono registrado/);
  });

  it("valida el destino que llega del cliente", () => {
    assert.equal(esDestinoDeEnvio("ambos"), true);
    for (const malo of ["todos", "", 3, null, undefined, "AMBOS"]) assert.equal(esDestinoDeEnvio(malo), false, String(malo));
    assert.equal(nombreConParentesco({ nombre: "Ana", parentesco: " " }), "Ana");
  });
});

describe("la ficha de la factura", () => {
  it("sin responsable, igual que hoy: deshabilita solo si el PACIENTE no tiene", () => {
    assert.equal(estadoDeEnvioEnFicha({ correo: true, telefono: false }, "telefono").puede, false);
    assert.equal(estadoDeEnvioEnFicha({ correo: true, telefono: false }, "telefono").motivo, null, "el texto de siempre lo pone la ficha");
    assert.equal(estadoDeEnvioEnFicha({ correo: true, telefono: false }, "correo").puede, true);
    assert.equal(estadoDeEnvioEnFicha(undefined, "telefono").puede, true, "aún no se sabe: no se deshabilita");
  });

  it("con responsable con teléfono, se puede enviar aunque el paciente (un niño) no tenga", () => {
    const c = { correo: false, telefono: false, responsable: { nombre: "Laura Ruiz", parentesco: "madre", correo: true, telefono: true } };
    assert.equal(estadoDeEnvioEnFicha(c, "telefono").puede, true);
    assert.equal(estadoDeEnvioEnFicha(c, "correo").puede, true);
  });

  it("con responsable, el aviso sale solo si NINGUNO de los dos tiene, y nombra a los dos", () => {
    const c = { correo: false, telefono: false, responsable: { nombre: "Laura Ruiz", parentesco: "madre", correo: false, telefono: false } };
    const e = estadoDeEnvioEnFicha(c, "telefono");
    assert.equal(e.puede, false);
    assert.match(e.motivo!, /Ni el responsable de pago \(Laura Ruiz \(madre\)\) ni el paciente tienen teléfono/);
    assert.match(estadoDeEnvioEnFicha(c, "correo").motivo!, /tienen correo/);
  });

  it("las opciones de destino solo existen con responsable, y ofrecen al paciente solo si tiene", () => {
    assert.deepEqual(opcionesDeDestinoEnFicha({ correo: true, telefono: true }, "telefono"), []);
    const c = { correo: true, telefono: false, responsable: { nombre: "Laura Ruiz", parentesco: "madre", correo: true, telefono: true } };
    assert.deepEqual(opcionesDeDestinoEnFicha(c, "telefono").map((o) => o.valor), ["responsable"]);
    assert.deepEqual(opcionesDeDestinoEnFicha(c, "correo").map((o) => o.valor), ["responsable", "paciente", "ambos"]);
  });
});

describe("el texto del aviso al responsable", () => {
  const base = { clinicName: "Clínica Sonrisa", clinicPhone: "5599999999", invoiceNumber: "MF-1031", balance: 17000, items: [{ description: "Ortodoncia" }] };
  it("sin `aNombreDe` el aviso es el de siempre, palabra por palabra", () => {
    const { body } = buildPaymentNotice({ ...base, patient: { firstName: "Sofía", lastName: "Ruiz" } });
    assert.match(body, /^Hola Sofía Ruiz, te saludamos de Clínica Sonrisa\. Tienes un saldo pendiente de .* de tu nota MF-1031 \(Ortodoncia\)\./);
  });
  it("al responsable se le saluda a él y se dice de quién es la nota", () => {
    const n = buildPaymentNotice({ ...base, patient: { firstName: "Laura Ruiz", lastName: "" }, aNombreDe: "Sofía Ruiz" });
    assert.match(n.body, /^Hola Laura Ruiz, te saludamos de Clínica Sonrisa\. Hay un saldo pendiente de .* de la nota MF-1031 de Sofía Ruiz \(Ortodoncia\)\./);
    assert.equal(n.templateParams[0], "Laura Ruiz", "la plantilla de Meta conserva sus cuatro huecos");
    assert.equal(n.templateParams.length, 4);
  });
});

// ── El lector del responsable, con la base simulada ───────────────────────

const llamadas: { modelo: string; where?: any }[] = [];
let planesPrincipales: any[] = [];
let filasLigadas: any[] = [];
let casosPorId: any[] = [];
let columnaLigadaFalla = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findMany: async ({ where }: any) => {
          llamadas.push({ modelo: "plan", where });
          return where.invoiceId ? planesPrincipales : casosPorId;
        },
      },
      $queryRaw: async () => {
        if (columnaLigadaFalla) throw new Error('column "orthodonticTreatmentPlanId" does not exist');
        return filasLigadas;
      },
    },
  },
});

const guardian = (o: Record<string, unknown>) => ({ fullName: "Laura Ruiz", parentesco: "MOTHER", phone: " 5522222222 ", email: "laura@x.mx", ...o });

describe("contactosDeResponsablesDeFacturas", () => {
  it("la factura principal y las de controles/extras llegan al responsable de SU caso, en pocas consultas", async () => {
    const { contactosDeResponsablesDeFacturas } = await import("@/lib/orthodontics/responsable-telefono-db");
    llamadas.length = 0;
    columnaLigadaFalla = false;
    planesPrincipales = [{ invoiceId: "f-principal", responsibleGuardian: guardian({}) }];
    filasLigadas = [{ id: "f-control", plan: "caso-1" }, { id: "f-sin-responsable", plan: "caso-2" }];
    casosPorId = [{ id: "caso-1", responsibleGuardian: guardian({ fullName: "Pedro Ruiz", phone: null }) }, { id: "caso-2", responsibleGuardian: null }];
    const m = await contactosDeResponsablesDeFacturas("clinica-1", ["f-principal", "f-control", "f-sin-responsable", "f-suelta", "f-principal"]);
    assert.deepEqual([...m.keys()].sort(), ["f-control", "f-principal"]);
    assert.equal(m.get("f-principal")!.telefono, "5522222222", "recortado");
    assert.equal(m.get("f-control")!.nombre, "Pedro Ruiz");
    assert.equal(m.get("f-control")!.telefono, null);
    // Todo filtrado por la clínica de la sesión, y una tanda por paso (no una por factura).
    assert.equal(llamadas.length, 2);
    for (const l of llamadas) assert.equal(l.where.clinicId, "clinica-1");
    assert.deepEqual(llamadas[0].where.invoiceId.in, ["f-principal", "f-control", "f-sin-responsable", "f-suelta"]);
  });

  it("sin la columna de las facturas ligadas (o sin clínica o sin ids) no lanza: como si no hubiera responsable", async () => {
    const { contactosDeResponsablesDeFacturas } = await import("@/lib/orthodontics/responsable-telefono-db");
    columnaLigadaFalla = true;
    planesPrincipales = [];
    assert.equal((await contactosDeResponsablesDeFacturas("clinica-1", ["f1"])).size, 0);
    assert.equal((await contactosDeResponsablesDeFacturas("", ["f1"])).size, 0);
    assert.equal((await contactosDeResponsablesDeFacturas("clinica-1", [])).size, 0);
  });
});

// ── La forma de las rutas y de la ficha ───────────────────────────────────

const RAIZ = join(__dirname, "..", "..", "..", "..");
const codigo = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("las tres rutas de envío", () => {
  for (const [ruta, canal] of [["send-whatsapp", "telefono"], ["send-email", "correo"], ["send-receipt", "telefono"]] as const) {
    it(`${ruta}: resuelve el responsable en el servidor y manda a los destinatarios`, () => {
      const r = codigo(`src/app/api/invoices/[id]/${ruta}/route.ts`);
      assert.match(r, /contactoDelResponsableDeLaFactura\(ctx\.clinicId, invoice\.id\)/, "clinicId de la sesión, factura ya verificada");
      assert.match(r, new RegExp(`canal: "${canal}"`));
      assert.match(r, /for \(const d of destinatarios\)/);
      assert.match(r, /esDestinoDeEnvio\(pedido\?\.destino\)/, "el destino que manda el cliente se valida; el teléfono/correo NUNCA viene del cliente");
      assert.doesNotMatch(r, /pedido\??\.(telefono|correo|phone|email|to)\b/);
      // La visibilidad del paciente se comprueba ANTES de leer al responsable.
      assert.ok(r.indexOf("assertPatientVisible") < r.indexOf("contactoDelResponsableDeLaFactura("));
    });
  }
  it("los avisos de siempre siguen tal cual cuando NO hay responsable", () => {
    assert.match(codigo("src/app/api/invoices/[id]/send-whatsapp/route.ts"), /El paciente no tiene teléfono registrado\. Agrégalo en su expediente para poder avisarle por WhatsApp\./);
    assert.match(codigo("src/app/api/invoices/[id]/send-receipt/route.ts"), /El paciente no tiene teléfono registrado\./);
    const c = codigo("src/app/api/invoices/[id]/send-email/route.ts");
    assert.match(c, /El paciente no tiene correo registrado\. Agrégalo en su expediente para poder enviarle la factura\./);
    assert.match(c, /El correo registrado del paciente no parece válido/);
  });
  it("el tope de «un aviso de cobro al día» mira el teléfono del paciente Y el del responsable", () => {
    const r = codigo("src/app/api/invoices/[id]/send-whatsapp/route.ts");
    assert.match(r, /const telefonos = Array\.from\(new Set\(\[\.\.\.\(patientPhone \? \[patientPhone\] : \[\]\), \.\.\.\(responsable\?\.telefono \? \[responsable\.telefono\] : \[\]\)\]\)\)/);
  });
});

describe("la ficha y la ventana", () => {
  it("la ruta de condiciones trae al responsable solo por facturas ya filtradas por clínica y visibilidad", () => {
    const r = codigo("src/app/api/invoices/condiciones/route.ts");
    assert.match(r, /contactosDeResponsablesDeFacturas\(ctx\.clinicId, propias\.map/);
    assert.ok(r.indexOf("relatedPatientVisibilityAnd") < r.indexOf("contactosDeResponsablesDeFacturas("));
  });
  it("la tarjeta usa la regla compartida y ofrece a quién enviar", () => {
    const f = codigo("src/components/dashboard/factura-ficha-rediseno/fichas-factura.tsx");
    assert.match(f, /estadoDeEnvioEnFicha\(contacto, "telefono"\)/);
    assert.match(f, /estadoDeEnvioEnFicha\(contacto, "correo"\)/);
    assert.match(f, /enviarFactura\(inv\.id, via, \{ linkPago: condiciones\?\.metodo === "mercadopago", forzar, destino \}\)/);
    assert.match(f, /A quién se envía la factura/);
  });
  it("la ventana completa no pide teléfono ni correo del paciente: llama a las mismas rutas, que deciden en el servidor", () => {
    const m = codigo("src/components/dashboard/billing/invoice-detail-modal.tsx");
    assert.match(m, /\/send-whatsapp/);
    assert.match(m, /\/send-receipt/);
    assert.doesNotMatch(m, /patient\??\.(phone|email)/, "un aviso de «sin teléfono» en el cliente ignoraría al responsable");
  });
});
