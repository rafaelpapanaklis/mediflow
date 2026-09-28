import { Settings } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · SIN DUEÑA asignada todavía: ninguna de las 6 partes de la
// Ola 1 (REPORTE-ws1-t8.md) trae una fila de "Configuración" en su reparto.
// Candidatos razonables: la parte «Acceso y permisos» (si aquí vive el
// doctor tratante por defecto, plantillas de recordatorio, etc.) o una
// pantalla nueva que Rafael reparta aparte. Se deja la ruta y el guardia
// listos para no bloquear el submenú completo; quién la llena es pregunta
// abierta en REPORTE-ws1-t1.md.
export default function OrthodonticsConfiguracionPage() {
  return (
    <OrthoModulePlaceholder
      icon={Settings}
      title="Configuración"
      description="Sin dueña asignada todavía en el reparto de la Ola 1 — pregunta abierta para Rafael en REPORTE-ws1-t1.md."
    />
  );
}
