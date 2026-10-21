// Lo que recibe y lo que ofrece `EditorDocumento`. Sin React ni DOM: lo importan
// el componente, el modal de Plantillas y las pruebas.

export type ContextoEditor = "plantilla" | "nota" | "consentimiento";

/** El membrete de la clínica, que va en TODAS las hojas. Es una foto: el editor no consulta nada. */
export interface MembreteDocumento {
  clinicaNombre: string;
  logoUrl: string | null;
  clinicaDireccion: string | null;
  clinicaTelefono: string | null;
  /** Ya formateada en la zona de la clínica («21 de octubre de 2026»). */
  fecha: string;
}

/** Un marcador que se ofrece en el menú y se pinta como ficha. */
export interface MarcadorEditor {
  /** `NOMBRE_PACIENTE` (sin corchetes). */
  clave: string;
  /** «Nombre del paciente». */
  etiqueta: string;
  /** Lo que enseña «Ver con datos de ejemplo». */
  ejemplo: string;
}

export interface EstadoEditor {
  /** HTML normalizado al contrato, listo para el servidor (fichas → `[CLAVE]`). */
  html: string;
  /** Sin texto, sin imagen y sin tabla. */
  vacio: boolean;
}

/** Lo que quien monta el editor puede pedirle (se entrega en `alListo`). */
export interface EditorDocumentoApi {
  obtenerHtml(): string;
  estaVacio(): boolean;
  enfocar(): void;
  insertarMarcador(clave: string): void;
  /** Texto plano donde está el cursor (el dictado, por ejemplo). */
  insertarTexto(texto: string): void;
  /** Enseñar las fichas con el dato de ejemplo en vez de con la etiqueta. */
  verConDatos(encendido: boolean): void;
}

export interface EditorDocumentoProps {
  contexto: ContextoEditor;
  /** El HTML guardado (formato de siempre, con `[CLAVE]`). Solo se lee al montar. */
  html: string;
  membrete: MembreteDocumento;
  /** «Nota de evolución», «Consentimiento informado»: el sello sobre el título y el pie de cada hoja. */
  tipoDocumento: string;
  /** Lo que va en la hoja bajo el sello: el nombre de la plantilla, el título de la nota… */
  titulo?: import("react").ReactNode;
  /** El bloque paciente/doctor: solo en la primera hoja (nota y consentimiento; la plantilla no lo lleva). */
  primeraPagina?: import("react").ReactNode;
  marcadores: readonly MarcadorEditor[];
  onChange?: (estado: EstadoEditor) => void;
  /** Cuántas hojas se ven (0 = pantalla angosta, hoja fluida). Cambia al escribir. */
  onPaginas?: (paginas: number) => void;
  alListo?: (api: EditorDocumentoApi) => void;
  /**
   * Sube la imagen al almacenamiento de la clínica y devuelve su clave
   * (`documentos/<clinicId>/<id>.webp`). Sin esto, el botón de imagen NO se muestra.
   */
  onSubirImagen?: (archivo: File) => Promise<{ clave: string }>;
  /** Micrófono (DictationMic, cobra Saldo IA). Encendido salvo que se diga lo contrario. */
  dictado?: boolean;
  desactivado?: boolean;
  autoFoco?: boolean;
  placeholder?: string;
  /** `id` del rótulo que nombra al editor (aria-labelledby). */
  idEtiqueta?: string;
}
