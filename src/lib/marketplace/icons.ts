/**
 * Mapper de iconKey (string en BD) → componente lucide-react.
 *
 * El catálogo `modules` guarda el nombre del icono como string (p.ej.
 * "Activity") porque no podemos persistir un componente React. Esta función
 * resuelve el componente real al renderizar. Si el iconKey no existe (drift
 * entre BD y la versión instalada de lucide-react), cae a `Package` para
 * no romper la UI.
 */
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function getModuleIcon(iconKey: string): LucideIcon {
  const Icon = (Icons as unknown as Record<string, LucideIcon>)[iconKey];
  return Icon ?? Icons.Package;
}
