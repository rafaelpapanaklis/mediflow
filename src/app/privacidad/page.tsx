import type { Metadata } from "next";
import { ArcoForm } from "./arco-form";

export const metadata: Metadata = {
  title: "Aviso de privacidad — DaleControl",
  description:
    "Aviso de privacidad integral conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).",
};

// Fecha de publicación (texto aprobado por el abogado; se publica con la integración de la ola del 26-sep).
const LAST_UPDATED = "30 de septiembre de 2026";
const RESPONSIBLE_NAME = "DaleControl (operado por Rafael Papanaklis)";
const RESPONSIBLE_ADDRESS = "México · contacto: privacidad@dalecontrol.com";
const PRIVACY_EMAIL = "privacidad@dalecontrol.com";
const SUPPORT_EMAIL = "contacto@dalecontrol.com";

export default function PrivacidadPage() {
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
          Para prestar los servicios de DaleControl, recabamos los siguientes datos:
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
          <li>
            <b>Datos de origen publicitario y de uso del sitio:</b> cuando usted llega a
            nuestro sitio desde un anuncio de Google, guardamos el identificador del clic
            de ese anuncio (llamado &quot;gclid&quot; y, en algunos dispositivos Apple,
            &quot;gbraid&quot; o &quot;wbraid&quot;) y la fecha del clic. Si más adelante
            crea una cuenta, lo asociamos a esa cuenta. También registramos, en nuestras
            herramientas de medición, dos acciones: que se creó una cuenta y que se realizó
            el primer pago de la suscripción (con el plan contratado y el importe sin IVA).{" "}
            <b>
              Estos datos no incluyen información de salud, de pacientes ni de expedientes
              clínicos.
            </b>
          </li>
          <li>
            <b>Datos de navegación (Píxel de Meta y analítica propia):</b> las páginas que
            visita en nuestro sitio, y de su visita datos como su dirección IP, su ubicación
            aproximada, su dispositivo y navegador. Si es personal de una clínica y ha iniciado
            sesión, nuestra analítica propia asocia esa visita a su cuenta (correo, nombre,
            rol, clínica y plan). Se
            describen en la sección 3. Nuestra analítica propia no lee lo que usted escribe en los
            formularios, y a Meta no le enviamos el contenido de expedientes, recetas ni notas
            clínicas.
          </li>
        </ul>
      </Section>

      <Section id="cookies" title="3. Cookies">
        <p>
          Una cookie es un archivo pequeño que el sitio guarda en su navegador para
          recordar algo entre una visita y otra. En el sitio público de DaleControl (las páginas que se ven sin iniciar sesión) usamos los siguientes tipos de cookies:
        </p>
        <ul>
          <li>
            <b>Cookies estrictamente necesarias.</b> Mantienen su sesión iniciada y
            protegen el acceso a su cuenta. Las gestiona nuestro proveedor de
            autenticación (Supabase) y sin ellas no es posible usar el sistema.
          </li>
          <li>
            <b>Cookie de atribución del Programa de Afiliados (&quot;dc_aff&quot;).</b> Se
            guarda únicamente cuando usted llega al sitio a través del link de
            recomendación de un afiliado (una dirección del tipo
            dalecontrol.com/r/codigo). Tiene una sola finalidad: saber a qué afiliado
            corresponde la recomendación si más adelante se contrata una suscripción,
            para poder pagarle su comisión.
          </li>
          <li>
            <b>Cookie del clic de un anuncio de Google (&quot;dc_ads&quot;).</b> Se guarda
            únicamente cuando usted llega al sitio desde un anuncio de Google (la dirección
            trae un identificador de clic). Tiene una sola finalidad: saber qué anuncio trajo
            a la persona que después crea una cuenta, para medir qué anuncios funcionan y
            poder informárselo a Google Ads.
            <br />
            <b>Qué guarda:</b> el identificador del clic (gclid, gbraid o wbraid) y la fecha
            en que se hizo. No guarda su nombre, su correo ni su dirección IP.
            <br />
            <b>Cuánto dura:</b> hasta <b>90 días</b> desde el clic; si llega desde otro
            anuncio, se reemplaza por el más reciente. La escribe nuestro servidor, no puede
            leerse desde el código que corre en su navegador (httpOnly), viaja solo por
            conexión segura (Secure) y no se envía a otros sitios (SameSite=Lax).
            <br />
            <b>Cómo se usa:</b> si usted crea una cuenta, el identificador se guarda junto a
            ella (ver secciones 4 y 8). Si no la crea, no lo asociamos a ninguna cuenta: solo
            queda la cookie hasta que caduque o usted la borre (y, como parte de nuestra
            analítica propia, el identificador del clic puede quedar en el registro de esa
            visita, ver más abajo «Analítica propia de DaleControl»).
          </li>
          <li>
            <b>Cookies del clic de un anuncio de Meta y de los UTM de la dirección
            (&quot;dc_meta&quot;, &quot;dc_utm1&quot; y &quot;dc_utm2&quot;).</b> Se guardan
            únicamente cuando usted llega al sitio desde un anuncio de Meta (la dirección trae
            un identificador de clic, &laquo;fbclid&raquo;) o desde un enlace con etiquetas de
            campaña (&laquo;utm_source&raquo;, &laquo;utm_medium&raquo;, &laquo;utm_campaign&raquo;
            y &laquo;utm_content&raquo;). Tienen una sola finalidad: saber qué anuncio o
            campaña trajo a la persona que después crea una cuenta, para medir qué anuncios
            funcionan.
            <br />
            <b>Qué guardan:</b> el identificador del clic de Meta y la fecha en que se hizo
            (&laquo;dc_meta&raquo;), y las etiquetas de campaña del primer enlace con el que
            llegó (&laquo;dc_utm1&raquo;) y del más reciente (&laquo;dc_utm2&raquo;), con su fecha.
            No guardan su nombre, su correo ni su dirección IP.
            <br />
            <b>Cuánto duran:</b> hasta <b>90 días</b>. Las escribe nuestro servidor, no pueden
            leerse desde el código que corre en su navegador (httpOnly), viajan solo por
            conexión segura (Secure) y no se envían a otros sitios (SameSite=Lax).
            <br />
            <b>Cómo se usan:</b> si usted crea una cuenta, estos datos se guardan junto a ella,
            junto con el valor de la cookie &laquo;_fbp&raquo; de Meta de su navegador, y se
            conservan según la sección 8. Si no la crea, no los asociamos a ninguna cuenta: solo
            quedan las cookies hasta que caduquen o usted las borre.
          </li>
          {/* Texto C. Google Signals en GA4 está DESACTIVADA (comprobado por Rafael,
              26-sep-2026): no se menciona publicidad personalizada. Ajuste 1 (ws7):
              lo que pasa dentro del panel se dice como es. Hechos en #424: gtag.js y
              gtag('config','AW-…') se cargan en TODAS las rutas (layout.tsx); GA4 no
              se configura en rutas privadas (PRIVATE_PATH_PATTERN); lo único que sale
              del panel es la conversión «Pago completado» de Ads y el `purchase` de GA4
              desde /dashboard/suspended/success (solo el primer pago). */}
          <li>
            <b>Cookies de Google Analytics y de Google Ads.</b> Usamos Google Analytics 4 y
            la etiqueta de Google Ads en el sitio público. Guardan en su navegador cookies
            propias de Google (por ejemplo &laquo;_ga&raquo;, &laquo;_ga_…&raquo; y
            &laquo;_gcl_aw&raquo;) que sirven para reconocer que un mismo navegador vuelve al
            sitio, contar visitas y medir la eficacia de nuestros anuncios. &laquo;_ga&raquo;
            dura hasta 2 años y &laquo;_gcl_aw&raquo; hasta 90 días. Los eventos que enviamos
            a Google son de negocio y son pocos:{" "}
            <b>
              se visitó una página pública, se creó una cuenta (&laquo;sign_up&raquo;,
              indicando si fue con correo o con Google) y se hizo el primer pago
              (&laquo;purchase&raquo;, con el importe sin IVA, la moneda MXN, el
              identificador de la operación y el plan)
            </b>
            .{" "}
            <b>
              Nunca enviamos datos de salud, de pacientes ni de expedientes, ni datos de
              tarjeta,
            </b>{" "}
            y{" "}
            <b>Google Analytics no mide visitas dentro del panel de la clínica ni en el portal del paciente</b>.
            La etiqueta de Google Ads sí se carga en todo el sitio, también dentro del panel y
            del portal, pero allí DaleControl no le envía ningún evento, salvo el aviso del
            primer pago, que sale desde la pantalla de confirmación del pago (dentro del
            panel) y llega a Google Ads y también a Google Analytics. Según Google, Analytics
            4 no registra ni almacena direcciones IP completas.
          </li>
          <li>
            <b>Píxel de Meta (Facebook e Instagram).</b> Usamos el Píxel de Meta en el sitio
            público para medir cuántas personas llegan desde nuestros anuncios de Meta. Al
            cargarse, Meta guarda en su navegador cookies propias (por ejemplo
            &laquo;_fbp&raquo;, y &laquo;_fbc&raquo; cuando usted llega desde un anuncio de
            Meta) que, según Meta, duran hasta 90 días. DaleControl envía a Meta solo tres
            eventos:{" "}
            <b>&laquo;PageView&raquo;: que se visitó una página pública</b>, en cada página
            que usted abre;{" "}
            <b>&laquo;CompleteRegistration&raquo;: que se creó una cuenta</b>, al terminar el
            registro; y{" "}
            <b>&laquo;Purchase&raquo;: el primer pago de la suscripción</b>, con su importe sin
            IVA y la moneda. Junto con cada evento, su navegador entrega a Meta la dirección de
            esa página, su dirección IP y datos del navegador. Los eventos de cuenta creada y
            primer pago también los envía nuestro servidor a Meta (API de Conversiones), para
            que cuenten aunque el navegador bloquee el Píxel y para medir los pagos por
            transferencia, que no pasan por ninguna página; con ellos van el correo y el
            teléfono de la cuenta{" "}
            <b>cifrados con un hash (SHA-256), nunca en claro</b>, la dirección IP y el
            navegador de quien se registró o pagó, y los valores de las cookies
            &laquo;_fbp&raquo; y &laquo;_fbc&raquo; (o del clic guardado en &laquo;dc_meta&raquo;),
            solo para que Meta pueda reconocer que vienen de una persona que vio un anuncio.
            No le enviamos su nombre ni otros datos de la cuenta.{" "}
            <b>
              Nunca enviamos datos de salud, de pacientes ni de expedientes, ni datos de
              tarjeta,
            </b>{" "}
            y el Píxel <b>no se carga dentro del panel de la clínica ni en el portal del paciente</b>,
            salvo en la pantalla que confirma el primer pago, donde solo envía el evento de
            pago (sin rastrear clics ni el contenido de la página).
          </li>
          <li>
            <b>Chat de soporte (Tawk.to).</b> En la página principal del sitio público (no
            en el panel de la clínica, ni en el portal del paciente, ni en el registro)
            cargamos el chat de la web de Tawk.to, un servicio de un tercero con el que puede
            escribirnos para pedir información o soporte. Al cargarse, Tawk.to guarda en su
            navegador cookies propias para reconocer que es el mismo visitante y conservar su
            conversación; su duración la fija Tawk.to. Si usted escribe en el chat, Tawk.to
            recibe lo que escriba (por ejemplo su nombre, su correo o su mensaje) y los datos
            técnicos de la visita (dirección IP, navegador y ubicación aproximada), que
            usamos únicamente para atenderle. Le pedimos no escribir en el chat datos de salud
            ni datos de pacientes. El chat es opcional:{" "}
            <b>puede bloquear las cookies de Tawk.to</b> desde la configuración de su
            navegador o con un bloqueador de contenido; el sitio funciona igual y el chat
            simplemente no aparece.
          </li>
          <li>
            <b>Vercel Analytics y Speed Insights.</b> Servicios de Vercel, Inc. que usamos
            para medir las visitas y el rendimiento (velocidad) del sitio.
          </li>
          <li>
            <b>Analítica propia de DaleControl (identificador en el almacenamiento local de su navegador).</b>{" "}
            Medimos cómo se usa el sitio y el sistema con una herramienta nuestra, no de un
            tercero. Para reconocer que un mismo navegador vuelve, guarda en el
            almacenamiento local de su navegador (algo parecido a una cookie) un
            identificador de visitante aleatorio (&laquo;dc_vid&raquo;) y uno de sesión
            (&laquo;dc_sid&raquo;), que cambia tras 30 minutos sin actividad.{" "}
            <b>
              El identificador de visitante no caduca solo: permanece hasta que usted borre
              los datos del sitio en su navegador.
            </b>
            <br />
            <b>Qué registra:</b> las páginas o pantallas que visita (su dirección, sin lo que
            va después del signo &laquo;?&raquo;, y el título de la página), sus clics
            (posición en la pantalla y un identificador técnico del elemento; solo en el
            sitio público, además, el texto del botón o enlace pulsado, hasta 60 caracteres),
            cuánto baja por la página y cuánto tiempo permanece; y de su visita, la página de
            origen, los parámetros de campaña de la dirección (los &laquo;utm_…&raquo;) y, si
            llega desde un anuncio de Google, el identificador de clic (gclid), además de su{" "}
            <b>dirección IP</b>, su <b>ubicación aproximada</b> (país, región, ciudad y
            coordenadas), tipo de dispositivo, navegador, sistema operativo, tamaño de
            pantalla, idioma y zona horaria.
            <br />
            <b>Si usted es personal de una clínica y ha iniciado sesión</b>, asociamos la
            visita a su cuenta: su correo, su nombre, su rol, la clínica y el plan contratado.
            <br />
            <b>Qué no registra:</b> lo que usted escribe en formularios y campos (nunca se
            lee el contenido de un campo) ni el contenido de expedientes, recetas o notas
            clínicas. La dirección de una pantalla del sistema puede incluir el código
            interno de un registro.
            <br />
            <b>Dónde funciona:</b> en el sitio público y también dentro del panel de la
            clínica y de los paneles de afiliados, proveedores y laboratorios.{" "}
            <b>No mide el portal del paciente</b> (ni sus enlaces de acceso), el panel de
            administración de DaleControl ni las pantallas en vivo de la clínica.
            <br />
            <b>Cuánto se conserva:</b> ver la sección 8.
          </li>
        </ul>
        <p>
          <b>Qué guarda la cookie de atribución:</b> el código del afiliado, el nombre de
          la campaña del link (cuando el link trae una) y la fecha de ese primer ingreso.{" "}
          <b>No contiene datos personales:</b> no guarda su nombre, ni su correo, ni su
          dirección IP, ni ningún dato que permita identificarlo.
        </p>
        <p>
          <b>Cuánto dura:</b> <b>90 días</b> contados desde ese primer ingreso. La escribe
          nuestro servidor y no puede leerse desde el código que corre en su navegador
          (httpOnly), viaja solo por conexión segura (Secure) y no se envía a otros sitios
          (SameSite=Lax). Cumplidos los 90 días caduca sola y deja de atribuir la
          recomendación a nadie; tampoco se renueva con visitas posteriores.
        </p>
        <p>
          <b>No se comparte con terceros:</b> el contenido de esta cookie no se vende ni se
          cede, no se usa con fines publicitarios ni para elaborar perfiles sobre usted, y
          no alimenta ninguna herramienta de análisis.{" "}
          <i>
            Lo anterior se refiere únicamente a la cookie de atribución de afiliados
            (&quot;dc_aff&quot;). Las cookies de anuncios y de analítica se describen en los
            apartados anteriores.
          </i>
        </p>
        <p>
          <b>Aceptación por uso del sitio:</b> al continuar navegando en este sitio se entiende
          que usted acepta el uso de las cookies descritas en esta sección, conforme a este
          Aviso de privacidad. No mostramos un botón de aceptar ni bloqueamos contenido; usted
          puede desactivarlas o borrarlas en cualquier momento, como se explica a continuación.
        </p>
        <p>
          <b>Cómo borrar o bloquear las cookies de anuncios y de analítica:</b> puede
          eliminar o bloquear en cualquier momento las cookies de este sitio desde la
          configuración de su navegador (normalmente en la sección de privacidad o de datos
          de navegación), y así se deja de reconocer su navegador y se deja de medir el
          anuncio con el que llegó. El sitio funciona igual sin ellas. Además, Google ofrece
          un complemento para desactivar Google Analytics en su navegador
          (tools.google.com/dlpage/gaoptout) y una página para gestionar los anuncios
          personalizados (adssettings.google.com). Si bloquea o borra las cookies de sesión,
          tendrá que iniciar sesión de nuevo.
        </p>
        <p>
          <b>Píxel de Meta y analítica propia:</b> las cookies de Meta se eliminan o bloquean
          igual que las demás, desde su navegador; también puede administrar los anuncios que
          Meta le muestra desde la configuración de anuncios de su cuenta de Facebook o
          Instagram. El identificador de nuestra analítica propia está en el almacenamiento
          local del navegador: se elimina borrando los datos del sitio en su navegador
          (distinto de borrar solo las cookies). Al borrarlo, su navegador se vuelve a
          reconocer como un visitante nuevo; no borra los registros que ya guardamos
          (ver secciones 6 y 8).
        </p>
      </Section>

      <Section title="4. Finalidades del tratamiento">
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
          <li>
            Medir qué anuncios y campañas de publicidad de DaleControl traen nuevos
            clientes, y compartir con Google, en forma de eventos de &laquo;cuenta
            creada&raquo; y &laquo;primer pago&raquo;, el resultado de esa medición para
            evaluar y mejorar dichas campañas.
          </li>
          <li>
            Conocer cómo se usa el sitio y el sistema (páginas visitadas, clics, tiempo y
            origen de las visitas) con nuestra analítica propia y con el Píxel de Meta,
            para mejorar el servicio y medir nuestra publicidad, y compartir con Meta, en
            forma de eventos de &laquo;cuenta creada&raquo; y &laquo;primer pago&raquo;, el
            resultado de esa medición para evaluar y mejorar nuestras campañas en Facebook e
            Instagram.
          </li>
        </ul>
      </Section>

      <Section title="5. Transferencias">
        <p>
          Para la operación del servicio, sus datos pueden ser transferidos a los siguientes
          encargados, sujetos a contrato de confidencialidad y nivel de protección equivalente:
        </p>
        <ul>
          <li><b>Supabase, Inc.</b> — hosting de base de datos y autenticación.</li>
          <li><b>Vercel, Inc.</b> — hosting de la aplicación web y medición de visitas y rendimiento del sitio (Vercel Analytics y Speed Insights).</li>
          <li><b>Twilio, Inc. / Postmark</b> — envío de WhatsApp, SMS y correos transaccionales.</li>
          <li><b>Stripe, Inc. / PayPal / MercadoPago</b> — procesamiento de pagos cuando aplica.</li>
          <li><b>FacturAPI / Proveedores autorizados de CFDI</b> — emisión de comprobantes fiscales.</li>
          <li><b>Daily.co</b> — sesiones de teleconsulta cuando aplica.</li>
          <li><b>Anthropic / OpenAI</b> — procesamiento de IA con datos disociados (radiografías).</li>
          <li>
            <b>Google LLC</b> — medición de visitas (Google Analytics) y de conversiones de
            nuestros anuncios (Google Ads), con los eventos y el identificador de clic
            descritos en la sección 3.
          </li>
          <li>
            <b>Google LLC (Google Calendar)</b> — solo si la clínica conecta su cuenta de Google,
            las citas de la clínica se escriben en un calendario de esa cuenta. Es una
            integración opcional, con el alcance descrito en la sección 9.
          </li>
          <li>
            <b>Meta Platforms, Inc.</b> — medición de visitas al sitio público, de cuentas
            creadas y del primer pago con el Píxel de Meta y la API de Conversiones, con lo
            descrito en la sección 3.
          </li>
          <li>
            <b>Tawk.to</b> — chat de soporte de la página principal del sitio público, con lo
            descrito en la sección 3: recibe lo que usted escriba en el chat y los datos
            técnicos de la visita.
          </li>
          <li>
            <b>IPinfo (ipinfo.io)</b> — servicio de ubicación por dirección IP de nuestra
            analítica propia: se le envía únicamente la dirección IP de la visita, ningún
            otro dato, para obtener país, región y ciudad aproximados.
          </li>
        </ul>
        <p>
          No transferimos sus datos a terceros con fines comerciales sin su consentimiento
          expreso. La única información que compartimos con Google para medir nuestra
          publicidad es la descrita en la sección 3 (visitas al sitio público, cuenta creada y
          primer pago, y el identificador del clic del anuncio), sin datos de salud ni de
          pacientes. Con Meta compartimos únicamente lo que describe la sección 3 (visitas a
          las páginas públicas, cuenta creada y primer pago, con el correo y el teléfono
          cifrados con un hash), sin datos de salud ni de pacientes.
        </p>
      </Section>

      <Section title="6. Derechos ARCO">
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
        <p>
          <b>Para oponerse a la medición de anuncios:</b> puede pedirnos en cualquier momento
          que dejemos de usar el identificador de clic asociado a su cuenta y que lo
          eliminemos, escribiendo a <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> o
          con el formulario de solicitud ARCO al final de esta página. Le responderemos en el
          mismo plazo de 20 días hábiles. Oponerse a esta medición no afecta su servicio ni la
          atención de su clínica. Para que no se guarden nuevos datos de este tipo, también
          puede borrar o bloquear las cookies como se indica en la sección 3. Lo mismo puede
          pedirnos respecto de los registros de nuestra analítica propia asociados a su
          cuenta.
        </p>
      </Section>

      <Section title="7. Revocación del consentimiento">
        <p>
          Puede revocar en cualquier momento el consentimiento otorgado al tratamiento de
          sus datos personales. La revocación no tendrá efectos retroactivos y, en su caso,
          no podrá interrumpir tratamientos médicos en curso.
        </p>
      </Section>

      <Section title="8. Conservación de la información">
        <p>
          Los datos del expediente clínico se conservan al menos <b>5 años</b> contados a
          partir del último acto médico (NOM-004-SSA3-2012, numeral 5.5). Datos fiscales
          se conservan conforme a la legislación aplicable.
        </p>
        <p>
          <b>Clic de un anuncio de Google.</b> El identificador del clic de un anuncio se
          guarda en la cookie &laquo;dc_ads&raquo; hasta 90 días. Si usted crea una cuenta, se
          conserva asociado a ella durante <b>12 meses contados desde que se registra la
          cuenta</b> y después se elimina automáticamente; si la cuenta se elimina antes, o
          usted lo solicita antes, se elimina en ese momento.
        </p>
        <p>
          <b>Clic de un anuncio de Meta y UTM.</b> Las cookies &laquo;dc_meta&raquo;,
          &laquo;dc_utm1&raquo; y &laquo;dc_utm2&raquo; duran hasta 90 días. Si usted crea una
          cuenta, el identificador del clic de Meta, las etiquetas de campaña y el valor de
          &laquo;_fbp&raquo; se conservan asociados a ella durante <b>12 meses contados desde
          que se registra la cuenta</b> y después se eliminan automáticamente, igual que el
          clic de Google; si la cuenta se elimina antes, o usted lo solicita antes, se
          eliminan en ese momento.
        </p>
        <p>
          <b>Analítica propia.</b> Los registros de cada clic y de cada página visitada se
          eliminan automáticamente a los <b>90 días</b>. El registro de cada visita (que
          incluye la dirección IP, la ubicación aproximada, el dispositivo, el identificador
          de clic si lo hubo y, si inició sesión, su correo, nombre, rol, clínica y plan) se
          elimina automáticamente a los <b>365 días</b> de haberse iniciado. Los datos que
          reciben Google, Meta y Tawk.to se conservan según sus propias políticas.
        </p>
      </Section>

      <Section id="google-calendar" title="9. Datos de Google Calendar (integración opcional)">
        <p>
          DaleControl puede conectarse a Google Calendar <b>solo si un administrador de la
          clínica lo decide</b> desde Configuración &rarr; Integraciones y autoriza el acceso
          en la pantalla de consentimiento de Google. Sin esa conexión, DaleControl no accede
          a ningún dato de Google Calendar. Esta sección explica qué datos de Google se
          usan, para qué, cómo se protegen y cómo retirarlos.
        </p>

        <p><b>Permisos que solicitamos a Google.</b></p>
        <ul>
          <li>
            <b>Calendar &mdash; <code>https://www.googleapis.com/auth/calendar.app.created</code></b>:
            crear un calendario secundario para la clínica y ver, crear, cambiar y borrar
            eventos <b>únicamente en ese calendario</b>, el que DaleControl crea. No podemos
            leer ni modificar sus demás calendarios ni los eventos de su calendario personal.
          </li>
          <li>
            <b>Identidad &mdash; <code>openid</code> y <code>email</code></b>: conocer el
            correo de la cuenta de Google conectada, para mostrarle a la clínica qué cuenta
            está conectada y no permitir que se conecte otra encima por error.
          </li>
        </ul>

        <p><b>Qué datos escribimos en su Google Calendar.</b> Por cada cita de la clínica, en el
          calendario de la clínica: el tipo de cita, el horario, el nombre del doctor, el
          nombre y la dirección de la clínica y, en el título del evento, el nombre de pila
          del paciente con la inicial de su apellido. Como invitados se agrega el correo del
          doctor y, si la clínica mantiene activa la opción «Enviar invitación por correo al
          paciente» (Configuración &rarr; Integraciones), el correo del paciente, a quien
          Google le envía la invitación. <b>Las notas internas de la cita y los datos clínicos
          (diagnósticos, antecedentes, tratamientos, estudios) nunca se envían a Google.</b>
        </p>

        <p><b>Qué datos leemos de Google.</b> El correo de la cuenta conectada y el
          identificador del calendario de la clínica y de los eventos que DaleControl crea,
          para mantenerlos al día (moverlos o cancelarlos cuando la cita cambia). No leemos
          eventos creados por otras personas o aplicaciones, y lo que se edite o borre
          directamente en Google Calendar no modifica la agenda de DaleControl.
        </p>

        <p><b>Para qué los usamos.</b> Exclusivamente para reflejar las citas de la clínica en
          su Google Calendar y mantenerlas al día, y para mostrar en la pantalla de
          Integraciones si la conexión está activa. No usamos los datos de Google para
          publicidad ni para crear perfiles, no los vendemos, no los usamos para entrenar
          modelos de inteligencia artificial y no los enviamos a los proveedores de IA
          mencionados en la sección 5.
        </p>

        <p><b>Cómo los protegemos y con quién se comparten.</b> Las credenciales de acceso que
          Google nos entrega (tokens) se guardan en la base de datos de DaleControl
          (Supabase), se usan solo desde nuestros servidores y nunca se envían al navegador.
          No compartimos datos de Google con terceros, salvo con los proveedores de
          infraestructura de la sección 5 que los procesan por nuestra cuenta. Las personas de
          DaleControl no leen datos de Google Calendar, salvo con su consentimiento, para
          investigar un abuso o un problema de seguridad, o cuando la ley lo exija.
        </p>

        <p><b>Conservación y cómo retirarlos.</b></p>
        <ul>
          <li>
            Conservamos los tokens solo mientras la integración esté conectada y hasta que se desconecte. Al pulsar
            <b> Desconectar Google Calendar</b> en Configuración &rarr; Integraciones los
            borramos y <b>revocamos el permiso ante Google</b>.
          </li>
          <li>
            Los eventos que ya se crearon <b>se quedan</b> en su calendario de Google: puede
            borrarlos desde Google Calendar (o el calendario completo de la clínica).
          </li>
          <li>
            También puede retirar el acceso de DaleControl en cualquier momento desde{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
              myaccount.google.com/permissions
            </a>.
          </li>
          <li>
            Para pedir que eliminemos cualquier dato relacionado con esta integración, escriba
            a <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> o a{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </li>
        </ul>

        <p>
          <b>Declaración de Uso Limitado.</b> El uso que DaleControl haga de la información
          recibida de las API de Google, y su transferencia a cualquier otra aplicación,
          cumplirá la{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Política de datos de usuario de los servicios de las API de Google
          </a>
          , incluidos los requisitos de Uso Limitado.
        </p>

        <div lang="en" style={{ borderTop: "1px solid var(--border-soft, #e2e8f0)", marginTop: 14, paddingTop: 14 }}>
          <p><b>Google user data &mdash; summary in English.</b></p>
          <p>
            DaleControl connects to Google Calendar only when a clinic administrator chooses to
            and grants access on Google&apos;s consent screen. We request the scope{" "}
            <code>https://www.googleapis.com/auth/calendar.app.created</code> (to create a
            secondary calendar for the clinic and to view, create, change and delete events
            only on that calendar) plus <code>openid</code> and <code>email</code> (to show which
            Google account is connected). We cannot read or modify the user&apos;s other calendars.
          </p>
          <p>
            <b>Data we write:</b> for each clinic appointment, the appointment type, time,
            doctor&apos;s name, clinic name and address, and the patient&apos;s first name with the
            initial of the last name in the event title; the doctor&apos;s email (and the
            patient&apos;s email if the clinic keeps the &quot;email an invitation to the patient&quot;
            option on) as attendees. Internal appointment notes and clinical data are never sent
            to Google. <b>Data we read:</b> the connected account&apos;s email and the identifiers of
            the clinic calendar and of the events DaleControl created; we do not read events
            created by others, and changes made in Google Calendar do not change DaleControl.
          </p>
          <p>
            <b>Use:</b> only to mirror the clinic&apos;s appointments to its Google Calendar and keep
            them up to date. We do not use Google user data for advertising, do not sell it, do
            not use it to train AI or machine-learning models, and humans do not read it except
            with the user&apos;s consent, for security or abuse investigations, or to comply with
            law. Access tokens are stored in our database, used only server-side, and never sent
            to the browser.
          </p>
          <p>
            <b>Retention and revocation:</b> tokens are kept only while the integration is
            connected and until it is disconnected. Clicking &quot;Disconnect Google Calendar&quot; in Settings &rarr; Integrations deletes them
            and revokes the permission with Google; events already created stay in the user&apos;s
            Google Calendar. Access can also be removed at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
            Deletion requests: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> or{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            <b>Limited Use disclosure.</b> DaleControl&apos;s use and transfer to any other app of
            information received from Google APIs will adhere to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </div>
      </Section>

      <Section title="10. Cambios al aviso de privacidad">
        <p>
          Cualquier modificación al presente aviso se publicará en esta misma URL con la
          nueva fecha de actualización. Le recomendamos revisarlo periódicamente.
        </p>
      </Section>

      <Section title="11. Contacto">
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

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 28, scrollMarginTop: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <div style={{ fontSize: 14, color: "var(--text-2, #334155)" }}>{children}</div>
    </section>
  );
}
