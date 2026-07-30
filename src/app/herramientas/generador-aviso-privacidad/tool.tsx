"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { DocActions } from "@/components/herramientas/doc-actions";

// ─────────────────────────────────────────────────────────────────────────────
// Generador de aviso de privacidad — 100% cliente.
//
// El documento se arma como UN SOLO STRING y se pinta con white-space: pre-wrap.
// Por qué así y no con JSX por secciones: "Copiar texto" e "Imprimir" tienen que
// entregar exactamente lo que el usuario ve. Con una sola fuente de verdad no hay
// forma de que la vista previa y el portapapeles se separen.
//
// Nada se envía a ningún servidor y nada se guarda: no hay fetch ni storage.
// ─────────────────────────────────────────────────────────────────────────────

const LEGAL_DISCLAIMER =
  "Plantilla orientativa. Revísala y adáptala con tu asesor legal antes de usarla; no constituye asesoría jurídica.";

/** Sin dato, el documento muestra el hueco a llenar en lugar de una frase rota. */
function slot(value: string, placeholder: string): string {
  const v = value.trim();
  return v === "" ? placeholder : v;
}

const PURPOSES = [
  {
    key: "expediente",
    name: "Expediente y atención clínica",
    note: "Historia clínica, diagnóstico, tratamiento y seguimiento.",
    line:
      "Integrar y conservar tu expediente clínico, elaborar tu historia clínica, diagnosticarte, brindarte tratamiento odontológico y dar seguimiento a tu evolución.",
  },
  {
    key: "recordatorios",
    name: "Recordatorios de citas",
    note: "Agendar, confirmar, recordar y reprogramar.",
    line: "Agendar, confirmar, recordar y reprogramar tus citas.",
  },
  {
    key: "facturacion",
    name: "Facturación y cobranza",
    note: "Comprobantes fiscales y control administrativo.",
    line:
      "Cobrar los servicios prestados, emitir los comprobantes fiscales que solicites y llevar el control administrativo y contable correspondiente.",
  },
] as const;

const CHANNELS = [
  {
    key: "whatsapp",
    name: "WhatsApp",
    line:
      "WhatsApp, al número que nos proporciones. En los mensajes evitamos incluir detalles de tu diagnóstico o tratamiento.",
  },
  {
    key: "email",
    name: "Correo electrónico",
    line: "Correo electrónico, a la dirección que nos proporciones.",
  },
  {
    key: "phone",
    name: "Teléfono",
    line: "Llamada telefónica al número que nos proporciones.",
  },
] as const;

const SECONDARY_LINE =
  "Enviarte promociones, recordatorios de prevención, felicitaciones y encuestas de satisfacción del consultorio.";

