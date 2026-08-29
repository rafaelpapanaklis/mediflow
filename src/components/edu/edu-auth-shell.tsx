import { CalendarCheck2, ClipboardCheck, ShieldCheck } from "lucide-react";
import { EDU_BRAND } from "@/lib/edu/types";

/**
 * Shell de las pantallas SIN sesión del vertical (hoy solo el login; mañana
 * el cambio de contraseña forzado).
 *
 * PROPIO a propósito: NO es AuthShell ni LoginVisual de
 * src/components/public/** — esas piezas llevan la marca, el color y el
 * discurso comercial del producto dental, y esto es otro producto. No debe
 * heredar nada suyo ni por accidente, cuando alguien retoque el shell
 * compartido dentro de un año.
 *
 * Móvil primero: una columna con el formulario. El panel de marca solo
 * aparece a partir de 900 px (edu-theme.css) — en un teléfono ocuparía la
 * pantalla entera para no decir nada útil.
 *
 * Server component: no lleva "use client" porque no tiene estado. Lo
 * interactivo es el formulario que recibe como children.
 */
export function EduAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="edu-auth">
      <aside className="edu-auth__visual">
        <div>
          <h2 className="edu-auth__visual-title">{EDU_BRAND.full}</h2>
          <p className="edu-auth__visual-lead">{EDU_BRAND.tagline}</p>
        </div>
        <ul className="edu-auth__visual-list">
          <li>
            <ClipboardCheck size={18} aria-hidden="true" />
            El docente autoriza; queda quién, qué y cuándo.
          </li>
          <li>
            <CalendarCheck2 size={18} aria-hidden="true" />
            La agenda de la clínica escolar, sillón por sillón.
          </li>
          <li>
            <ShieldCheck size={18} aria-hidden="true" />
            El expediente del paciente, con el alumno que lo atendió.
          </li>
        </ul>
        <p style={{ fontSize: 12.5, color: "rgba(226,233,246,0.6)", margin: 0 }}>
          Acceso exclusivo para institutos con contrato.
        </p>
      </aside>

      <div className="edu-auth__panel">{children}</div>
    </div>
  );
}
