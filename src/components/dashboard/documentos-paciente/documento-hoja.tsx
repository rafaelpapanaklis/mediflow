"use client";

// La HOJA de un documento del paciente: cabecera en bloque (logo, clínica y, a la
// derecha, la fecha), debajo paciente y doctor con sus credenciales, el título,
// el cuerpo y un pie de firma que parece una firma.
//
// Es compartida: la usan la nota de evolución (para leer Y para escribir) y el
// consentimiento. Pinta SOLO lo que recibe —la foto guardada con el documento—.
// Un dato que falta sale como su etiqueta con la raya para llenarlo a mano, igual
// que en el PDF: nunca "N/A", nunca un valor inventado. El logo es la excepción
// (decisión de Rafael en el membrete): sin logo no hay recuadro vacío, manda el
// nombre de la clínica.

import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./documento.module.css";
import type { EncabezadoDocumento } from "./tipos";

/** Tokens + tipografía. Todo lo de esta carpeta tiene que colgar de aquí. */
export const CLASES_DOCUMENTO = [CLASES_MENU, s.raiz].join(" ");

/** La raíz con los tokens. Envuelve hoja, barra y aviso. */
export function DocumentoRaiz({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[CLASES_DOCUMENTO, className].filter(Boolean).join(" ")}>{children}</div>;
}

/** La mesa gris sobre la que descansa la hoja. La barra de acciones va dentro, arriba. */
export function DocumentoMesa({ children }: { children: ReactNode }) {
  return <div className={s.mesa}>{children}</div>;
}

function Detalle({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  const t = useT();
  return (
    <p className={s.detalle}>
      {etiqueta}:{" "}
      {valor ? <b>{valor}</b> : <span className={s.raya} role="img" aria-label={t("documentosPaciente.hoja.blank")} />}
    </p>
  );
}

export function DocumentoHoja({
  encabezado, titulo, tipo, firmado, children,
}: {
  encabezado: EncabezadoDocumento;
  titulo: string;
  /** "Nota de evolución", "Consentimiento informado"… va en pequeño sobre el título. */
  tipo: string;
  /** `null` = todavía se está escribiendo (el editor): no hay pie de estado. */
  firmado: boolean | null;
  /** El cuerpo: `DocumentoCuerpo` al leer, el editor al escribir. */
  children: ReactNode;
}) {
  const t = useT();
  const e = encabezado;
  return (
    <article className={s.hoja}>
      <header className={s.cabecera}>
        <div className={s.membrete}>
          {e.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL del logo de la clínica, dominio no fijo
            <img src={e.logoUrl} alt="" className={s.logo} />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <p className={[s.clinica, e.logoUrl ? "" : s.clinicaSola].join(" ")}>{e.clinicaNombre}</p>
            {e.clinicaDireccion ? <p className={s.clinicaDato}>{e.clinicaDireccion}</p> : null}
            {e.clinicaTelefono ? <p className={s.clinicaDato}>{e.clinicaTelefono}</p> : null}
          </div>
        </div>
        <div className={s.fecha}>
          <span className={s.etiqueta}>{t("documentosPaciente.hoja.date")}</span>
          <span className={s.valor}>{e.fecha}</span>
        </div>
      </header>

      <div className={s.partes}>
        <div>
          <span className={s.etiqueta}>{t("documentosPaciente.hoja.patient")}</span>
          <span className={s.valor}>{e.pacienteNombre}</span>
          <Detalle etiqueta={t("documentosPaciente.hoja.record")} valor={e.pacienteNumero} />
          {e.pacienteSinCurp ? null : <Detalle etiqueta="CURP" valor={e.pacienteCurp} />}
        </div>
        <div>
          <span className={s.etiqueta}>{t("documentosPaciente.hoja.doctor")}</span>
          <span className={s.valor}>{e.doctorNombre}</span>
          <Detalle etiqueta={t("documentosPaciente.hoja.license")} valor={e.cedula} />
          {/* La de especialidad solo la tiene quien cursó una: sin ella no hay renglón. */}
          {e.doctorCedulaEspecialidad ? (
            <Detalle etiqueta={t("documentosPaciente.hoja.specialtyLicense")} valor={e.doctorCedulaEspecialidad} />
          ) : null}
          <Detalle etiqueta={t("documentosPaciente.hoja.specialty")} valor={e.doctorEspecialidad} />
        </div>
      </div>

      <p className={s.sello}>{tipo}</p>
      <h2 className={s.titulo}>{titulo}</h2>

      {children}

      {firmado === null ? null : (
        <footer className={s.firma}>
          <p className={s.firmaNombre}>{e.doctorNombre}</p>
          <Detalle etiqueta={t("documentosPaciente.hoja.license")} valor={e.cedula} />
          {firmado ? (
            <p className={s.firmaSello}>
              <BadgeCheck size={14} aria-hidden /> {t("documentosPaciente.hoja.signed", { date: e.fecha })}
            </p>
          ) : (
            <p className={[s.firmaSello, s.firmaBorrador].join(" ")}>{t("documentosPaciente.hoja.draft")}</p>
          )}
        </footer>
      )}
    </article>
  );
}

/** Clases del cuerpo, para quien lo pinta él mismo (el editor). */
export const CLASE_CUERPO = s.cuerpo;
export const clasesDocumento = s;

/**
 * El cuerpo de un documento guardado. `html` viene SIEMPRE del servidor, que lo
 * reconstruye con la lista blanca de `@/lib/document-templates/sanitize`
 * (etiquetas sin ningún atributo + texto escapado) ANTES de guardarlo. Por eso,
 * y solo por eso, se puede inyectar.
 */
export function DocumentoCuerpo({ html }: { html: string }) {
  return <div className={s.cuerpo} dangerouslySetInnerHTML={{ __html: html }} />;
}
