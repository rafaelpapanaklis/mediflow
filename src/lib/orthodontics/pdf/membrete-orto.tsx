// ─────────────────────────────────────────────────────────────────────────────
// Membrete y pie ÚNICOS de los PDF de ortodoncia (ws1-t4, 29-sep-2026).
//
// LA CAUSA COMÚN que se corrigió: los PDF del módulo (plan de tratamiento,
// reporte de progreso, comparativo, carta de avance, acuerdo financiero) se
// hicieron cada uno con su propio StyleSheet y su action solo pedía
// `clinic: { name: true }`. Nunca pasaban por `clinicLetterheadProps` —que es
// quien baja el logo y trae dirección y teléfono— ni tenían pie paginado. El
// logo de Configuración, la dirección y el doctor con cédula no «fallaban»:
// ni siquiera se leían. La carta de alta y el trazado cefalométrico sí usaban
// el membrete, pero cada uno con su pie y su banda de datos distintos.
//
// Aquí vive lo que todos repiten, con el mismo estilo que el expediente y el
// consentimiento (`ClinicLetterhead`, Helvetica, carta, 40 pt de margen):
//   · `MembreteOrto`: logo + clínica + dirección + teléfono + RFC, a la
//     derecha el documento, su folio y la fecha dd/mm/aaaa; debajo, la banda
//     «Paciente | Doctor tratante» con nacimiento y cédula.
//   · `PieOrto`: nombre de la clínica · documento · «Página N de M», fijo.
// Los datos los arma `cargarMembreteOrto` (membrete-orto-db.ts), siempre con
// el `clinicId` de la sesión.
// ─────────────────────────────────────────────────────────────────────────────

import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "@/lib/pdf/clinic-letterhead";
import { doctorCredentialLines } from "@/lib/consent/document-data";
import { edadEnAnios, fechaDMA, fechaDeNacimiento } from "./formato";

/** Acento de los documentos de ortodoncia (el mismo violeta del consentimiento y la carta de alta). */
export const ACENTO_ORTO = "#7c3aed";
export const TINTA_ORTO = "#14101f";
export const GRIS_ORTO = "#6b6b78";

export interface DoctorDelMembrete {
  nombre: string;
  cedula: string | null;
  cedulaEspecialidad: string | null;
  especialidad: string | null;
}

export interface PacienteDelMembrete {
  nombre: string;
  /** ISO de `Patient.dob`, o null. */
  fechaNacimiento: string | null;
  /** `Patient.patientNumber` (el folio del panel), nunca el id interno. */
  folio: string | null;
}

/** Todo lo que el membrete y el pie necesitan, igual para los siete PDF. */
export interface DatosDelMembreteOrto extends ClinicLetterheadClinic {
  /** IANA de la clínica: TODAS las fechas del documento se imprimen en ella. */
  zonaHoraria: string;
  /** Instante de emisión (ISO). */
  emitidoEl: string;
  /** Ciudad de la clínica, para «Lugar y fecha». */
  lugar: string | null;
  paciente: PacienteDelMembrete;
  /** null = el caso no tiene doctor asignado: la banda lo dice, no inventa uno. */
  doctor: DoctorDelMembrete | null;
}

/** Márgenes de carta que usan todos: 40 pt a los lados (los que asume `ClinicLetterhead`) y aire abajo para el pie. */
export const estilosPaginaOrto = StyleSheet.create({
  carta: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 76,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: TINTA_ORTO,
    lineHeight: 1.4,
  },
  cartaHorizontal: {
    paddingTop: 28,
    paddingHorizontal: 40,
    paddingBottom: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: TINTA_ORTO,
    lineHeight: 1.4,
  },
});

const s = StyleSheet.create({
  derEtiqueta: {
    fontSize: 7.5, color: GRIS_ORTO, textTransform: "uppercase", letterSpacing: 0.8,
    textAlign: "right", lineHeight: 1.2,
  },
  derValor: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 1, lineHeight: 1.25 },
  derHueco: { marginTop: 6 },
  banda: {
    flexDirection: "row", gap: 24, marginBottom: 14, paddingBottom: 10,
    borderBottomWidth: 0.7, borderBottomColor: "#e5e5ed",
  },
  parte: { flex: 1 },
  etiqueta: { fontSize: 7.5, color: GRIS_ORTO, textTransform: "uppercase", letterSpacing: 0.8, lineHeight: 1.2 },
  valor: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  detalle: { fontSize: 8.5, color: GRIS_ORTO, marginTop: 1.5, lineHeight: 1.3 },
  detalleValor: { color: TINTA_ORTO },
  pie: {
    position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: "#9b9aa8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e5e5ed", paddingTop: 6, lineHeight: 1.3,
  },
  // `lineHeight: ""` NO es decorativo (ver `patient-document.tsx`): sin él
  // @react-pdf 4.x pinta el «Página N de M» FUERA del papel.
  pagina: { fontSize: 7.5, color: "#9b9aa8", textAlign: "center", marginTop: 2, lineHeight: "" },
});