export function PrivacyNoticeTool() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [purposes, setPurposes] = useState<Record<string, boolean>>({
    expediente: true,
    recordatorios: true,
    facturacion: true,
  });
  const [promos, setPromos] = useState(false);
  const [channels, setChannels] = useState<Record<string, boolean>>({
    whatsapp: true,
    email: true,
    phone: true,
  });

  function togglePurpose(key: string) {
    setPurposes((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleChannel(key: string) {
    setChannels((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const doc = useMemo(() => {
    const who = slot(name, "[NOMBRE DEL CONSULTORIO O RESPONSABLE]");
    const where = slot(address, "[DOMICILIO DEL CONSULTORIO]");
    const mail = slot(email, "[CORREO ELECTRÓNICO DE CONTACTO]");
    const tel = slot(phone, "[TELÉFONO DE CONTACTO]");

    const primary = PURPOSES.filter((p) => purposes[p.key]).map((p) => `• ${p.line}`);
    const primaryBlock =
      primary.length > 0
        ? primary.join("\n")
        : "• [SELECCIONA AL MENOS UNA FINALIDAD EN EL GENERADOR]";

    const secondaryBlock = promos
      ? `• ${SECONDARY_LINE}\n\nSi no quieres que usemos tus datos para estas finalidades secundarias, dínoslo por cualquiera de los medios de contacto de este aviso. Tu negativa no será motivo para negarte la atención ni los servicios que solicites.`
      : "No usamos tus datos personales para finalidades distintas de las anteriores. No te enviamos publicidad ni promociones.";

    const chosenChannels = CHANNELS.filter((c) => channels[c.key]).map((c) => `• ${c.line}`);
    const channelBlock =
      chosenChannels.length > 0
        ? `${chosenChannels.join(
            "\n",
          )}\n\nSi prefieres que usemos sólo uno de estos medios, o que dejemos de contactarte, dínoslo y lo respetamos.`
        : "• [SELECCIONA AL MENOS UN MEDIO DE CONTACTO EN EL GENERADOR]";

    return `AVISO DE PRIVACIDAD SIMPLIFICADO

${who}, con domicilio en ${where}, es el responsable del uso y la protección de tus datos personales, en términos de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.

1. DATOS PERSONALES QUE RECABAMOS

• Datos de identificación y contacto: nombre, edad, fecha de nacimiento, domicilio, teléfono y correo electrónico.
• Datos de facturación, cuando los solicites: RFC, régimen fiscal y domicilio fiscal.
• Datos personales sensibles relacionados con tu salud: antecedentes médicos y odontológicos, alergias, padecimientos, medicamentos, diagnósticos, tratamientos realizados, radiografías, fotografías clínicas y estudios de laboratorio o gabinete.

Los datos de salud son datos personales sensibles: los recabamos únicamente para poder atenderte y los conservamos en tu expediente clínico.

2. PARA QUÉ USAMOS TUS DATOS

Finalidades primarias (necesarias para poder atenderte):
${primaryBlock}

Finalidades secundarias (no son necesarias para tu atención):
${secondaryBlock}

3. MEDIOS POR LOS QUE TE CONTACTAMOS

${channelBlock}

4. TRANSFERENCIAS Y PROVEEDORES

No vendemos tus datos personales ni los transferimos a terceros con fines comerciales. Para operar el consultorio podemos compartirlos con proveedores que nos prestan servicios y los tratan únicamente por cuenta nuestra y bajo nuestras instrucciones —por ejemplo: laboratorio dental, sistema de expediente clínico electrónico, servicio de facturación electrónica o servicio de mensajería—. Sólo transferiremos tus datos sin tu consentimiento en los supuestos previstos en el artículo 37 de la LFPDPPP o cuando lo requiera una autoridad competente.

5. TUS DERECHOS ARCO

Tienes derecho a conocer qué datos tuyos tenemos y para qué los usamos (Acceso), a pedir que corrijamos los que sean inexactos o incompletos (Rectificación), a solicitar que los eliminemos cuando consideres que no se están usando conforme a la ley (Cancelación) y a oponerte al uso de tus datos para un fin específico (Oposición). También puedes revocar en cualquier momento el consentimiento que nos hayas otorgado.

Para ejercer cualquiera de estos derechos, envía tu solicitud a ${mail} o comunícate al ${tel}. Tu solicitud debe incluir tu nombre, un medio para responderte, la descripción clara de lo que pides y una identificación oficial que acredite tu identidad o la representación de quien solicita. Te responderemos en un plazo máximo de 20 días hábiles.

Ten en cuenta que la cancelación de tus datos puede estar limitada: la normativa sanitaria nos obliga a conservar el expediente clínico durante un plazo mínimo, incluso si ya no eres nuestro paciente.

6. CONSERVACIÓN DEL EXPEDIENTE CLÍNICO

Conservamos tu expediente clínico por el plazo que exige la normativa sanitaria aplicable en México —al menos cinco años contados a partir del último acto médico— y al concluir ese plazo lo eliminamos o lo anonimizamos de forma segura.

7. MEDIDAS DE SEGURIDAD

Aplicamos medidas administrativas, técnicas y físicas razonables para proteger tus datos: acceso restringido al personal que participa en tu atención, cuentas y contraseñas individuales, resguardo de expedientes y respaldos periódicos.

8. CAMBIOS A ESTE AVISO DE PRIVACIDAD

Si modificamos este aviso, pondremos la versión vigente a la vista en el consultorio y te lo haremos saber por los medios de contacto que nos hayas proporcionado.

Fecha de última actualización: ____ / ____ / ________

Al proporcionarnos tus datos personales y recibir atención en este consultorio, reconoces que se puso a tu disposición este aviso de privacidad.


Nombre y firma del paciente, tutor o representante legal


_______________________________________          Fecha: ____ / ____ / ________
`;
  }, [name, address, email, phone, purposes, promos, channels]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__head">
        <ShieldCheck aria-hidden="true" style={{ width: 18, height: 18, color: "var(--b)" }} />
        <h2 className="tool-panel__title">Genera tu aviso de privacidad</h2>
        <span className="tool-panel__badge">
          <Lock aria-hidden="true" /> En tu navegador
        </span>
      </div>

      <div className="tool-panel__body">
        <div className="tool-alert tool-alert--legal" style={{ marginTop: 0 }}>
          <AlertTriangle aria-hidden="true" />
          <span>{LEGAL_DISCLAIMER}</span>
        </div>

        <div className="tool-fields" style={{ marginTop: 22 }}>
          <div className="tool-field">
            <label className="tool-label" htmlFor="ap-nombre">
              Nombre del consultorio o del responsable
            </label>
            <input
              id="ap-nombre"
              className="tool-input"
              type="text"
              value={name}
              placeholder="Clínica Dental Sonrisa / Dra. Ana Ruiz"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="ap-direccion">
              Domicilio
            </label>
            <input
              id="ap-direccion"
              className="tool-input"
              type="text"
              value={address}
              placeholder="Av. Reforma 120, int. 3, Col. Centro, CDMX"
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="ap-correo">
              Correo de contacto
            </label>
            <input
              id="ap-correo"
              className="tool-input"
              type="email"
              value={email}
              placeholder="contacto@tuclinica.mx"
              onChange={(e) => setEmail(e.target.value)}
            />
            <span className="tool-hint">Es el buzón donde recibirás las solicitudes ARCO.</span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="ap-telefono">
              Teléfono de contacto
            </label>
            <input
              id="ap-telefono"
              className="tool-input"
              type="tel"
              value={phone}
              placeholder="55 1234 5678"
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <fieldset className="tool-fieldset">
          <legend className="tool-fieldset__legend">
            ¿Para qué usas los datos de tus pacientes?
          </legend>
          <div className="tool-checks">
            {PURPOSES.map((p) => (
              <label key={p.key} className="tool-check">
                <input
                  type="checkbox"
                  checked={Boolean(purposes[p.key])}
                  onChange={() => togglePurpose(p.key)}
                />
                <span className="tool-check__body">
                  <span className="tool-check__name">{p.name}</span>
                  <span className="tool-check__note">{p.note}</span>
                </span>
              </label>
            ))}
            <label className="tool-check">
              <input type="checkbox" checked={promos} onChange={() => setPromos((v) => !v)} />
              <span className="tool-check__body">
                <span className="tool-check__name">Promociones y campañas</span>
                <span className="tool-check__note">
                  Finalidad secundaria: el paciente puede negarse sin perder la atención.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="tool-fieldset">
          <legend className="tool-fieldset__legend">¿Por qué medios contactas al paciente?</legend>
          <div className="tool-checks">
            {CHANNELS.map((c) => (
              <label key={c.key} className="tool-check">
                <input
                  type="checkbox"
                  checked={Boolean(channels[c.key])}
                  onChange={() => toggleChannel(c.key)}
                />
                <span className="tool-check__body">
                  <span className="tool-check__name">{c.name}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="tool-out">
          <p className="tool-bars__title" style={{ marginBottom: 4 }}>
            Vista previa del aviso
          </p>
          <DocActions text={doc} />
          <div className="tool-doc" tabIndex={0} role="document" aria-label="Aviso de privacidad generado">
            {doc}
          </div>
          <div className="tool-alert tool-alert--legal">
            <AlertTriangle aria-hidden="true" />
            <span>{LEGAL_DISCLAIMER}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
