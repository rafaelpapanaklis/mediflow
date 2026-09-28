// Ortodoncia — Ola 0 (ws1-t1): "/dashboard/orthodontics" a secas no pinta
// nada propio, manda al primer sub-apartado. La guarda de módulo ya corrió
// en el layout (layout.tsx de este mismo directorio).
import { redirect } from "next/navigation";

export default function OrthodonticsModuleIndexPage() {
  redirect("/dashboard/orthodontics/tablero");
}
