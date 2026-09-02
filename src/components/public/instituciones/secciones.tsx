import type { CSSProperties } from "react";
import {
  EDU_LANDING_ANCHORS,
  EDU_LANDING_COPY,
  EDU_LANDING_DINERO,
  EDU_LANDING_EXPEDIENTE,
  EDU_LANDING_FLUJO,
  EDU_LANDING_PADRON,
  EDU_LANDING_PROBLEMAS,
  EDU_LANDING_ROLES,
  EDU_LANDING_SEDES,
  type EduClaim,
} from "@/lib/edu/marketing";
import { Escena } from "./escena";
import { ClinicaEstatica, VolumenEstatica } from "./estaticos";
import { EduIcon } from "./icons";
import { MockAutorizacion, MockNotaFirmada, MockTarifa } from "./mockups";

/** Retraso del reveal (variable CSS --rd) para escalonar una lista. */
export function rd(ms: number): CSSProperties {
  return { "--rd": `${ms}ms` } as CSSProperties;
}

/** Encabezado de sección: número romano, antetítulo y título. */
function Cabecera({
  indice,
  eyebrow,
  titulo,
  lead,
  centrado,
}: {
  indice: string;
  eyebrow: string;
  titulo: string;
  lead?: string;
  centrado?: boolean;
}) {
  return (
    <div className={`dcei-head${centrado ? " dcei-head--centro" : ""}`} data-reveal="">
      <span className="dcei-eyebrow">
        <span className="dcei-eyebrow__num" aria-hidden="true">
          {indice}
        </span>
        {eyebrow}
      </span>
      <h2 className="dcei-h2 dcei-balance">{titulo}</h2>
      {lead ? <p className="dcei-lead dcei-pretty">{lead}</p> : null}
    </div>
  );
}

/** La tarjeta de una promesa. Misma pieza en las tres secciones. */
function Tarjeta({ item, retraso }: { item: EduClaim; retraso: number }) {
  return (
    <li className="dcei-card" data-reveal="" style={rd(retraso)}>
      <span className="dcei-card__icon">
        <EduIcon name={item.icon} size={20} />
      </span>
      <h3 className="dcei-card__title">{item.titulo}</h3>
      <p className="dcei-card__body dcei-pretty">{item.cuerpo}</p>
    </li>
  );
}

// ── 03 · El problema ────────────────────────────────────────────────────

