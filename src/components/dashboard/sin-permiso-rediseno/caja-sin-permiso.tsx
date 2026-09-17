import Link from "next/link";
import { Lock } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import type { TFunction } from "@/i18n/t";
import s from "./sin-permiso.module.css";

/**
 * «No tienes acceso a Caja», vestido con el lenguaje del menú de dos niveles.
 *
 * Reemplaza, SOLO con la bandera `menu-dos-niveles` encendida, al
 * `ModuleLocked` que decía «Caja no está en tu plan → Ver planes» (hallazgo 16
 * de la auditoría del rediseño, ws1-t8). Eso era falso: la clínica sí tiene
 * Caja; a la persona le falta el interruptor `canAccessCaja` de Equipo. Aquí
 * se dice eso, con el MISMO texto que ya usa el menú (`menuDosNiveles.
 * cajaSinAcceso`), y no se manda a comprar nada.
 *
 * NO declara tokens propios: monta `CLASES_MENU` (menu-dos-niveles/clases.ts)
 * y la hoja lee los `--m2-*` por herencia, igual que `hoy-rediseno/raiz.tsx`.
 * Sin hooks, para que el server component de Caja lo monte directamente.
 *
 * `equipoHref` solo llega cuando quien mira puede editar Equipo (team.edit):
 * es un enlace a la pantalla donde se activa el acceso, no un permiso nuevo.
 */
export function CajaSinPermiso({ t, equipoHref }: { t: TFunction; equipoHref?: string }) {
  return (
    <div className={`${CLASES_MENU} ${s.raiz}`}>
      <section className={s.aviso} role="status" aria-live="polite">
        <span className={s.icono}>
          <Lock size={18} strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className={s.titulo}>{t("menuDosNiveles.cajaSinPermisoTitulo")}</h1>
        <p className={s.texto}>{t("menuDosNiveles.cajaSinAcceso")}</p>
        <div className={s.acciones}>
          <Link href="/dashboard" className={`${s.boton} ${s.botonPrincipal}`}>
            {t("menuDosNiveles.cajaSinPermisoVolver")}
          </Link>
          {equipoHref && (
            <Link href={equipoHref} className={s.boton}>
              {t("menuDosNiveles.cajaSinPermisoEquipo")}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
