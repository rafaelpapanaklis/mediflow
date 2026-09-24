import Image from "next/image";
import type { ReactNode } from "react";
import { Escena } from "@/components/public/instituciones/escena";
import { ArcadaEstatica, VolumenEstatica } from "@/components/public/instituciones/estaticos";

/**
 * «El recorrido completo del paciente»: antes, durante y después de la
 * consulta. Tres tarjetas grandes que alternan clara / oscura / clara (la
 * identidad de la portada) con CAPTURAS REALES del panel recortadas a una
 * pieza y mostradas a ≥ 60 % de su tamaño real (las capturas son 2×: el ancho
 * CSS mínimo es 0.3 × el ancho en píxeles del archivo).
 *
 * El 3D es three.js de verdad, reutilizado de /instituciones:
 *  · la ARCADA (16 dientes girando) junto al titular;
 *  · el VOLUMEN (una tomografía recreada por trazado de rayos) en la tarjeta
 *    del CBCT. Los dos van detrás de la puerta de escena-gate.tsx: no piden
 *    ni un byte de three hasta que hay alguien mirando, y donde no hay WebGL
 *    se queda el dibujo estático. Ningún estudio real se publica.
 */

interface Shot {
  src: string;
  /** Tamaño del archivo (2×). */
  w: number;
  h: number;
  /** Ancho CSS al que se muestra en escritorio (≥ 0.3·w). */
  cw: number;
  alt: string;
  pie: string;
  /** Recorte para el teléfono (misma altura, menos ancho) para que el texto siga legible a 390 px. */
  m?: { src: string; w: number; h: number };
  /** En el teléfono no cabe legible: se queda solo en escritorio. */
  soloEscritorio?: boolean;
}

const shot = (src: string, w: number, h: number, cw: number, alt: string, pie: string, extra: Partial<Shot> = {}): Shot => ({ src: `/landing/recorrido/${src}`, w, h, cw, alt, pie, ...extra });

const ETAPAS: {
  id: string;
  n: string;
  dark: boolean;
  title: string;
  desc: string;
  items: { t: string; d: string }[];
  /** Copy arriba y capturas a lo ancho debajo (para las capturas anchas). */
  stack?: boolean;
  shots: Shot[];
  extra?: ReactNode;
  nota?: string;
}[] = [
  {
    id: "antes",
    n: "01",
    dark: false,
    title: "Antes de la consulta",
    desc: "El paciente pide cita, la aparta con anticipo y llega sabiendo a qué hora, con quién y cuánto debe.",
    items: [
      { t: "Agenda por doctor y sillón", d: "Con la línea de «ahora», confirmaciones y la lista de espera." },
      { t: "Bot de WhatsApp 24/7", d: "Agenda en huecos reales y recuerda la cita un día antes." },
      { t: "Anticipo por Mercado Pago", d: "El hueco se aparta al pagar; el dinero cae en la cuenta de la clínica." },
      { t: "Portal del paciente", d: "Sus citas, presupuestos y estado de cuenta desde su celular." },
    ],
    shots: [
      shot("citas.webp", 1258, 520, 400, "Lista de citas del paciente: endodoncia confirmada el 25 de septiembre a las 16:00, limpieza el 27 y ajuste de ortodoncia el 1 de octubre", "Citas del paciente", { soloEscritorio: true }),
      shot("ag-col.webp", 840, 680, 268, "Columna de la agenda con dos citas confirmadas y la línea roja de la hora actual", "Agenda · línea de «ahora»"),
      shot("estado-cuenta.webp", 824, 326, 280, "Estado de cuenta: $2,250 de saldo pendiente sobre $4,500, 50 % cubierto", "Estado de cuenta"),
    ],
  },
  {
    id: "durante",
    n: "02",
    dark: true,
    title: "Durante la consulta",
    desc: "Todo lo clínico en una pantalla: el expediente, el odontograma con hallazgos, las radiografías y el CBCT en 3D, sin instalar nada.",
    items: [
      { t: "Expediente clínico NOM-004", d: "Historia, alergias, consentimientos y notas de evolución." },
      { t: "Odontograma con hallazgos", d: "Caries, restauraciones, endodoncias y ausentes, diente por diente." },
      { t: "Radiografías con análisis IA", d: "Hallazgos resaltados para que el doctor los revise." },
      { t: "CBCT 3D en el navegador", d: "El DICOM de tu tomógrafo, con cortes y mediciones." },
    ],
    shots: [
      shot("odo-zoom.webp", 1258, 756, 420, "Odontograma real con hallazgos: caries en rojo, restauraciones en azul, una endodoncia y una corona", "Odontograma", { m: { src: "/landing/recorrido/odo-zoom-m.webp", w: 800, h: 756 } }),
      shot("rx-img.webp", 1152, 588, 380, "Radiografía panorámica en el visor del panel", "Visor de radiografías"),
      shot("rx-panel.webp", 680, 462, 220, "Panel de hallazgos IA del visor de radiografías con el botón «Analizar con IA»", "Hallazgos IA"),
    ],
    extra: (
      <figure className="dcv4-shot dcv4-shot--3d" style={{ width: 320 }}>
        <Escena nombre="volumen" aria="Volumen 3D de una tomografía dental recreado en el navegador" className="dcv4-escena dcv4-escena--volumen">
          <VolumenEstatica />
        </Escena>
        <figcaption>CBCT 3D · visor en el navegador</figcaption>
      </figure>
    ),
    nota: "La IA asiste; la lectura y el diagnóstico los decide el doctor.",
  },
  {
    id: "despues",
    n: "03",
    dark: false,
    stack: true,
    title: "Después de la consulta",
    desc: "Cobras, timbras y sabes quién te debe sin abrir Excel. Y si vienes de otro sistema, tus pacientes llegan contigo.",
    items: [
      { t: "CFDI 4.0 timbrado", d: "Desde la misma factura ligada al tratamiento y al paciente." },
      { t: "Cobro en línea", d: "El paciente paga desde su celular; tú lo ves al momento." },
      { t: "Saldos a la vista", d: "Quién debe, cuánto y cuándo vuelve." },
      { t: "Importador", d: "Desde Excel o tu panel anterior, con migración asistida." },
    ],
    shots: [
      shot("fact-card.webp", 2248, 290, 690, "Factura QA-1001 de Arturo Reyes Pérez por $4,500 con pago parcial y los botones PDF, Editar, Registrar pago, Timbrar y Enviar por WhatsApp", "Factura · Timbrar CFDI", { m: { src: "/landing/recorrido/fact-card-m.webp", w: 810, h: 290 } }),
      shot("deudas2.webp", 1530, 552, 470, "Listado de pacientes con saldo: Camila Sánchez Rubio $9,000, Alejandra Cruz Reyes $1,500, Arturo Reyes Pérez $2,250 y Roberto Sánchez Domínguez $900", "Pacientes con saldo", { m: { src: "/landing/recorrido/deudas2-m.webp", w: 900, h: 552 } }),
      shot("fact-kpis2.webp", 1108, 208, 340, "Indicadores de facturación: total cobrado $41,300 y por cobrar $13,650", "Total cobrado · por cobrar"),
    ],
  },
];

