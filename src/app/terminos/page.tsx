import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos y Condiciones — DaleControl",
  description:
    "Términos y condiciones del servicio DaleControl: software de gestión para clínicas en México. Suscripción, precios en MXN, renovación, cancelación y responsabilidades.",
};

const LAST_UPDATED = "24 de junio de 2026";
const PROVIDER = "DaleControl, marca operada por Efthymios Rafail Papanaklis (persona física)";
const SUPPORT_EMAIL = "soporte@dalecontrol.com";

export default function TerminosPage() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "clamp(20px, 4vw, 56px)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--text-1, #0f172a)",
        lineHeight: 1.6,
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700, marginBottom: 6 }}>
          Términos y Condiciones
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3, #64748b)" }}>
          Última actualización: {LAST_UPDATED}
        </p>
      </header>

      <Section title="1. Quiénes somos y aceptación">
        <p>
          {PROVIDER} (&quot;DaleControl&quot;) pone a disposición la plataforma de software
          disponible en dalecontrol.com (el &quot;Servicio&quot;). Al crear una cuenta,
          contratar un plan o usar el Servicio, usted (&quot;el Usuario&quot;) acepta estos
          Términos y Condiciones y el <Link href="/privacidad">Aviso de Privacidad</Link>. Si
          no está de acuerdo, no utilice el Servicio.
        </p>
      </Section>

      <Section title="2. Descripción del servicio">
        <p>
          DaleControl es una herramienta de software como servicio (SaaS) para la gestión
          administrativa y clínica de consultorios y clínicas: agenda, expediente clínico
          electrónico, recordatorios, recetas, facturación CFDI, análisis con inteligencia
          artificial y módulos relacionados.
        </p>
        <p>
          <b>DaleControl NO presta servicios de salud ni de atención médica.</b> Es una
          herramienta tecnológica. El Usuario (profesional de la salud o clínica) es el único
          responsable del acto médico, del diagnóstico, del tratamiento y del cumplimiento de
          las normas sanitarias aplicables.
        </p>
      </Section>

      <Section title="3. Registro, cuenta y elegibilidad">
        <p>
          Para usar el Servicio debe registrar una cuenta con información veraz, completa y
          actualizada. El Servicio está dirigido a profesionales de la salud, clínicas y su
          personal autorizado. El Usuario es responsable de la confidencialidad de sus
          credenciales y de toda actividad realizada desde su cuenta.
        </p>
        <p>
          El Usuario es responsable de contar con la cédula profesional y demás autorizaciones
          legales que su actividad requiera. DaleControl no verifica ni avala dichas
          credenciales.
        </p>
      </Section>

      <Section title="4. Planes, precios y facturación">
        <p>
          El Servicio se ofrece mediante planes de <b>suscripción de pago</b>. Los precios se
          expresan en pesos mexicanos (MXN) y se muestran en la página de planes al momento de
          la contratación. Los precios pueden incluir o causar el IVA conforme a la legislación
          aplicable.
        </p>
        <p>
          <b>No existe periodo de prueba gratuito.</b> La cuenta se crea en estado pendiente de
          pago y se activa únicamente una vez realizado el pago del plan elegido dentro del
          panel. Los métodos de pago disponibles pueden incluir tarjeta, SPEI y OXXO.
        </p>
        <p>
          La suscripción con tarjeta es <b>recurrente y se renueva automáticamente</b> por
          periodos iguales (mensual o anual) hasta que el Usuario la cancele. Los pagos por SPEI
          u OXXO cubren un único periodo y no se renuevan automáticamente.
        </p>
      </Section>

      <Section title="5. Renovación, cancelación y reembolsos">
        <p>
          El Usuario puede cancelar la renovación en cualquier momento desde el panel o
          escribiendo a <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. La cancelación
          detiene los cargos futuros; el acceso permanece activo hasta el final del periodo ya
          pagado.
        </p>
        <p>
          Salvo disposición legal en contrario, los pagos correspondientes a periodos ya
          iniciados no son reembolsables. Cualquier solicitud de reembolso se atenderá conforme
          a estos Términos y a la legislación de protección al consumidor aplicable.
        </p>
      </Section>

      <Section title="6. Suspensión por falta de pago y terminación">
        <p>
          La falta de pago puede ocasionar la suspensión del acceso al Servicio. DaleControl
          podrá suspender o terminar la cuenta del Usuario en caso de incumplimiento de estos
          Términos, uso indebido o por requerimiento legal.
        </p>
        <p>
          Tras la terminación, el Usuario podrá solicitar la exportación de su información dentro
          de un plazo razonable, sujeto a las obligaciones de conservación del expediente
          clínico (NOM-004-SSA3-2012).
        </p>
      </Section>

      <Section title="7. Uso aceptable y obligaciones del Usuario">
        <ul>
          <li>No usar el Servicio para fines ilícitos ni en violación de derechos de terceros.</li>
          <li>No intentar vulnerar la seguridad, integridad o disponibilidad del Servicio.</li>
          <li>Garantizar la veracidad y el respaldo de la información que captura.</li>
          <li>Obtener de sus pacientes los consentimientos que la ley exige.</li>
          <li>No compartir sus credenciales ni permitir accesos no autorizados.</li>
        </ul>
      </Section>

      <Section title="8. Datos de pacientes y responsabilidad clínica">
        <p>
          Respecto de los datos personales de los pacientes que el Usuario administra a través
          del Servicio, el <b>Usuario actúa como responsable</b> y DaleControl como{" "}
          <b>encargado</b> del tratamiento, en términos de la LFPDPPP. El Usuario es responsable
          de la licitud del tratamiento y de informar a sus pacientes.
        </p>
        <p>
          Las funciones de inteligencia artificial son de apoyo y <b>no sustituyen el criterio
          ni el diagnóstico profesional</b>. El Usuario es responsable de toda decisión clínica.
        </p>
      </Section>

      <Section title="9. Propiedad intelectual">
        <p>
          El software, la marca, el diseño y los contenidos del Servicio son propiedad de
          DaleControl y están protegidos por la legislación aplicable. La información clínica y
          los datos capturados por el Usuario son de su titularidad o de sus pacientes, según
          corresponda; DaleControl no reclama propiedad sobre ellos.
        </p>
      </Section>

      <Section title="10. Disponibilidad, soporte y respaldos">
        <p>
          DaleControl realiza esfuerzos razonables para mantener el Servicio disponible, pero no
          garantiza una disponibilidad ininterrumpida. Pueden existir ventanas de mantenimiento o
          interrupciones ajenas a nuestro control. Se recomienda al Usuario conservar sus propios
          respaldos de la información crítica.
        </p>
      </Section>

      <Section title="11. Limitación de responsabilidad">
        <p>
          En la máxima medida permitida por la ley, DaleControl no será responsable por daños
          indirectos, incidentales o consecuentes, ni por pérdida de datos, ingresos o utilidades
          derivados del uso o imposibilidad de uso del Servicio. La responsabilidad total de
          DaleControl no excederá el monto pagado por el Usuario en los tres (3) meses anteriores
          al hecho que origine la reclamación.
        </p>
      </Section>

      <Section title="12. Protección de datos personales">
        <p>
          El tratamiento de datos personales se rige por nuestro{" "}
          <Link href="/privacidad">Aviso de Privacidad</Link>, que forma parte integral de estos
          Términos.
        </p>
      </Section>

      <Section title="13. Modificaciones a los términos">
        <p>
          DaleControl podrá modificar estos Términos. Los cambios se publicarán en esta misma URL
          con una nueva fecha de actualización. El uso continuado del Servicio después de la
          publicación constituye la aceptación de los Términos vigentes.
        </p>
      </Section>

      <Section title="14. Legislación aplicable y jurisdicción">
        <p>
          Estos Términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier
          controversia, las partes se someten a la jurisdicción de los tribunales competentes en
          México, sin perjuicio de los derechos que la legislación de protección al consumidor
          (PROFECO) otorgue al Usuario.
        </p>
      </Section>

      <Section title="15. Contacto">
        <p>
          Dudas sobre estos Términos: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </Section>
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
