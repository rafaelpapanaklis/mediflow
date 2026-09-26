import Image from "next/image";
import { IconoPanel } from "./icono-panel";

/**
 * Ilustraciones de interfaz de la sección «Funciones» v3: UNA por tarjeta,
 * limpia y centrada, con los tokens del panel real (#f4f3f8 / #4d3fc6 /
 * #1a1826, Instrument Sans y los íconos Material Symbols del menú) para que
 * parezcan el producto y no un dibujo.
 *
 * Son server components puros, sin estado ni JS, y decorativas: cada una va
 * dentro de un contenedor `aria-hidden` en funciones.tsx. Sin emojis a
 * propósito (el Chromium del servidor no tiene fuente de emoji).
 *
 * Los estilos viven en funciones-v3.css (prefijo `dcf3-`).
 */

/* ── 1 · Tu página web gratuita: la web REAL de la clínica → la agenda del panel ──
   Ajuste 2: la miniatura es una plantilla de verdad —«Especialistas», la que
   Rafael quiere por defecto (añadido 2b)—, capturada de la vista previa del
   panel de la clínica de prueba con los nombres cambiados en pantalla
   (public/landing/web/altabrisa-especialistas.webp, 1280 px de ancho, la
   página entera: menú, portada, especialistas, valoración y pie), dentro de
   una ventana de navegador con su URL. La página se desplaza
   sola, despacio, dentro de la ventana; con prefers-reduced-motion se queda
   quieta en la portada. La tira de abajo son las 8 miniaturas de plantilla tal
   como las pinta el panel (public/landing/web/plantilla-<id>.webp). */

/** Alto de altabrisa-especialistas.webp a 1120 px de ancho. */
const ALTO_WEB = 2816;

const PLANTILLAS: [string, string][] = [
  ["classic", "Clásico"],
  ["futurista", "Futurista"],
  ["healthtech", "Healthtech"],
  ["calido", "Cálido"],
  ["equipo", "Equipo"],
  ["sonrisa", "Sonrisa"],
  ["consultorio", "Consultorio"],
  ["especialistas", "Especialistas"],
];