function Detalle({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Text style={s.detalle}>
      {etiqueta}: <Text style={s.detalleValor}>{valor}</Text>
    </Text>
  );
}

/** Renglones de identificación del paciente (sin «undefined», sin huecos mudos). */
export function renglonesDelPaciente(p: PacienteDelMembrete, ahora: Date): Array<{ etiqueta: string; valor: string }> {
  const r: Array<{ etiqueta: string; valor: string }> = [];
  if (p.fechaNacimiento) {
    const edad = edadEnAnios(p.fechaNacimiento, ahora);
    r.push({
      etiqueta: "Fecha de nacimiento",
      valor: fechaDeNacimiento(p.fechaNacimiento) + (edad != null ? ` (${edad} años)` : ""),
    });
  }
  if (p.folio) r.push({ etiqueta: "Expediente", valor: p.folio });
  return r;
}

export interface MembreteOrtoProps {
  datos: DatosDelMembreteOrto;
  /** «Convenio de pago», «Plan de tratamiento»… Va a la derecha y en el pie. */
  documento: string;
  /** Folio del documento, si tiene. */
  folio?: string | null;
  /** Ocultar la banda paciente/doctor (p. ej. una carta que ya los nombra en el cuerpo). */
  sinBanda?: boolean;
}

/** Cabecera común: membrete de la clínica + documento/folio/fecha + banda paciente/doctor. */
export function MembreteOrto({ datos, documento, folio, sinBanda }: MembreteOrtoProps) {
  const ahora = new Date(datos.emitidoEl);
  return (
    <View>
      <ClinicLetterhead
        {...datos}
        accent={ACENTO_ORTO}
        right={
          <View>
            <Text style={s.derEtiqueta}>Documento</Text>
            <Text style={s.derValor}>{documento}</Text>
            {folio ? (
              <>
                <Text style={[s.derEtiqueta, s.derHueco]}>Folio</Text>
                <Text style={s.derValor}>{folio}</Text>
              </>
            ) : null}
            <Text style={[s.derEtiqueta, s.derHueco]}>Fecha de emisión</Text>
            <Text style={s.derValor}>{fechaDMA(datos.emitidoEl, datos.zonaHoraria)}</Text>
          </View>
        }
      />
      {sinBanda ? null : (
        <View style={s.banda}>
          <View style={s.parte}>
            <Text style={s.etiqueta}>Paciente</Text>
            <Text style={s.valor}>{datos.paciente.nombre || "—"}</Text>
            {renglonesDelPaciente(datos.paciente, Number.isNaN(ahora.getTime()) ? new Date() : ahora).map((l) => (
              <Detalle key={l.etiqueta} etiqueta={l.etiqueta} valor={l.valor} />
            ))}
          </View>
          <View style={s.parte}>
            <Text style={s.etiqueta}>Doctor tratante</Text>
            <Text style={s.valor}>{datos.doctor?.nombre || "Sin doctor asignado"}</Text>
            {datos.doctor
              ? doctorCredentialLines({
                  doctorLicense: datos.doctor.cedula,
                  doctorSpecialtyLicense: datos.doctor.cedulaEspecialidad,
                  doctorSpecialty: datos.doctor.especialidad,
                }).map((l) => <Detalle key={l.label} etiqueta={l.label} valor={l.value} />)
              : null}
          </View>
        </View>
      )}
    </View>
  );
}

/** Pie fijo de todas las páginas: clínica · documento · «Página N de M». */
export function PieOrto({ datos, documento }: { datos: DatosDelMembreteOrto; documento: string }) {
  return (
    <View style={s.pie} fixed>
      <Text>
        {(datos.clinicName || "Clínica").trim()} · {documento} · {datos.paciente.nombre}
      </Text>
      <Text style={s.pagina} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}
