import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export interface OrthoModulePlaceholderProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  /** Diseño (ws1-t3): salidas útiles mientras la pantalla no existe. */
  children?: ReactNode;
}

/**
 * Placeholder "Próximamente" de una sección del módulo Ortodoncia (Ola 0,
 * ws1-t1) — mismo espíritu que `BarberPlaceholder`
 * (src/components/barber/.../barber-placeholder.tsx): cada parte de la
 * Ola 1 REEMPLAZA la página que lo usa por la suya, sin tocar el layout ni
 * el menú. Ver «MAPA DE PARTES» en REPORTE-ws1-t1.md.
 *
 * Server component a propósito (sin hooks): las seis páginas que lo montan
 * son server components y no hace falta pagar el bundle de un client
 * component por un cartel que se va a reemplazar entero.
 *
 * Diseño (ws1-t3): mismo cartel, vestido como el resto del módulo (tokens
 * del rediseño, sin colores sueltos) y con salidas: dice dónde está HOY lo
 * que la persona vino a buscar.
 */
export function OrthoModulePlaceholder({
  title,
  description,
  icon: Icon = Sparkles,
  children,
}: OrthoModulePlaceholderProps) {
  return (
    <div className={s.pantalla}>
      <header className={s.cabeza}>
        <div className={s.cabezaTextos}>
          <h1 className={s.titulo}>{title}</h1>
          <p className={s.subtitulo}>
            <span className={`${s.etiqueta} ${s.etiquetaVioleta}`}>Próximamente</span>
          </p>
        </div>
      </header>
      <div className={`${s.vacio} ${s.vacioAlto}`}>
        <span className={s.vacioIcono} aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <p className={s.vacioTitulo}>Esta pantalla todavía no está lista</p>
        <p className={s.vacioPista}>{description}</p>
        {children && <div className={s.vacioAcciones}>{children}</div>}
      </div>
    </div>
  );
}
