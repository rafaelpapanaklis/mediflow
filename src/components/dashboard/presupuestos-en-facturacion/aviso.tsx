"use client";

// Las dos piezas que evitan que alguien se quede sin ver un presupuesto que ya
// existía, ahora que «Presupuestos» no está en el menú nuevo de la ficha (ws1-t1):
//
//  · <AvisoPresupuestosMovidos>: arriba de la pestaña Presupuestos (a la que se
//    sigue llegando por `?tab=presupuestos` y por el enlace de abajo). Dice dónde
//    se hace ahora lo que se hacía ahí y lleva a Facturación en un clic. La
//    pestaña sigue ENTERA debajo: ver, PDF, aceptar, facturar… nada se apaga.
//  · <EnlaceAPresupuestos>: arriba de la pestaña Facturación, SOLO si el paciente
//    tiene presupuestos guardados. Un clic, igual que hoy desde «Más ▾».
//
// Solo se montan con el interruptor `menu-dos-niveles` encendido.

import { useEffect, useState } from "react";
import { ArrowRight, FileText, Receipt } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { useT } from "@/i18n/i18n-provider";
import s from "./aviso.module.css";

export function AvisoPresupuestosMovidos({ onIrAFacturacion }: {
  /** Sin permiso de Facturación no se pasa: el aviso sale sin botón. */
  onIrAFacturacion?: () => void;
}) {
  const t = useT();
  return (
    <div className={`${CLASES_MENU} ${s.raiz}`}>
      <div className={s.aviso} role="note">
        <span className={s.avisoIcono}><Receipt size={15} aria-hidden /></span>
        <p className={s.avisoTexto}>
          <strong className={s.avisoTitulo}>{t("presupuestosEnFacturacion.avisoTitulo")}</strong>
          {t("presupuestosEnFacturacion.avisoTexto")}
        </p>
        {onIrAFacturacion && (
          <button type="button" className={s.boton} onClick={onIrAFacturacion}>
            {t("presupuestosEnFacturacion.irAFacturacion")} <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

export function EnlaceAPresupuestos({ patientId, onVerPresupuestos }: {
  patientId: string;
  onVerPresupuestos: () => void;
}) {
  const t = useT();
  // null = todavía no se sabe (o no se pudo saber): no se pinta nada. Nunca un
  // «0 presupuestos» que parezca un dato.
  const [cuantos, setCuantos] = useState<number | null>(null);

  useEffect(() => {
    setCuantos(null);
    if (!patientId) return;
    const ctrl = new AbortController();
    // La MISMA lectura que hace la pestaña Presupuestos: mismos permisos, misma
    // visibilidad de paciente. Aquí solo se cuenta.
    fetch(`/api/quotes?patientId=${encodeURIComponent(patientId)}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data)) setCuantos(data.length); })
      .catch(() => { /* sin dato no hay fila; la pestaña sigue abriendo por su URL */ });
    return () => ctrl.abort();
  }, [patientId]);

  if (!cuantos) return null;
  return (
    <div className={`${CLASES_MENU} ${s.raiz}`}>
      <div className={s.enlace}>
        <FileText size={15} aria-hidden />
        <p className={s.enlaceTexto}>
          <span className={s.enlaceCifra}>{t("presupuestosEnFacturacion.guardados", { count: cuantos })}</span>
          {" "}{t("presupuestosEnFacturacion.guardadosPista")}
        </p>
        <button type="button" className={s.boton} onClick={onVerPresupuestos}>
          {t("presupuestosEnFacturacion.verPresupuestos")} <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
