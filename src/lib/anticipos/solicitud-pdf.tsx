// PDF «Solicitud de anticipo» (ws1-t3 fase 2) — para mandarlo por WhatsApp
// (adjunto, dentro de ventana) o desde OTRO teléfono (descargado y compartido
// a mano). NO es un comprobante de pago: es la PETICIÓN, con los datos
// bancarios de la sede para que el paciente transfiera.
//
// Mismo molde que lib/invoices/print-pdf.tsx: @react-pdf/renderer,
// ClinicLetterhead. Server-only (@react-pdf no corre en edge ni en cliente).

import {
  ClinicLetterhead,
  CLINIC_LETTERHEAD_SELECT,
  clinicLetterheadProps,
  type ClinicLetterheadClinic,
} from "@/lib/pdf/clinic-letterhead";
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { clabeAgrupada } from "@/lib/billing/spei-directo-core";
import { formatoPesos } from "./core";

const BRAND = "#2563eb";

function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}
function fmtHora(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 70, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },
  metaBox: { textAlign: "right" },
  metaTitle: { fontSize: 12, color: "#0f172a", fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  metaLabel: { fontSize: 8.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  metaValue: { fontSize: 10.5, color: "#0f172a", fontFamily: "Helvetica-Bold" },

  infoTitle: { fontSize: 8.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 4 },
  infoStrong: { fontSize: 11, color: "#0f172a", fontFamily: "Helvetica-Bold" },
  infoLine: { fontSize: 9.5, color: "#334155", marginTop: 2 },

  montoBox: { marginTop: 20, padding: 14, borderRadius: 6, backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe" },
  montoLabel: { fontSize: 8.5, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold" },
  montoValue: { fontSize: 22, color: BRAND, fontFamily: "Helvetica-Bold", marginTop: 2 },
  venceLine: { fontSize: 9.5, color: "#334155", marginTop: 6 },

  bancoBox: { marginTop: 18, padding: 14, borderRadius: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  bancoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  bancoLabel: { fontSize: 9, color: "#64748b" },
  bancoValue: { fontSize: 10, color: "#0f172a", fontFamily: "Helvetica-Bold" },

  referencia: { fontSize: 9.5, color: "#b45309", marginTop: 12 },

  footer: {
    position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#94a3b8",
    textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 8,
  },
});

interface SolicitudProps {
  clinic: ClinicLetterheadClinic;
  paciente: string;
  monto: number;
  vence: Date;
  tz: string;
  fechaHumana?: string | null;
  hora?: string | null;
  banco: string;
  beneficiario: string;
  clabe: string;
  referencia: string | null;
}

function SolicitudDocument(p: SolicitudProps) {
  return (
    <Document title="Solicitud de anticipo" author={p.clinic.clinicName} subject="Solicitud de anticipo">
      <Page size="LETTER" style={styles.page}>
        <ClinicLetterhead
          {...p.clinic}
          accent={BRAND}
          right={
            <View style={styles.metaBox}>
              <Text style={styles.metaTitle}>SOLICITUD DE ANTICIPO</Text>
              <Text style={styles.metaLabel}>Fecha</Text>
              <Text style={styles.metaValue}>{fmtFecha(new Date())}</Text>
            </View>
          }
        />

        <Text style={styles.infoTitle}>Paciente</Text>
        <Text style={styles.infoStrong}>{p.paciente}</Text>
        {p.fechaHumana && p.hora ? (
          <Text style={styles.infoLine}>Cita: {p.fechaHumana} a las {p.hora}</Text>
        ) : null}

        <View style={styles.montoBox}>
          <Text style={styles.montoLabel}>Anticipo a transferir</Text>
          <Text style={styles.montoValue}>{formatoPesos(p.monto)}</Text>
          <Text style={styles.venceLine}>
            Tienes hasta el {fmtFecha(p.vence)} a las {fmtHora(p.vence, p.tz)} para transferir.
          </Text>
        </View>

        <View style={styles.bancoBox}>
          <View style={styles.bancoRow}>
            <Text style={styles.bancoLabel}>Banco</Text>
            <Text style={styles.bancoValue}>{p.banco}</Text>
          </View>
          <View style={styles.bancoRow}>
            <Text style={styles.bancoLabel}>Beneficiario</Text>
            <Text style={styles.bancoValue}>{p.beneficiario}</Text>
          </View>
          <View style={[styles.bancoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.bancoLabel}>CLABE</Text>
            <Text style={styles.bancoValue}>{clabeAgrupada(p.clabe)}</Text>
          </View>
        </View>
        {p.referencia ? <Text style={styles.referencia}>Concepto sugerido: {p.referencia}</Text> : null}

        <View style={styles.footer} fixed>
          <Text>
            {p.clinic.clinicName} · Este documento es una solicitud de anticipo, NO es un comprobante de pago.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Genera el PDF «Solicitud de anticipo», con scope multi-tenant por
 * `clinicId`. Devuelve null si la clínica no existe.
 *
 * La VISIBILIDAD por paciente NO se verifica aquí (mismo criterio que
 * buildInvoicePrintPdf): el caller la comprueba ANTES.
 */
export async function buildSolicitudAnticipoPdf(args: {
  clinicId: string;
  paciente: string;
  monto: number;
  vence: Date;
  banco: string;
  beneficiario: string;
  clabe: string;
  referencia: string | null;
  fechaHumana?: string | null;
  hora?: string | null;
}): Promise<{ buffer: Buffer; fileName: string } | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: args.clinicId },
    select: { ...CLINIC_LETTERHEAD_SELECT, timezone: true },
  });
  if (!clinic) return null;

  const props: SolicitudProps = {
    clinic: await clinicLetterheadProps(clinic),
    paciente: args.paciente,
    monto: args.monto,
    vence: args.vence,
    tz: clinic.timezone || "America/Mexico_City",
    fechaHumana: args.fechaHumana,
    hora: args.hora,
    banco: args.banco,
    beneficiario: args.beneficiario,
    clabe: args.clabe,
    referencia: args.referencia,
  };

  const buffer = await renderToBuffer(<SolicitudDocument {...props} />);
  return { buffer, fileName: `solicitud-anticipo-${args.paciente.replace(/\s+/g, "-").toLowerCase()}.pdf` };
}
