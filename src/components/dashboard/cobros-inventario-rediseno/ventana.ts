import { ROPA_ALTA_PACIENTE } from "@/components/dashboard/dialogos-rediseno/vestir-dialogos";
import v from "./inventario.module.css";

/**
 * La ropa de una ventana de Inventario (Nuevo artículo, Registrar compra,
 * Historial, Lotes, Materiales): las clases del velo y de la caja.
 *
 * Con el diseño nuevo es la MISMA ropa que «Nuevo paciente»
 * (`dialogos-rediseno`): trae los `--m2-*` del menú con su versión oscura y
 * viste las piezas del sistema de diseño que estas ventanas ya usaban
 * (`.modal__header`, `.field-new`, `.input-new`, `.btn-new`). No se inventa
 * otra: antes el botón principal de estas ventanas salía con el violeta de
 * siempre mientras el de la pantalla de detrás era el del diseño nuevo.
 *
 * Con el interruptor apagado son las clases globales de siempre (`.modal`),
 * más el esqueleto (`.ventana`): cabecera y pie fijos, el cuerpo es lo que
 * se desplaza, y nada se sale de un teléfono.
 */
export function ropaVentana(rediseno: boolean, ancho?: "media" | "ancha") {
  const tam = ancho === "ancha" ? v.ventanaAncha : ancho === "media" ? v.ventanaMedia : "";
  return rediseno
    ? { velo: ROPA_ALTA_PACIENTE.velo, caja: `${ROPA_ALTA_PACIENTE.caja} ${v.ventana} ${tam}`.trim() }
    : { velo: "modal-overlay", caja: `modal ${v.ventana} ${v.ventanaClasica} ${tam}`.trim() };
}
