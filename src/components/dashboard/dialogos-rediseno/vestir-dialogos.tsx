"use client";

import type { ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { useVestirConfirm, type ConfirmRopa } from "@/components/ui/confirm-dialog";
import s from "./dialogos.module.css";

/**
 * La ROPA de los diálogos del rediseño (ws1-t5, hallazgos 6 y 7): la ventana
 * «Nuevo paciente» y las confirmaciones «¿seguro?» del ConfirmProvider.
 *
 * Los dos se abren en un portal a <body>, fuera de la raíz de cualquier
 * pantalla, así que ninguna raíz les presta sus colores: cada caja monta
 * `CLASES_MENU` (`menu-dos-niveles/clases.ts`) ella misma —los `--m2-*` del
 * menú con su versión oscura y las dos familias tipográficas— y las clases
 * de `dialogos.module.css` los leen por herencia. Aquí no hay un solo color.
 *
 * ⛔ Esto no toca ni una regla: ni los textos de las confirmaciones, ni lo
 * que pasa al aceptar, ni un campo del alta de paciente. Es ropa.
 */

/**
 * Las clases de las confirmaciones. Constante de módulo a propósito: el
 * ConfirmProvider la recibe por efecto y con la misma identidad no la
 * re-monta en cada render.
 */
export const ROPA_CONFIRM: ConfirmRopa = {
  velo: `${CLASES_MENU} ${s.veloConfirmar}`,
  caja: `${CLASES_MENU} ${s.caja} ${s.confirmar}`,
  cabecera: s.confirmarCabecera,
  icono: s.confirmarIcono,
  textos: s.confirmarTextos,
  titulo: s.confirmarTitulo,
  descripcion: s.confirmarDescripcion,
  cerrar: s.cerrar,
  motivo: s.motivo,
  motivoRotulo: s.motivoRotulo,
  motivoCampo: s.motivoCampo,
  pie: s.confirmarPie,
  cancelar: s.accionSecundaria,
  confirmar: s.accionPrincipal,
};

/** Las clases de la ventana «Nuevo paciente» (`new-patient-modal.tsx`). */
export const ROPA_ALTA_PACIENTE = {
  velo: `${CLASES_MENU} ${s.veloAlta}`,
  caja: `${CLASES_MENU} ${s.caja} ${s.alta}`,
  tituloIcono: s.tituloIcono,
  pista: s.pista,
  rotuloSuave: s.rotuloSuave,
  limiteCta: s.limiteCta,
} as const;

/**
 * Viste las confirmaciones del ConfirmProvider (que vive en el layout raíz,
 * por encima de /dashboard y sin saber de clínicas) mientras `activo` sea
 * cierto. El layout de /dashboard lo pone con el interruptor
 * `menu-dos-niveles`, igual que la `apariencia` de las ventanas.
 *
 * Es un ENVOLTORIO de un solo hijo, y no un hijo más del layout, a
 * propósito: un hijo nuevo entre los del layout —aunque su condición casi
 * siempre dé falso— le cambia a React el número de ranuras de ese nivel y
 * con él los `useId` de todo lo que cuelga; un envoltorio de hijo único no
 * abre ranura ninguna. Apagado no hace nada y devuelve el hijo tal cual: el
 * árbol de siempre queda idéntico.
 */
export function VestirDialogos({ activo, children }: { activo: boolean; children: ReactNode }) {
  useVestirConfirm(activo ? ROPA_CONFIRM : null);
  return <>{children}</>;
}
