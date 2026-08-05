import type { Metadata } from "next";
import Link from "next/link";
import { getPayoutSettings } from "@/lib/affiliates/payout";
import { DEFAULT_MILESTONES, milestonesTotalMxn, milestoneTiers } from "@/lib/affiliates/payout-core";
import { fmtMxn } from "@/lib/affiliates/public-offer";

export const metadata: Metadata = {
  title: "Términos del Programa de Afiliados — DaleControl",
  description:
    "Términos del Programa de Afiliados de DaleControl: cómo se aprueba una cuenta, atribución de clínicas, modalidades de comisión, bono por clínicas activas, calendario de pagos, uso de marca y causales de cancelación.",
};

// Los umbrales y montos de los bonos SE LEEN de affiliate_payout_config, igual
// que en /afiliados: dos páginas que prometen cifras distintas serían un
// problema legal, no un descuido de copy. Por eso esta página también es ISR y
// el PUT del admin la revalida (ver @/lib/cache/public-pricing).
export const revalidate = 600;

const LAST_UPDATED = "5 de agosto de 2026";
const PROVIDER = "DaleControl, marca operada por Efthymios Rafail Papanaklis (persona física)";
const CONTACT_EMAIL = "hola@dalecontrol.com";

export default async function TerminosAfiliadosPage() {
  // Nunca lanza: sin BD (o con el SQL sin correr) caen los defaults del DDL.
  const settings = await getPayoutSettings().catch(() => ({ cfg: null, milestones: null }));
  const milestonesCfg = settings.milestones ?? { ...DEFAULT_MILESTONES };
  const hitos = milestoneTiers(milestonesCfg);
  const hitosOn = milestonesCfg.milestonesEnabled && hitos.length > 0;
  const hitoMayor = hitos.length > 0 ? hitos[hitos.length - 1] : null;

  // Numeración de las secciones. Va calculada porque la de bonos aparece y
  // desaparece con la promoción: un documento legal no puede saltar del 4 al 6,
  // y las referencias cruzadas ("conforme al calendario de la sección N") deben
  // seguir apuntando a donde apuntan.
  const S = {
    quien: 1,
    alta: 2,
    atribucion: 3,
    comisiones: 4,
    hitos: 5,
    pagos: hitosOn ? 6 : 5,
    invalida: hitosOn ? 7 : 6,
    marca: hitosOn ? 8 : 7,
    fin: hitosOn ? 9 : 8,
    contacto: hitosOn ? 10 : 9,
  };

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

      <Section title={`${S.quien}. Quién opera el Programa y qué es`}>
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

      <Section title={`${S.alta}. Cómo se es afiliado`}>
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

      <Section title={`${S.atribucion}. Atribución de clínicas`}>
        <p>
          Cada clínica queda ligada al afiliado cuyo <b>link de referido o cupón</b> haya utilizado
          al momento de registrarse.
        </p>
        <p>
          <b>Ventana de atribución: primer toque y 90 días.</b> Cuando la atribución viene de un
          link de referido, la decide el <b>primer</b> link de afiliado con el que la persona llegó
          al sitio. Ese primer ingreso se guarda en el navegador de esa persona y la ventana de
          atribución dura <b>90 días naturales</b>. Sobre esa regla se resuelven todos los casos:
        </p>
        <ul>
          <li>
            Si dentro de esos 90 días la persona vuelve por su cuenta —escribiendo la dirección,
            desde un buscador, desde redes sociales o por donde sea— y se registra, la clínica es
            del afiliado del <b>primer toque</b>.
          </li>
          <li>
            Si dentro de esos 90 días la persona hace clic en el link de <b>otro</b> afiliado, la
            atribución <b>sigue siendo del primero</b>. La ventana no se reasigna al último link
            utilizado ni se abre una segunda ventana en paralelo.
          </li>
          <li>
            Mientras la ventana esté abierta, <b>tiene prioridad</b> sobre el link o el cupón que
            se utilice al momento del alta. El <b>cupón</b> de afiliado atribuye la clínica cuando
            no hay una ventana de atribución abierta.
          </li>
          <li>
            Pasados los <b>90 días sin que la clínica se registre</b>, la ventana se cierra y ese
            contacto <b>ya no se atribuye a nadie</b>: quien se registre después, llegando por su
            cuenta, no genera comisión para ningún afiliado. La ventana <b>no se renueva ni se
            extiende</b> con visitas posteriores; solo un nuevo ingreso por un link de afiliado,
            una vez cerrada la anterior, abre una ventana nueva.
          </li>
          <li>
            La ventana vive en el navegador de la persona: si <b>borra las cookies</b>, navega en
            modo privado o entra desde <b>otro dispositivo o navegador</b>, la ventana se pierde.
            En ese caso la atribución solo puede darse si vuelve a entrar por un link de afiliado o
            si captura un cupón de afiliado al registrarse.
          </li>
        </ul>
        <p>
          Para sostener esa ventana, el sitio guarda en el navegador de la persona el código del
          afiliado, la campaña del link y la fecha del primer ingreso, <b>sin ningún dato
          personal</b>. El detalle está en el <Link href="/privacidad">Aviso de Privacidad</Link>.
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

      <Section title={`${S.comisiones}. Comisiones`}>
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

      {/* Los bonos son una PROMOCIÓN vigente: si se apaga en /admin, esta
          sección desaparece de los términos igual que de /afiliados. Ni un
          umbral ni un monto se escriben aquí. */}
      {hitosOn && hitoMayor && (
        <Section title={`${S.hitos}. Bono por Clínicas Activas`}>
          <p>
            Además de las comisiones de la sección {S.comisiones} —que siguen corriendo igual—, el Programa
            paga un <b>bono de una sola vez</b> al alcanzar cada uno de estos hitos de clínicas
            activas:
          </p>
          <ul>
            {hitos.map((hito) => (
              <li key={hito.n}>
                <b>{hito.clinics} clínicas activas</b> al mismo tiempo: {fmtMxn(hito.mxn)}.
              </li>
            ))}
          </ul>
          <p>
            Los bonos son <b>acumulables</b>: un afiliado que llega a {hitoMayor.clinics} clínicas
            activas habrá cobrado los {hitos.length}, {fmtMxn(milestonesTotalMxn(hitos))} en total.
            Los bonos son <b>adicionales</b> a las comisiones mensuales y no las sustituyen ni las
            interrumpen.
          </p>

          <p>Para que un bono se pague deben cumplirse todas estas condiciones:</p>
          <ul>
            <li>
              Cuentan las clínicas <b>activas al mismo tiempo</b>, no el total histórico de clínicas
              que el afiliado haya traído.
            </li>
            <li>
              Una clínica cuenta como activa cuando lleva <b>al menos 3 mensualidades pagadas</b> y
              su suscripción sigue vigente.
            </li>
            <li>
              El número de clínicas activas debe <b>sostenerse durante 3 meses consecutivos</b>{" "}
              antes de que el bono se pague.
            </li>
            <li>
              Cada clínica debe ser un <b>negocio distinto, con su propio titular</b>. Varias
              sucursales o razones sociales de un mismo grupo cuentan como una sola.
            </li>
            <li>
              Cada bono se entrega <b>una sola vez</b> por afiliado, aunque el número de clínicas
              baje y vuelva a subir.
            </li>
          </ul>
          <p>
            DaleControl <b>verifica el cumplimiento antes de pagar</b> cada bono: revisa las
            clínicas contabilizadas, sus pagos y su titularidad. La verificación puede tomar hasta
            el cierre del ciclo de pago siguiente al mes en que se cumplió la ventana.
          </p>
          <p>
            El bono de mayor monto ({fmtMxn(hitoMayor.mxn)}) <b>puede entregarse en dos partes</b>:
            la mitad al cumplirse la ventana de 3 meses y la otra mitad tres meses después, si el
            número de clínicas activas se sostiene.
          </p>
          <p>
            Las <b>altas fraudulentas, duplicadas, con datos falsos o de negocios relacionados entre
            sí</b> —o con el propio afiliado— no cuentan para los hitos e <b>invalidan el bono</b>,
            aunque ya se haya solicitado. Aplican además las causales de la sección {S.invalida}.
          </p>
          <p>
            Los <b>montos y umbrales vigentes son los publicados</b> en esta página y en{" "}
            <Link href="/afiliados">/afiliados</Link>. Son una <b>promoción</b>: DaleControl puede
            modificarla o darla por terminada en cualquier momento, sin afectar los bonos ya
            pagados ni los hitos ya cumplidos y verificados.
          </p>
        </Section>
      )}

      <Section title={`${S.pagos}. Pagos`}>
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

      <Section title={`${S.invalida}. Qué invalida una comisión`}>
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

      <Section title={`${S.marca}. Uso de marca y materiales`}>
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

      <Section title={`${S.fin}. Terminación y modificaciones`}>
        <p>
          Cualquiera de las partes puede terminar la participación en el Programa <b>en cualquier
          momento y sin responsabilidad</b>.
        </p>
        <p>
          Si el afiliado termina su participación, <b>se le pagan las comisiones ya generadas</b>{" "}
          conforme al calendario de la sección {S.pagos}.
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

      <Section title={`${S.contacto}. Contacto`}>
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