function Shot({ s, dark }: { s: Shot; dark: boolean }) {
  const cls = `dcv4-shot${dark ? " dcv4-shot--dark" : ""}`;
  return (
    <>
      <figure className={`${cls}${s.soloEscritorio || s.m ? " dcv4-solo-esc" : ""}`} style={{ width: s.cw, minWidth: Math.ceil(s.w * 0.3) }}>
        <Image src={s.src} alt={s.alt} width={s.w} height={s.h} sizes={`${s.cw}px`} style={{ width: "100%", height: "auto", display: "block" }} />
        <figcaption>{s.pie}</figcaption>
      </figure>
      {s.m && (
        <figure className={`${cls} dcv4-solo-tel`}>
          <Image src={s.m.src} alt={s.alt} width={s.m.w} height={s.m.h} sizes="100vw" style={{ width: "100%", height: "auto", display: "block" }} />
          <figcaption>{s.pie}</figcaption>
        </figure>
      )}
    </>
  );
}

export function RecorridoSection() {
  return (
    <section id="recorrido" className="dcv4-recsec" style={{ scrollMarginTop: 72 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,100px) 20px" }}>
        <div className="dcv4-recsec__head">
          <div data-reveal="" className="dcv4-recsec__title">
            <span className="dcv4-eyebrow">El recorrido del paciente</span>
            <h2 className="dcv4-balance dcv4-h2">Antes, durante y después de la consulta, en el mismo lugar</h2>
            <p className="dcv4-pretty dcv4-lead">
              Desde el mensaje de WhatsApp a las once de la noche hasta la factura timbrada: cada paso queda en el mismo expediente, y Sabina puede leerlo todo.
            </p>
          </div>
          <div data-reveal="" className="dcv4-recsec__arcada">
            <Escena nombre="arcada" aria="Arcada dental en tres dimensiones girando despacio" className="dcv4-escena dcv4-escena--arcada">
              <ArcadaEstatica />
            </Escena>
          </div>
        </div>

        <ol className="dcv4-etapas">
          {ETAPAS.map((e) => (
            <li key={e.id} data-reveal="" className={`dcv4-etapa${e.dark ? " dcv4-etapa--dark" : ""}${e.stack ? " dcv4-etapa--stack" : ""}`}>
              <div className="dcv4-etapa__copy">
                <span className="dcv4-etapa__n">{e.n}</span>
                <h3 className="dcv4-balance dcv4-etapa__title">{e.title}</h3>
                <p className="dcv4-pretty dcv4-etapa__desc">{e.desc}</p>
                <ul className="dcv4-etapa__items">
                  {e.items.map((it) => (
                    <li key={it.t}>
                      <span aria-hidden="true" className="dcv4-etapa__check">✓</span>
                      <span>
                        <b>{it.t}</b> <span>{it.d}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {e.nota && <p className="dcv4-etapa__nota">{e.nota}</p>}
              </div>
              <div className="dcv4-etapa__shots">
                {e.shots.map((s) => (
                  <Shot key={s.src} s={s} dark={e.dark} />
                ))}
                {e.extra}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
