import Link from "next/link";
import { Lock } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { RUTA_PLANES } from "./destino";
import s from "./modulo-fuera-del-plan.module.css";

/**
 * «X no está en tu plan», en el camino NUEVO y sin mandar a Marketplace.
 *
 * Es el `ModuleLocked` de siempre (`dashboard/module-locked.tsx`) con las
 * MISMAS palabras y el MISMO único botón, «Ver planes», a la vista y a un clic.
 * Cambian dos cosas: el botón lleva a la pestaña del plan de la clínica en vez
 * de a Marketplace (oculto por ahora, ver destino.ts), y va vestido con los
 * tokens del menú (`CLASES_MENU`), sin colores propios. Con la bandera apagada
 * no se monta: ahí sigue `ModuleLocked`, intacto.
 *
 * Los textos van en español a mano porque así están hoy en `ModuleLocked`.
 */
export function ModuloFueraDelPlan({ name }: { name: string }) {
  return (
    <div className={`${CLASES_MENU} ${s.raiz}`}>
      <section className={s.aviso}>
        <span className={s.icono}>
          <Lock size={18} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className={s.titulo}>{name} no está en tu plan</h2>
        <p className={s.texto}>Mejora tu plan para desbloquear esta función.</p>
        <Link href={RUTA_PLANES} className={s.boton}>
          Ver planes
        </Link>
      </section>
    </div>
  );
}
