import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import type { EditarCitaRopa } from "@/components/dashboard/agenda/agenda-edit-appointment-modal";
import type { ValidarRopa } from "@/components/dashboard/agenda/agenda-validate-banner";
import s from "./agenda-nueva.module.css";

/**
 * La ROPA de las ventanas secundarias de la agenda nueva (ws1-t1, hallazgo 9
 * de la auditoría del rediseño): «Editar cita», el calendario de su campo de
 * fecha y «Pendientes de validar».
 *
 * Los tres componentes son COMPARTIDOS con la agenda de siempre
 * (`components/dashboard/agenda/`, `components/ui/date-field.tsx`), así que
 * no se les cambia ni una regla ni un `style`: aceptan una `ropa` opcional
 * con clases, y solo la agenda nueva se la pasa. Sin ropa se pintan
 * exactamente como hoy; el `AgendaShell` de siempre no la conoce.
 *
 * Lo que sale a un portal (`<body>`) —la ventana y el calendario— no hereda
 * los tokens de `.raiz`: por eso lleva `CLASES_MENU` (los `--m2-*` del menú
 * con su versión oscura y las dos familias tipográficas) y `.tokensAgenda`
 * (los `--ag-*`, con su bloque oscuro). El banner vive dentro de `.raiz` y
 * hereda todo.
 */

/** Lo que va sobre cualquier nodo que la agenda nueva saque a un portal. */
export const CLASES_PORTAL_AGENDA = `${CLASES_MENU} ${s.tokensAgenda}`;

/** El popover del calendario (`DateField.popoverClassName`). */
export const CLASES_CALENDARIO_AGENDA = `${CLASES_PORTAL_AGENDA} ${s.calendario}`;

/** Constante de módulo: misma identidad en cada render. */
export const ROPA_EDITAR_CITA: EditarCitaRopa = {
  velo: `${CLASES_PORTAL_AGENDA} ${s.veloEditar}`,
  caja: s.modalEditar,
  cabecera: s.editarCabecera,
  titulos: s.editarTitulos,
  rotulo: s.panelRotulo,
  titulo: s.editarTitulo,
  cerrar: `${s.panelIconoBoton} ${s.panelCerrar}`,
  formulario: s.editarFormulario,
  cuerpo: s.editarCuerpo,
  dosColumnas: s.dosColumnas,
  campo: s.campo,
  campoRotulo: s.campoRotulo,
  control: s.control,
  calendario: CLASES_CALENDARIO_AGENDA,
  conflicto: s.conflicto,
  conflictoRotulo: s.conflictoRotulo,
  pie: s.editarPie,
  cancelar: s.accionSecundaria,
  guardar: s.accionPrincipal,
};

export const ROPA_VALIDAR: ValidarRopa = {
  validateBanner: s.validar,
  validateBannerHead: s.validarCabecera,
  validateBannerTitle: s.validarTitulo,
  validateBannerActions: s.validarAcciones,
  validateNotifyToggle: s.validarAvisar,
  validateBulkBtn: s.validarTodo,
  validateBannerClose: s.validarPlegar,
  validateRowList: s.validarLista,
  validateBannerRow: s.validarFila,
  validateBannerRowMain: s.validarFilaPrincipal,
  validateBannerRowTime: s.validarHora,
  validateBannerRowName: s.validarNombre,
  validateBannerRowDoctor: s.validarDoctor,
  validateRowDoctorDot: s.validarPunto,
  validateBannerRowResource: s.validarUnidad,
  validateBannerRowReason: s.validarMotivo,
  validateBannerRowOverride: s.validarNota,
  validateBannerRowActions: s.validarFilaAcciones,
  validateBannerActionBtn: s.validarAccion,
  primary: s.validarAccionPrimaria,
};
