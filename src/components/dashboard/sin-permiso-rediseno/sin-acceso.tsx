import Link from "next/link";
import { Lock } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./sin-permiso.module.css";

/**
 * C-109 (ws1-t8, tercera ronda): un solo «sin acceso» para todo el panel. Había
 * cuatro (aviso flotante, panel de Caja, una línea suelta en Reseñas y un
 * texto gris en Analítica). Este es el de Caja, generalizado: candado, qué
 * pasa, a quién pedirlo y «Volver a Hoy». Sin hooks: lo monta un server
 * component o uno de cliente igual.
 */
export function SinAcceso({ titulo, texto, volver }: { titulo: string; texto: string; volver: string }) {
  return (
    <div className={`${CLASES_MENU} ${s.raiz}`}>
      <section className={s.aviso} role="status" aria-live="polite" data-sin-acceso>
        <span className={s.icono}>
          <Lock size={18} strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className={s.titulo}>{titulo}</h1>
        <p className={s.texto}>{texto}</p>
        <div className={s.acciones}>
          <Link href="/dashboard" className={`${s.boton} ${s.botonPrincipal}`}>
            {volver}
          </Link>
        </div>
      </section>
    </div>
  );
}

export const TITULO_SIN_ACCESO = { es: "No tienes acceso a esta pantalla", en: "You don't have access to this screen" } as const;
