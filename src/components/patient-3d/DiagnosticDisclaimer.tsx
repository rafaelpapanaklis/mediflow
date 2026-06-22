// Banda legal persistente y discreta para el modal del visor 3D / DICOM / CBCT.
// Recuerda al médico que el visor es SOLO apoyo visual y NO una estación
// diagnóstica certificada. Se monta UNA sola vez en el modal de Models3DTab
// (no dentro de cada visor interno) para que la leyenda aparezca igual sea cual
// sea el archivo: malla (STL/PLY/OBJ), DICOM (.dcm) o set CBCT (.zip).
//
// Componente presentacional puro (sin hooks ni estado): seguro de reutilizar en
// superficies de servidor o públicas sin depender del provider i18n. El texto
// llega por prop; si falta, cae al respaldo en español de DEFAULT_TEXT.

import { Info } from "lucide-react";

const DEFAULT_TEXT =
  "Solo apoyo visual — no para diagnóstico primario; no sustituye una estación diagnóstica certificada";

export default function DiagnosticDisclaimer({
  text,
  className = "",
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 px-4 py-2 border-t border-border bg-muted/40 text-[11px] leading-snug text-muted-foreground ${className}`}
    >
      <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden />
      <span>{text || DEFAULT_TEXT}</span>
    </div>
  );
}
