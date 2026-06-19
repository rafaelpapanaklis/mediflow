"use client";

// Paso 2 · Cómo exportar — instrucciones por sistema (con perfil) o descarga de
// plantilla (Excel/Otro). El Paso 1 reconfigura este paso vía origin.hasProfile.
import { Fragment } from "react";
import { Download, FileText } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { type Origin, originGlyph } from "./import-client";

interface Props {
  t: TFunction;
  origin: Origin;
  templateUrl: string;
}

/** Renderiza texto con segmentos `entre acentos graves` como <code> (sin HTML crudo). */
function CodeText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i} className="imp-code">{part}</code> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

export function StepExport({ t, origin, templateUrl }: Props) {
  const manual = !origin.hasProfile;
  // Instrucciones específicas solo para Dentalink; el resto usa el set genérico.
  const instrKey = origin.id === "dentalink" ? "dentalink" : "generic";
  const steps = [1, 2, 3, 4].map((i) => ({
    h: t(`shell.importClinic.step2.${instrKey}.s${i}h`),
    p: t(`shell.importClinic.step2.${instrKey}.s${i}p`),
  }));

  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step2.title")}</h2>
      <p className="imp-sub">
        {manual
          ? t("shell.importClinic.step2.subExcel")
          : t("shell.importClinic.step2.subProfile", { name: origin.name })}
      </p>

      <span className="imp-src-pill">
        <span className="imp-logo" style={{ background: origin.color }} aria-hidden>
          {originGlyph(origin)}
        </span>
        <span className="imp-src-pill__nm">{origin.name}</span>
      </span>

      {manual ? (
        <>
          <div className="imp-dl-card">
            <span className="imp-dl-card__ic" aria-hidden><Download size={24} /></span>
            <div className="imp-dl-card__body">
              <b>{t("shell.importClinic.step2.templateTitle")}</b>
              <p>{t("shell.importClinic.step2.templateDesc")}</p>
            </div>
            {/* TODO(T4): templateUrl apuntará a la plantilla real multi-pestaña. */}
            <a className="btn-new btn-new--primary" href={templateUrl} target="_blank" rel="noopener noreferrer">
              <Download size={14} /> {t("shell.importClinic.step2.templateBtn")}
            </a>
          </div>
          <div className="imp-note" style={{ marginTop: 16 }}>
            <FileText size={20} aria-hidden />
            <p>{t("shell.importClinic.step2.ownFileNote")}</p>
          </div>
        </>
      ) : (
        <div className="imp-steps">
          {steps.map((it, i) => (
            <div className="imp-step-row" key={i}>
              <div className="imp-step-row__idx">{i + 1}</div>
              <div className="imp-step-row__body">
                <h4><CodeText text={it.h} /></h4>
                <p><CodeText text={it.p} /></p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
