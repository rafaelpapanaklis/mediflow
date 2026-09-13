import { Search } from "lucide-react";
import { formatToolsUsed } from "./sabina-core";
import styles from "./sabina-widgets.module.css";

/**
 * "Miré: citas del día, ingresos del mes" — de dónde salió la respuesta,
 * discreto (CONTRATO.md → "Que se note de dónde salen los datos"). Sin
 * herramientas (pregunta que no necesitó consultar nada, o el motor no
 * mandó el campo) no pinta nada: un renglón vacío no ayuda a nadie.
 */
export function ToolTrace({ tools }: { tools: readonly string[] | null | undefined }) {
  const phrase = formatToolsUsed(tools);
  if (!phrase) return null;
  return (
    <div className={styles.toolTrace}>
      <Search size={11} aria-hidden strokeWidth={2} />
      <span>Miré: {phrase}</span>
    </div>
  );
}
