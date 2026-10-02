// ws1-t11 (11d) — NINGÚN camino de envío a pacientes se salta el freno de
// «Paciente de prueba / no contactar». Lee el código: si mañana alguien llama a
// Meta o manda un correo a un paciente por un camino nuevo, esto falla y dice
// dónde.
// Correr: npm run test:paciente-de-prueba
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(__dirname, "../../../..");
const SRC = join(RAIZ, "src");
// Los otros verticales tienen sus propios pacientes/contactos (y su propia
// exclusión, p. ej. RealtyContactOptOut); esta marca es del dental.
const FUERA = /(__tests__|\/realty\/|\/barber\/|\/edu\/|\/app\/(b|i|barber|barberias|inmobiliaria|inmobiliarias|instituto|instituciones)\/)/;

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const TODOS = archivos(SRC)
  .map((p) => ({ ruta: relative(RAIZ, p).replace(/\\/g, "/"), texto: readFileSync(p, "utf8") }))
  .filter((f) => !FUERA.test("/" + f.ruta));

/** Quita comentarios para no contar menciones. */
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WhatsApp: solo dos caminos hablan con Meta fuera de sendWhatsAppLogged, y los dos frenan", () => {
  const LLAMADA = /\bsendWhatsApp(Message|Template|Interactive|Document)\(/;
  const PERMITIDOS: Record<string, string> = {
    "src/lib/whatsapp.ts": "el cliente de Meta mismo",
    "src/lib/whatsapp/send-and-log.ts": "EL freno (sendWhatsAppLogged)",
    "src/app/api/whatsapp/webhook/route.ts": "respuestas del bot (frena con motivoParaNoContactar)",
    "src/app/api/inbox/threads/[id]/messages/route.ts": "respuesta a mano del Inbox (frena con motivoParaNoContactar)",
  };

  it("nadie más llama a Meta directo", () => {
    const fuera = TODOS.filter((f) => LLAMADA.test(sinComentarios(f.texto)) && !(f.ruta in PERMITIDOS)).map((f) => f.ruta);
    assert.deepEqual(fuera, [], "Envío a Meta sin pasar por sendWhatsAppLogged: usa sendWhatsAppLogged o añade el freno");
  });

  it("los caminos permitidos aplican el freno", () => {
    const sendAndLog = TODOS.find((f) => f.ruta === "src/lib/whatsapp/send-and-log.ts")!.texto;
    assert.match(sendAndLog, /motivoParaNoContactar\(/);
    assert.match(sendAndLog, /throw new PacienteNoContactarError\(\)/);
    // El freno va ANTES de la primera llamada a Meta.
    assert.ok(sendAndLog.indexOf("motivoParaNoContactar(") < sendAndLog.indexOf("await sendWhatsAppTemplate("));
    for (const ruta of ["src/app/api/whatsapp/webhook/route.ts", "src/app/api/inbox/threads/[id]/messages/route.ts"]) {
      const t = TODOS.find((f) => f.ruta === ruta)!.texto;
      assert.match(t, /motivoParaNoContactar\(/, `${ruta} no frena`);
    }
  });

  it("el bot ni piensa con el número de un paciente de prueba", () => {
    const t = TODOS.find((f) => f.ruta === "src/app/api/whatsapp/webhook/route.ts")!.texto;
    const turno = t.slice(t.indexOf("async function turnoDelBot("));
    assert.ok(turno.indexOf("motivoParaNoContactar(") < turno.indexOf("runBotTurn("));
  });
});

describe("Correo: todo correo a un paciente lleva `paciente` (o frena antes)", () => {
  // Correos que NO van a un paciente de una clínica: plataforma → clínica,
  // soporte, privacidad, afiliados, y el portal del paciente cuando ÉL pide
  // verificar su correo o recuperar su contraseña (no lo manda la clínica).
  const NO_PACIENTE = new Set([
    "src/lib/email.ts",
    "src/lib/affiliate-emails.ts",
    "src/lib/marketplace/module-activated-email.ts",
    "src/lib/billing/spei-directo.ts",
    "src/lib/support/notifications.ts",
    "src/lib/patient-portal/emails.ts",
    "src/app/api/arco/request/route.ts",
    "src/app/api/paciente/password/forgot/route.ts",
    "src/app/api/paciente/verify/resend/route.ts",
    "src/app/api/paciente/register/route.ts",
  ]);
  const FRENA_ANTES = new Set(["src/app/api/inbox/threads/[id]/messages/route.ts"]);

  it("cada sendEmail a un paciente pasa `paciente:`", () => {
    const faltan: string[] = [];
    for (const f of TODOS) {
      if (NO_PACIENTE.has(f.ruta)) continue;
      const t = sinComentarios(f.texto);
      let i = t.indexOf("sendEmail(");
      while (i !== -1) {
        const llamada = t.slice(i, i + 700);
        const cierre = llamada.indexOf("});");
        const cuerpo = cierre === -1 ? llamada : llamada.slice(0, cierre);
        if (!/paciente:/.test(cuerpo) && !FRENA_ANTES.has(f.ruta)) faltan.push(f.ruta);
        i = t.indexOf("sendEmail(", i + 1);
      }
    }
    assert.deepEqual(faltan, [], "Correo a paciente sin el freno: pasa `paciente: { clinicId, patientId }` a sendEmail");
  });

  it("la respuesta a mano por correo del Inbox frena antes de mandar", () => {
    const t = TODOS.find((f) => f.ruta === "src/app/api/inbox/threads/[id]/messages/route.ts")!.texto;
    assert.ok(t.indexOf("motivoParaNoContactar(") < t.indexOf("await sendEmail("));
  });
});

describe("Cargos automáticos", () => {
  it("firmar el control y la factura borrador de la nota clínica preguntan por la marca", () => {
    for (const ruta of ["src/app/actions/orthodontics/signTreatmentCard.ts", "src/app/api/clinical/route.ts"]) {
      const t = TODOS.find((f) => f.ruta === ruta)!.texto;
      assert.match(t, /esPacienteDePrueba\(/, `${ruta} factura solo sin mirar la marca`);
    }
  });
});
