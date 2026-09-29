"use client";

// «Qué falló y por qué» de una importación (ws1-t10): por archivo y por fila, con el motivo tal como lo dijo el motor.
// Antes la pantalla final solo decía «N registros con error» y un botón que no descargaba nada.
import { AlertCircle, Download } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { DATA_TYPES, type Entity, type ErrorDeFila } from "./import-client";
import { agruparPorArchivo, agruparPorMotivo } from "./reporte-errores";

/** Etiqueta legible de una entidad («treatmentPlans» → «Tratamientos activos»). */
export function etiquetaDeEntidad(t: TFunction, entity: Entity): string {
  const dt = DATA_TYPES.find((d) => d.entity === entity);
  return dt ? t(`shell.importClinic.step3.${dt.labelKey}`) : entity;
}

const MAX_MOTIVOS_POR_ARCHIVO = 6;
const MAX_FILAS_POR_MOTIVO = 8;

interface Props {
  t: TFunction;
  filas: ErrorDeFila[];
  /** Cuántas filas fallaron en total (puede ser más que las que vinieron en `filas`). */
  total: number;
  onDownload: () => void;
}

export function ErroresDeImportacion({ t, filas, total, onDownload }: Props) {
  const grupos = agruparPorArchivo(filas);
  return (
    <div
      className="imp-callout imp-callout--warn"
      role="region"
      aria-label={t("shell.importClinic.result.errorsHeading")}
      style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 22 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <AlertCircle size={18} aria-hidden />
        <strong style={{ flex: 1 }}>{t("shell.importClinic.result.errorsHeading")}</strong>
        <button type="button" className="imp-report-line__link" onClick={onDownload}>
          <Download size={16} aria-hidden /> {t("shell.importClinic.result.downloadReport")}
        </button>
      </div>

      {grupos.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13 }}>{t("shell.importClinic.result.errorsNoDetail", { count: total })}</p>
      ) : (
        grupos.map((g) => {
          const motivos = agruparPorMotivo(g.filas);
          return (
            <div key={`${g.fileName}|${g.entity}`} style={{ marginTop: 10 }}>
              <div className="mono" style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>
                {g.fileName ? `${g.fileName} · ` : ""}
                {etiquetaDeEntidad(t, g.entity)}
              </div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {motivos.slice(0, MAX_MOTIVOS_POR_ARCHIVO).map((m) => (
                  <li key={m.motivo} style={{ overflowWrap: "anywhere" }}>
                    <span className="mono">
                      {m.filas.every((n) => n <= 0)
                        ? t("shell.importClinic.result.errorsWholeFile")
                        : `${t("shell.importClinic.result.errorsRows", { count: m.filas.length, rows: m.filas.slice(0, MAX_FILAS_POR_MOTIVO).join(", ") })}${
                            m.filas.length > MAX_FILAS_POR_MOTIVO ? ` ${t("shell.importClinic.result.errorsMore", { count: m.filas.length - MAX_FILAS_POR_MOTIVO })}` : ""
                          }`}
                    </span>
                    {": "}
                    {m.motivo}
                  </li>
                ))}
              </ul>
              {motivos.length > MAX_MOTIVOS_POR_ARCHIVO ? (
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>
                  {t("shell.importClinic.result.errorsMoreReasons", { count: motivos.length - MAX_MOTIVOS_POR_ARCHIVO })}
                </p>
              ) : null}
            </div>
          );
        })
      )}

      {total > filas.length && filas.length > 0 ? (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>
          {t("shell.importClinic.result.errorsTruncated", { shown: filas.length, total })}
        </p>
      ) : null}
    </div>
  );
}
