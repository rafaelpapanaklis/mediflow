import type { Metadata } from "next";
import { ArcoForm } from "./arco-form";

export const metadata: Metadata = {
  title: "Aviso de privacidad — MediFlow",
  description:
    "Aviso de privacidad integral conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).",
};

const LAST_UPDATED = "28 de abril de 2026";
const RESPONSIBLE_NAME = "MediFlow (operado por Rafael Papanaklis)";
const RESPONSIBLE_ADDRESS = "México · contacto: privacidad@mediflow.app";
const PRIVACY_EMAIL = "privacidad@mediflow.app";

export default function PrivacidadPage() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "clamp(20px, 4vw, 56px)",
        fontFamily: "var(--font-sora, 'Sora', system-ui, sans-serif)",
        color: "var(--text-1, #0f172a)",
        lineHeight: 1.6,
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700, marginBottom: 6 }}>
          Aviso de privacidad
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3, #64748b)" }}>
          Última actualización: {LAST_UPDATED}
        </p>
      </header>

      <Section title="1. Identidad y domicilio del responsable">
        <p>
          {RESPONSIBLE_NAME} (&quot;el Responsable&quot;) es responsable del tratamiento de
          sus datos personales en términos de la Ley Federal de Protección de Datos
          Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.
        </p>
        <p>
          <b>Domicilio para asuntos de privacidad:</b> {RESPONSIBLE_ADDRESS}.
        </p>
      </Section>

      <Section title="2. Datos personales que recabamos">
        <p>
          Para prestar los servicios de MediFlow, recabamos los siguientes datos:
        </p>
        <ul>
          <li>
            <b>Identificación:</b> nombre, apellidos, fecha de nacimiento, género, CURP
            (cuando se proporciona), pasaporte (pacientes extranjeros), domicilio, teléfono y correo electrónico.
          </li>
          <li>
            <b>Salud:</b> antecedentes médicos personales y heredofamiliares, alergias,
            padecimientos crónicos, medicamentos, signos vitales, diagnósticos, planes de
            tratamiento, recetas, estudios de imagen y notas clínicas (datos sensibles
            conforme al art. 3 fracc. VI de la LFPDPPP).
          </li>
          <li>
            <b>Financieros:</b> RFC, régimen fiscal, código postal de domicilio fiscal y
            registros de pagos cuando se requiere facturación CFDI.
          </li>
          <li>
            <b>Datos técnicos:</b> dirección IP, tipo de navegador y registros de acceso
            al sistema con fines de seguridad y auditoría (NOM-024-SSA3-2012).
          </li>
        </ul>
      </Section>

      <Section title="3. Finalidades del tratamiento">
        <p><b>Finalidades primarias</b> (necesarias para la relación jurídica):</p>
        <ul>
          <li>Operación del expediente clínico electrónico bajo NOM-004-SSA3-2012 y NOM-024-SSA3-2012.</li>
          <li>Gestión de la agenda, recordatorios, recetas y consentimientos.</li>
          <li>Emisión de comprobantes fiscales (CFDI) cuando proceda.</li>
          <li>Cumplimiento de obligaciones legales y atención de requerimientos sanitarios o judiciales.</li>
        </ul>
        <p><b>Finalidades secundarias</b> (puede oponerse sin afectar la atención):</p>
        <ul>
          <li>Mejora del servicio y comunicaciones operativas no comerciales.</li>
        </ul>
      </Section>

      <Section title="4. Transferencias">
        <p>
          Para la operación del servicio, sus datos pueden ser transferidos a los siguientes
          encargados, sujetos a contrato de confidencialidad y nivel de protección equivalente:
        </p>
        <ul>
          <li><b>Supabase, Inc.</b> — hosting de base de datos y autenticación.</li>
          <li><b>Vercel, Inc.</b> — hosting de la aplicación web.</li>
          <li><b>Twilio, Inc. / Postmark</b> — envío de WhatsApp, SMS y correos transaccionales.</li>
          <li><b>Stripe, Inc. / PayPal</b> — procesamiento de pagos cuando aplica.</li>
          <li><b>Daily.co</b> — sesiones de teleconsulta cuando aplica.</li>
          <li><b>Anthropic / OpenAI</b> — procesamiento de IA con datos disociados.</li>
        </ul>
        <p>
          NO transferimos sus datos a terceros con fines comerciales sin su consentimiento expreso.
        </p>
      </Section>

      <Section title="5. Derechos ARCO">
        <p>
          Usted tiene derecho a <b>Acceder, Rectificar, Cancelar u Oponerse</b> al tratamiento
          de sus datos personales, y a revocar el consentimiento otorgado. Puede ejercerlos:
        </p>
        <ul>
          <li>
            Enviando correo a <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>, o
          </li>
          <li>
            Completando el formulario al final de esta página.
          </li>
        </ul>
        <p>
          La respuesta a su solicitud se emitirá en un plazo máximo de <b>20 días hábiles</b>
          (LFPDPPP art. 32). En caso de aceptación, la rectificación, cancelación u oposición
          se hará efectiva en los <b>15 días</b> siguientes.
        </p>
        <p>
          Para acreditar su identidad, le pediremos copia de identificación oficial vigente
          y, en su caso, documento que acredite la representación legal.
        </p>
      </Section>

      <Section title="6. Revocación del consentimiento">
        <p>
          Puede revocar en cualquier momento el consentimiento otorgado al tratamiento de
          sus datos personales. La revocación no tendrá efectos retroactivos y, en su caso,
          no podrá interrumpir tratamientos médicos en curso.
        </p>
      </Section>

      <Section title="7. Conservación de la información">
        <p>
          Los datos del expediente clínico se conservan al menos <b>5 años</b> contados a
          partir del último acto médico (NOM-004-SSA3-2012, numeral 5.5). Datos fiscales
          se conservan conforme a la legislación aplicable.
        </p>
      </Section>

      <Section title="8. Cambios al aviso de privacidad">
        <p>
          Cualquier modificación al presente aviso se publicará en esta misma URL con la
          nueva fecha de actualización. Le recomendamos revisarlo periódicamente.
        </p>
      </Section>

      <Section title="9. Contacto">
        <p>
          Para cualquier duda relacionada con la protección de sus datos personales, contacte
          a: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>
      </Section>

      <hr style={{ margin: "40px 0", border: "none", borderTop: "1px solid var(--border-soft, #e2e8f0)" }} />

      <section id="arco" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Solicitud ARCO
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-2, #475569)", marginBottom: 20 }}>
          Use este formulario para ejercer su derecho de Acceso, Rectificación, Cancelación
          u Oposición. Recibirá respuesta en un plazo máximo de 20 días hábiles.
        </p>
        <ArcoForm />
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <div style={{ fontSize: 14, color: "var(--text-2, #334155)" }}>{children}</div>
    </section>
  );
}
