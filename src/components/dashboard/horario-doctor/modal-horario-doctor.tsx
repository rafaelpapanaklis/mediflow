"use client";

/**
 * Equipo → «Horario» — la ventana con el horario de UN doctor.
 *
 * Copia el patrón de `PermissionsModal` (misma carpeta de al lado): el padre
 * guarda el miembro abierto en su estado, esta ventana se monta con
 * `open`/`member` y se pinta con las clases `modal-*` de siempre. Dentro, el
 * `PanelHorarioDoctor`, que es el mismo que ve el doctor en «Mi horario».
 *
 * Solo la abren ADMIN y SUPER_ADMIN (el botón lo esconde `team-client.tsx`) y
 * solo sobre miembros con rol DOCTOR, que son los que tiene la agenda. El
 * servidor repite las dos comprobaciones.
 */

import { useState } from "react";
import { Clock, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { PanelHorarioDoctor } from "./panel-horario-doctor";
import type { Dia } from "./tipos";

interface MiembroHorario {
  id: string;
  firstName: string;
  lastName: string;
}

export function ModalHorarioDoctor({
  open,
  member,
  clinica,
  onClose,
}: {
  open: boolean;
  member: MiembroHorario | null;
  /** El horario de la clínica (0=Lunes…6=Domingo), o `null` si no tiene. */
  clinica: Dia[] | null;
  onClose: () => void;
}) {
  const t = useT();
  // Mientras hay un PUT o un DELETE en marcha, ni el fondo ni la X cierran:
  // reabrir enseguida podría pedir el GET antes de que el guardado llegue.
  const [ocupado, setOcupado] = useState(false);
  if (!open || !member) return null;
  const cerrar = () => {
    if (!ocupado) onClose();
  };
  const nombre = `${member.firstName} ${member.lastName}`.trim();

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="horario-doctor-titulo"
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div className="modal__header" style={{ gap: 12 }}>
          <h2
            className="modal__title"
            id="horario-doctor-titulo"
            style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, margin: 0 }}
          >
            <Clock size={16} strokeWidth={1.75} aria-hidden style={{ color: "var(--brand)", flex: "none" }} />
            <span style={{ overflowWrap: "anywhere" }}>{t("settings.horarioDoctor.modalTitulo", { name: nombre })}</span>
          </h2>
          <button
            type="button"
            onClick={cerrar}
            disabled={ocupado}
            className="btn-new btn-new--ghost"
            style={{ padding: 0, width: 36, flex: "none" }}
            aria-label={t("common.close")}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* `key`: al abrir otro doctor, el panel empieza de cero (sin el
            borrador del anterior). El panel pone el cuerpo (que hace scroll)
            y el `modal__footer`; la cabecera se queda quieta arriba. */}
        <PanelHorarioDoctor
          key={member.id}
          doctorId={member.id}
          nombre={nombre}
          clinica={clinica}
          modo="equipo"
          enModal
          onCerrar={cerrar}
          onOcupado={setOcupado}
        />
      </div>
    </div>
  );
}