export function SeccionProblema() {
  const t = EDU_LANDING_COPY.problema;
  return (
    <section className="dcei-section dcei-section--papel">
      <div className="dcei-wrap">
        <Cabecera indice="I" eyebrow={t.eyebrow} titulo={t.titulo} />
        <ul className="dcei-problemas">
          {EDU_LANDING_PROBLEMAS.map((p, i) => (
            /* El numeral de fondo lo pone el CSS con un contador (ver .dcei-prob). */
            <li key={p.key} className="dcei-prob" data-reveal="" style={rd(i * 70)}>
              <span className="dcei-prob__icon">
                <EduIcon name={p.icon} size={22} />
              </span>
              <h3 className="dcei-prob__title">{p.titulo}</h3>
              <p className="dcei-prob__body dcei-pretty">{p.cuerpo}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── 04 · Cómo funciona ──────────────────────────────────────────────────

export function SeccionFlujo() {
  const t = EDU_LANDING_COPY.flujo;
  return (
    <section className="dcei-section" id={EDU_LANDING_ANCHORS.flujo}>
      <div className="dcei-wrap">
        <Cabecera indice="II" eyebrow={t.eyebrow} titulo={t.titulo} lead={t.lead} />
        <div className="dcei-flujo">
          <ol className="dcei-pasos">
            {EDU_LANDING_FLUJO.map((paso, i) => (
              <li key={paso.key} className="dcei-paso" data-reveal="" style={rd(i * 60)}>
                <span className="dcei-paso__marca" aria-hidden="true">
                  <EduIcon name={paso.icon} size={17} />
                </span>
                <div>
                  <h3 className="dcei-paso__title">
                    <span aria-hidden="true">{i + 1}.</span> {paso.titulo}
                  </h3>
                  <p className="dcei-paso__body dcei-pretty">{paso.cuerpo}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="dcei-flujo__mock" data-reveal="">
            <MockAutorizacion />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 05 · Por rol ────────────────────────────────────────────────────────

export function SeccionRoles() {
  const t = EDU_LANDING_COPY.roles;
  return (
    <section className="dcei-section dcei-section--oscuro" id={EDU_LANDING_ANCHORS.roles}>
      <div className="dcei-wrap">
        <Cabecera indice="III" eyebrow={t.eyebrow} titulo={t.titulo} lead={t.lead} />
        <ul className="dcei-roles">
          {EDU_LANDING_ROLES.map((r, i) => (
            <li key={r.key} className="dcei-rol" data-reveal="" style={rd(i * 70)}>
              <span className="dcei-rol__icon">
                <EduIcon name={r.icon} size={20} />
              </span>
              <h3 className="dcei-rol__title">{r.rol}</h3>
              <p className="dcei-rol__linea">
                <span className="dcei-rol__et dcei-rol__et--si">{t.ve}</span>
                <span className="dcei-pretty">{r.ve}</span>
              </p>
              <p className="dcei-rol__linea">
                <span className="dcei-rol__et dcei-rol__et--no">{t.noVe}</span>
                <span className="dcei-pretty">{r.noVe}</span>
              </p>
            </li>
          ))}
        </ul>
        <div className="dcei-padron" data-reveal="">
          <span className="dcei-padron__icon">
            <EduIcon name={EDU_LANDING_PADRON.icon} size={22} />
          </span>
          <div>
            <h3 className="dcei-padron__title">{EDU_LANDING_PADRON.titulo}</h3>
            <p className="dcei-pretty">{EDU_LANDING_PADRON.cuerpo}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 06 · Expediente e imagenología ──────────────────────────────────────

export function SeccionExpediente() {
  const g = EDU_LANDING_EXPEDIENTE;
  const t = EDU_LANDING_COPY.expediente;
  return (
    <section className="dcei-section dcei-section--papel" id={EDU_LANDING_ANCHORS.expediente}>
      <div className="dcei-wrap">
        <Cabecera indice="IV" eyebrow="Expediente" titulo={g.titulo} lead={g.entrada} />
        <div className="dcei-duo">
          <div className="dcei-duo__escena" data-reveal="">
            <Escena nombre="volumen" aria={t.escenaAria} className="dcei-escena--volumen">
              <VolumenEstatica />
            </Escena>
            <p className="dcei-pie">{t.pie}</p>
          </div>
          <div className="dcei-duo__mock" data-reveal="">
            <MockNotaFirmada />
          </div>
        </div>
        <ul className="dcei-cards">
          {g.items.map((item, i) => (
            <Tarjeta key={item.key} item={item} retraso={(i % 3) * 70} />
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── 07 · Caja y evaluación ──────────────────────────────────────────────

export function SeccionDinero() {
  const g = EDU_LANDING_DINERO;
  return (
    <section className="dcei-section" id={EDU_LANDING_ANCHORS.dinero}>
      <div className="dcei-wrap">
        <Cabecera indice="V" eyebrow="Caja y evaluación" titulo={g.titulo} lead={g.entrada} />
        <div className="dcei-split">
          <div className="dcei-split__lado" data-reveal="">
            <MockTarifa />
          </div>
          <ul className="dcei-cards dcei-cards--dos">
            {g.items.map((item, i) => (
              <Tarjeta key={item.key} item={item} retraso={(i % 2) * 70} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── 08 · Sedes ──────────────────────────────────────────────────────────

export function SeccionSedes() {
  const g = EDU_LANDING_SEDES;
  const t = EDU_LANDING_COPY.sedes;
  return (
    <section className="dcei-section dcei-section--oscuro" id={EDU_LANDING_ANCHORS.sedes}>
      <div className="dcei-wrap">
        <Cabecera indice="VI" eyebrow="Sedes" titulo={g.titulo} lead={g.entrada} centrado />
        <div className="dcei-clinica" data-reveal="">
          <Escena nombre="clinica" aria={t.escenaAria} className="dcei-escena--clinica">
            <ClinicaEstatica />
          </Escena>
          <p className="dcei-pie dcei-pie--centro">{t.pie}</p>
        </div>
        <ul className="dcei-cards">
          {g.items.map((item, i) => (
            <Tarjeta key={item.key} item={item} retraso={(i % 3) * 70} />
          ))}
        </ul>
      </div>
    </section>
  );
}
