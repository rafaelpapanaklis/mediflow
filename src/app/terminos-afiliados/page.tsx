import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos del Programa de Afiliados — DaleControl",
  description:
    "Términos del Programa de Afiliados de DaleControl: cómo se aprueba una cuenta, atribución de clínicas, modalidades de comisión, calendario de pagos, uso de marca y causales de cancelación.",
};

const LAST_UPDATED = "1 de agosto de 2026";
const PROVIDER = "DaleControl, marca operada por Efthymios Rafail Papanaklis (persona física)";
const CONTACT_EMAIL = "hola@dalecontrol.com";

export default function TerminosAfiliadosPage() {
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
          Términos del Programa de Afiliados
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3, #64748b)" }}>
          Última actualización: {LAST_UPDATED}
        </p>
      </header>

      <Section title="1. Quién opera el Programa y qué es">
        <p>
          {PROVIDER} (&quot;DaleControl&quot;) opera la plataforma DaleControl y su Programa de
          Afiliados (el &quot;Programa&quot;). El Programa permite a personas físicas o morales
          recomendar DaleControl a clínicas y recibir una comisión por aquellas que contraten una
          suscripción de pago.
        </p>
        <p>
          Participar en el Programa <b>no crea una relación laboral, de sociedad, de franquicia ni
          de representación</b> entre el afiliado y DaleControl. El afiliado actúa por cuenta
          propia y con sus propios medios.
        </p>
        <p>
          Estos términos aplican de forma complementaria a los{" "}
          <Link href="/terminos">Términos y Condiciones</Link> del servicio y al{" "}
          <Link href="/privacidad">Aviso de Privacidad</Link>.
        </p>
      </Section>

      <Section title="2. Cómo se es afiliado">
        <p>
          La participación se solicita desde el formulario de registro en{" "}
          <Link href="/afiliados/registro">/afiliados/registro</Link>. Cada solicitud pasa por una{" "}
          <b>revisión manual</b> y su aprobación es <b>discrecional</b>: DaleControl puede
          aprobarla o rechazarla sin obligación de justificar su decisión.
        </p>
        <p>
          Una cuenta aprobada puede ser <b>suspendida en cualquier momento</b> si el afiliado
          incumple estos términos. Participar en el Programa es gratuito: no existe cuota de
          inscripción ni de permanencia.
        </p>
      </Section>

      <Section title="3. Atribución de clínicas">
        <p>
          Cada clínica queda ligada al afiliado cuyo <b>link de referido o cupón</b> haya utilizado
          al momento de registrarse.
        </p>
        <p>
          <b>Una clínica pertenece a un solo afiliado.</b> La atribución se fija en el alta y no se
          transfiere después.
        </p>
        <p>
          El <b>autorreferido está prohibido</b>: un afiliado no puede darse de alta a sí mismo, ni
          dar de alta una clínica de la que sea titular, usando su propio link o cupón. El sistema
          bloquea el autorreferido y esa alta no genera comisión.
        </p>
      </Section>

      <Section title="4. Comisiones">
        <p>El Programa opera con dos modalidades de comisión:</p>
        <ul>
          <li>
            <b>Fijo recurrente.</b> Un monto fijo por plan que se paga por cada cobro de la
            suscripción de la clínica, mientras la clínica siga pagando y sin límite de tiempo.
          </li>
          <li>
            <b>Pago único.</b> Un solo monto por clínica, más alto que el fijo mensual, que se
            entrega una sola vez.
          </li>
        </ul>
        <p>
          La modalidad <b>se congela por clínica en el momento del alta</b>. Cambiar la modalidad
          de la cuenta afecta únicamente a las clínicas que el afiliado dé de alta después del
          cambio, nunca a las que ya tenía atribuidas.
        </p>
        <p>
          La comisión <b>empieza a generarse a partir del segundo cobro de la clínica</b>, porque
          el primer mes de la suscripción es promocional. Una suscripción anual, que se cobra
          completa y sin promoción, comisiona desde su primer cobro.
        </p>
        <p>
          Los <b>montos vigentes son los publicados en la página del Programa</b> (
          <Link href="/afiliados">/afiliados</Link>) y <b>pueden cambiar en cualquier momento</b>.
          Los cambios aplican a las comisiones futuras y <b>nunca a las comisiones ya
          generadas</b>.
        </p>
        <p>Las comisiones se calculan y se muestran en pesos mexicanos (MXN).</p>
      </Section>

      <Section title="5. Pagos">
        <p>
          Las comisiones generadas durante un mes se pagan <b>dentro de los primeros 10 días
          naturales del mes siguiente</b>.
        </p>
        <p>
          El pago se realiza por <b>transferencia SPEI</b> o por <b>PayPal</b>, a elección del
          afiliado desde su panel.
        </p>
        <p>
          El afiliado es responsable de mantener sus datos de pago correctos y actualizados. Un
          pago que falle por datos incorrectos o incompletos se reprograma al siguiente ciclo de
          pago.
        </p>
        <p>
          <b>Los datos fiscales, la emisión de los comprobantes que correspondan y el pago de los
          impuestos derivados de las comisiones corren por cuenta del afiliado.</b>
        </p>
      </Section>

      <Section title="6. Qué invalida una comisión">
        <p>No se genera comisión en los siguientes casos:</p>
        <ul>
          <li>Autorreferido.</li>
          <li>Alta fraudulenta, duplicada o realizada con datos falsos.</li>
          <li>Reembolso, contracargo o impago de la clínica referida.</li>
          <li>
            Spam: correo masivo no solicitado, mensajería masiva o publicación abusiva en foros y
            redes sociales.
          </li>
          <li>Suplantación de la marca DaleControl o de su personal.</li>
          <li>Publicidad engañosa o promesas de funciones que el sistema no tiene.</li>
          <li>
            Pujar por la marca &quot;DaleControl&quot; o variantes en anuncios pagados (Google Ads,
            Meta Ads y equivalentes).
          </li>
        </ul>
        <p>
          DaleControl puede cancelar las comisiones generadas por cualquiera de estas conductas y,
          en su caso, suspender la cuenta del afiliado.
        </p>
      </Section>

      <Section title="7. Uso de marca y materiales">
        <p>
          El afiliado puede usar el logotipo, los textos y los materiales que DaleControl le
          proporcione para promover el servicio, <b>sin modificarlos</b>.
        </p>
        <p>
          El afiliado <b>no puede</b> presentarse como DaleControl ni como su empleado o
          representante, ni crear sitios, perfiles o comunicaciones que puedan confundirse con los
          oficiales, ni registrar dominios, marcas o cuentas que incluyan &quot;DaleControl&quot;.
        </p>
        <p>
          La licencia de uso de marca y materiales termina junto con la participación del afiliado
          en el Programa.
        </p>
      </Section>

      <Section title="8. Terminación y modificaciones">
        <p>
          Cualquiera de las partes puede terminar la participación en el Programa <b>en cualquier
          momento y sin responsabilidad</b>.
        </p>
        <p>
          Si el afiliado termina su participación, <b>se le pagan las comisiones ya generadas</b>{" "}
          conforme al calendario de la sección 5.
        </p>
        <p>
          A partir de la terminación, el afiliado deja de percibir comisiones por las clínicas
          atribuidas y debe dejar de usar la marca y los materiales de DaleControl.
        </p>
        <p>
          <b>Modificaciones.</b> DaleControl podrá modificar estos términos. Los cambios se
          publicarán en esta misma URL con una nueva fecha de actualización y aplicarán a partir de
          su publicación.
        </p>
      </Section>

      <Section title="9. Contacto">
        <p>
          Dudas sobre el Programa: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <p style={{ fontSize: 14, color: "var(--text-2, #334155)" }}>
        <Link href="/afiliados">Volver al Programa de Afiliados</Link>
        {" · "}
        <Link href="/terminos">Términos y Condiciones del servicio</Link>
      </p>
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
