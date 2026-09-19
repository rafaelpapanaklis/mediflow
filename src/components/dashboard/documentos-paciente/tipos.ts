// Lo que la HOJA necesita para pintarse. Es la foto guardada con el documento:
// la hoja no consulta nada y no rellena nada con datos de hoy. Un `null` es un
// dato que no está capturado y se pinta como su etiqueta con la raya.

export interface EncabezadoDocumento {
  pacienteNombre: string;
  fecha: string;
  clinicaNombre: string;
  logoUrl: string | null;
  doctorNombre: string;
  cedula: string | null;
  clinicaDireccion: string | null;
  clinicaTelefono: string | null;
  doctorEspecialidad: string | null;
  doctorCedulaEspecialidad: string | null;
  pacienteNumero: string | null;
  pacienteCurp: string | null;
  pacienteSinCurp: boolean;
}

/** A dónde pega cada acción. `null` = ese documento no tiene esa salida. */
export interface RutasDeDocumento {
  pdf: string;
  whatsapp: string | null;
  correo: string | null;
}
