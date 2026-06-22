"use client";

// Pantalla "Importando" — progreso REAL de subida por entidad (barra + ETA) y
// luego "Procesando…" mientras el servidor inserta. La lógica vive en el wizard;
// aquí solo se pinta el estado `prog`.
import type { TFunction } from "@/i18n/t";
import { UploadProgress, type UploadProgressState } from "./upload-progress";

interface Props {
  t: TFunction;
  prog: UploadProgressState | null;
}

export function ImportingPanel({ t, prog }: Props) {
  return (
    <div className="imp-importing">
      <h3 className="imp-title" style={{ textAlign: "center" }}>{t("shell.importClinic.importing.title")}</h3>
      <p className="imp-sub" style={{ textAlign: "center", marginBottom: 0 }}>{t("shell.importClinic.importing.dontClose")}</p>
      <UploadProgress t={t} prog={prog} variant="panel" />
    </div>
  );
}
