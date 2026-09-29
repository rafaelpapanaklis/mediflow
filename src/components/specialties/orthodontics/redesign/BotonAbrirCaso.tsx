"use client";
// El botón grande «Abrir caso de ortodoncia» (ws1-t10): icono, título y UNA línea que dice
// qué pasa al pulsarlo. Lo usan la ficha de un paciente sin caso y el estado vacío de la
// cabecera del caso. Los botones chicos de barra («Abrir caso» del módulo, «Abrir un caso
// nuevo» tras cerrar uno) siguen siendo botones normales: son acciones de barra, no la
// acción principal de una pantalla.
import { ArrowRight, FolderPlus } from "lucide-react";
import { LINEA_DEL_BOTON_ABRIR_CASO } from "./casos-migrados-texto";
import alta from "./alta-caso.module.css";

export function BotonAbrirCaso({
  etiqueta,
  onClick,
  disabled,
  className,
}: {
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={[alta.cta, className].filter(Boolean).join(" ")}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={alta.ctaIcono} aria-hidden>
        <FolderPlus size={20} strokeWidth={1.75} />
      </span>
      <span className={alta.ctaTextos}>
        <span className={alta.ctaTitulo}>{etiqueta}</span>
        <span className={alta.ctaLinea}>{LINEA_DEL_BOTON_ABRIR_CASO}</span>
      </span>
      <ArrowRight className={alta.ctaFlecha} size={18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