export function IluPaginaWeb() {
  return (
    <div className="dcf3-ilu dcf3-web">
      {/* La web pública de la clínica, en su navegador */}
      <div className="dcf3-web__site">
        <div className="dcf3-web__chrome">
          <span className="dcf3-web__dots"><i /><i /><i /></span>
          <span className="dcf3-web__url"><IconoPanel nombre="lock" size={11} /> clinica-altabrisa.dalecontrol.com</span>
        </div>
        <div className="dcf3-web__page">
          <Image
            src="/landing/web/altabrisa-especialistas.webp"
            alt=""
            width={1120}
            height={ALTO_WEB}
            sizes="(max-width: 720px) 90vw, 380px"
            className="dcf3-web__shot"
          />
        </div>
        <div className="dcf3-web__templates">
          <span className="dcf3-web__tlabel">8 plantillas</span>
          <span className="dcf3-web__tlist">
            {PLANTILLAS.map(([id, nombre], i) => (
              <Image key={id} src={`/landing/web/plantilla-${id}.webp`} alt="" title={nombre} width={284} height={178} sizes="48px" className={id === "especialistas" ? "is-on" : undefined} />
            ))}
          </span>
        </div>
      </div>

      {/* La flecha: de la web a la agenda */}
      <svg className="dcf3-web__arrow" viewBox="0 0 96 40" fill="none" aria-hidden="true">
        <path d="M2 20 C 30 20, 40 20, 78 20" stroke="#4d3fc6" strokeWidth="2.2" strokeDasharray="5 5" strokeLinecap="round" />
        <path d="M70 11 L 86 20 L 70 29" stroke="#4d3fc6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* La agenda del panel, con la cita recién caída */}
      <div className="dcf3-web__agenda">
        <div className="dcf3-web__ahead">
          <span className="dcf3-web__aico"><IconoPanel nombre="calendar_month" size={15} /></span>
          <span className="dcf3-web__atx">
            <span className="dcf3-web__atitle">Agenda</span>
            <span className="dcf3-web__asub">Jueves 26 · Dra. Ruiz · Sillón 1</span>
          </span>
          <span className="dcf3-web__anew"><IconoPanel nombre="add" size={13} /> Nueva cita</span>
        </div>
        <div className="dcf3-web__rows">
          <div className="dcf3-web__row">
            <span className="dcf3-web__hora">09:30</span>
            <span className="dcf3-web__cita is-done">Limpieza · Ana T.</span>
          </div>
          <div className="dcf3-web__row">
            <span className="dcf3-web__hora">10:30</span>
            <span className="dcf3-web__cita is-new">
              <span className="dcf3-web__ctitle">Valoración · Luis Paredes</span>
              <span className="dcf3-web__ctag"><IconoPanel nombre="language" size={12} /> Desde tu página web</span>
            </span>
          </div>
          <div className="dcf3-web__row">
            <span className="dcf3-web__hora">11:30</span>
            <span className="dcf3-web__cita">Endodoncia · J. Medina</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 2 · WhatsApp + Asistente IA: el chat, como en el teléfono ─────────────── */

export function IluWhatsapp() {
  return (
    <div className="dcf3-ilu dcf3-wa">
      <div className="dcf3-wa__head">
        <span className="dcf3-wa__logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.2-.2-.2-.4-.3Z" />
          </svg>
        </span>
        <span className="dcf3-wa__who">
          <span className="dcf3-wa__name">Clínica Altabrisa</span>
          <span className="dcf3-wa__state">Cuenta de empresa · el bot contesta 24/7</span>
        </span>
      </div>
      <div className="dcf3-wa__chat">
        <span className="dcf3-wa__b is-in">
          Hola, ¿tienen espacio para limpieza esta semana?
          <span className="dcf3-wa__meta">22:41</span>
        </span>
        <span className="dcf3-wa__b is-out">
          ¡Claro! Tengo jueves 12:00 o viernes 10:30. ¿Cuál prefieres?
          <span className="dcf3-wa__meta">22:41 <i className="dcf3-wa__ticks">✓✓</i></span>
        </span>
        <span className="dcf3-wa__b is-in">
          Viernes 10:30
          <span className="dcf3-wa__meta">22:42</span>
        </span>
        <span className="dcf3-wa__b is-out">
          Listo, quedó agendada para el viernes 10:30. Te recuerdo un día antes.
          <span className="dcf3-wa__meta">22:42 <i className="dcf3-wa__ticks">✓✓</i></span>
        </span>
      </div>
      <div className="dcf3-wa__foot">
        <span className="dcf3-wa__chip is-ok"><IconoPanel nombre="check" size={14} /> El bot agendó · vie 10:30 · Limpieza</span>
        <span className="dcf3-wa__chip is-ia"><IconoPanel nombre="auto_awesome" size={14} /> Nota de evolución redactada por la IA</span>
      </div>
    </div>
  );
}

/* ── 3 · Agenda inteligente: el mes y el recordatorio que sí leen ──────────── */

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
/** Septiembre 2026 empieza en martes. */
const CELDAS: (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, null, null, null, null];
const CON_CITAS = new Set([2, 4, 8, 9, 11, 15, 16, 18, 22, 23, 25, 29]);

export function IluAgenda() {
  return (
    <div className="dcf3-ilu dcf3-ag">
      <div className="dcf3-ag__cal">
        <div className="dcf3-ag__head">
          <span className="dcf3-ag__chev"><IconoPanel nombre="chevron_right" size={16} className="dcf3-flip" /></span>
          <span className="dcf3-ag__mes">Septiembre 2026</span>
          <span className="dcf3-ag__chev"><IconoPanel nombre="chevron_right" size={16} /></span>
        </div>
        <div className="dcf3-ag__grid">
          {DIAS.map((d, i) => (
            <span key={`d${i}`} className="dcf3-ag__dow">{d}</span>
          ))}
          {CELDAS.map((n, i) => (
            <span key={`c${i}`} className={`dcf3-ag__day${n === null ? " is-void" : ""}${n === 25 ? " is-today" : ""}${n !== null && CON_CITAS.has(n) ? " has-dot" : ""}`}>
              {n ?? ""}
            </span>
          ))}
        </div>
      </div>
      <div className="dcf3-ag__toast">
        <span className="dcf3-ag__tico">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.2-.2-.2-.4-.3Z" />
          </svg>
        </span>
        <span className="dcf3-ag__ttx">
          <span className="dcf3-ag__tt">Recordatorio enviado a Ana Torres</span>
          <span className="dcf3-ag__ts">Mañana 10:00 · <b>Confirmó</b></span>
        </span>
        <span className="dcf3-ag__tok"><IconoPanel nombre="check" size={14} /></span>
      </div>
    </div>
  );
}

/* ── 4 · Radiografías CBCT y modelos 3D: el volumen, tal cual ──────────────── */

export function IluCbct() {
  return (
    <div className="dcf3-ilu dcf3-cb">
      <div className="dcf3-cb__bar">
        <span className="dcf3-cb__ico"><IconoPanel nombre="dentistry" size={14} /></span>
        <span className="dcf3-cb__t">Volumen 3D · CBCT</span>
        <span className="dcf3-cb__live">Auto-rotar</span>
      </div>
      <div className="dcf3-cb__view">
        <Image
          src="/landing/rx-3d.webp"
          alt=""
          width={349}
          height={316}
          sizes="(max-width: 640px) 90vw, 360px"
          style={{ width: "100%", aspectRatio: "16 / 10", height: "auto", objectFit: "cover", display: "block" }}
        />
      </div>
      <div className="dcf3-cb__foot">
        {["DICOM", "STL", "PLY", "OBJ"].map((f) => (
          <span key={f} className="dcf3-cb__fmt">{f}</span>
        ))}
        <span className="dcf3-cb__note">En tu navegador</span>
      </div>
    </div>
  );
}

/* ── 5 · Finanzas completas: del presupuesto firmado a la factura ─────────── */

export function IluFinanzas() {
  return (
    <div className="dcf3-ilu dcf3-fi">
      <div className="dcf3-fi__head">
        <span className="dcf3-fi__ico"><IconoPanel nombre="point_of_sale" size={15} /></span>
        <span className="dcf3-fi__tx">
          <span className="dcf3-fi__t">Presupuesto #1042</span>
          <span className="dcf3-fi__s">Ana Torres · 3 pagos</span>
        </span>
        <span className="dcf3-fi__signed"><IconoPanel nombre="edit" size={12} /> Firmado</span>
      </div>
      <div className="dcf3-fi__lines">
        <span className="dcf3-fi__line"><span>Corona zirconia ×2</span><b>$9,600</b></span>
        <span className="dcf3-fi__line"><span>Endodoncia molar</span><b>$3,800</b></span>
        <span className="dcf3-fi__line is-disc"><span>Descuento 10 %</span><b>−$1,340</b></span>
        <span className="dcf3-fi__total"><span>Total</span><b>$12,060 MXN</b></span>
      </div>
      <div className="dcf3-fi__estado">
        <span className="dcf3-fi__etx"><span>Pagado</span><b>$8,040</b></span>
        <span className="dcf3-fi__bar"><i /></span>
        <span className="dcf3-fi__etx is-dim"><span>Saldo pendiente</span><b>$4,020</b></span>
      </div>
      <div className="dcf3-fi__actions">
        <span className="dcf3-fi__btn"><IconoPanel nombre="summarize" size={14} /> Facturar</span>
        <span className="dcf3-fi__btn is-ghost"><IconoPanel nombre="credit_card" size={14} /> Cobrar en línea</span>
      </div>
    </div>
  );
}
