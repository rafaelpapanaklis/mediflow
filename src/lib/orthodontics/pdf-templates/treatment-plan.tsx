// Ortodoncia — PDF «Plan de tratamiento al paciente». Carta vertical. SPEC §9.1.
//
// ws1-t4 (29-sep-2026): salía sin logo, sin datos de la clínica y con el
// paciente, el doctor y la fecha en un renglón gris de 9 pt (fecha en la zona
// del servidor). Ahora lleva el membrete y el pie comunes de ortodoncia
// (`MembreteOrto`/`PieOrto`), el contenido corre seguido en vez de cuatro
// hojas medio vacías, y cada página dice «Página N de M».

import { descripcionDelCosto } from "@/lib/orthodontics/check-del-caso";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { TreatmentPlanPdfData } from "@/app/actions/orthodontics/exportTreatmentPlanPdf";
import { techniqueLabel } from "../consent-texts";
import { PHASE_LABELS } from "../kanban-helpers";
import { ACENTO_ORTO, GRIS_ORTO, MembreteOrto, PieOrto, estilosPaginaOrto } from "../pdf/membrete-orto";
import { dinero } from "../pdf/formato";
import { CLASE_ANGLE } from "../expediente-ortodoncia";

const DOCUMENTO = "Plan de tratamiento";

const styles = StyleSheet.create({
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4, lineHeight: 1.2 },
  h2: {
    fontSize: 8.5, fontFamily: "Helvetica-Bold", color: ACENTO_ORTO, textTransform: "uppercase",
    letterSpacing: 0.8, marginTop: 14, marginBottom: 5, lineHeight: 1.2,
  },
  // fontSize junto al lineHeight: sin él @react-pdf calcula el renglón sobre 18 pt (27 pt de interlínea).
  paragraph: { fontSize: 10, marginBottom: 6, lineHeight: 1.5 },
  box: { padding: 10, backgroundColor: "#f7f6fb", borderRadius: 4, marginBottom: 8 },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: GRIS_ORTO, width: 170 },
  metricValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  bullet: { marginLeft: 6, marginBottom: 3 },
  nota: { fontSize: 8.5, color: GRIS_ORTO, marginTop: 14, lineHeight: 1.4 },
});

const ANCLAJE: Record<string, string> = {
  MAXIMUM: "máximo",
  MODERATE: "moderado",
  MINIMUM: "mínimo",
  COMPOUND: "compuesto",
};

const OBJETIVOS: Record<string, string> = {
  AESTHETIC_ONLY: "estéticos",
  FUNCTIONAL_ONLY: "funcionales",
  AESTHETIC_AND_FUNCTIONAL: "estéticos y funcionales",
};

/** Etiqueta en español; si el valor no se conoce, se enseña legible en vez de «CLASS_X_Y». */
function etiqueta(mapa: Record<string, string>, v: string): string {
  return mapa[v] ?? v.replaceAll("_", " ").toLowerCase();
}

const ESTADO_FASE: Record<string, string> = {
  COMPLETED: "completada",
  IN_PROGRESS: "en curso",
  DELAYED: "atrasada",
};

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={styles.metric} wrap={false}>
      <Text style={styles.metricLabel}>{etiqueta}</Text>
      <Text style={styles.metricValue}>{valor}</Text>
    </View>
  );
}

/** Lo que el plan completo aporta y la caja de arriba no dice ya. */
const YA_EN_LA_CAJA = new Set(["duracion", "anclaje", "extraccionesIndicadas", "tads"]);

export function TreatmentPlanPdf({ data }: { data: TreatmentPlanPdfData }) {
  const m = data.membrete;
  // ws1-t10: en «Pago por control» es un estimado; el $1 provisional no se enseña como precio.
  const costo = descripcionDelCosto(data.plan.billingMode, data.plan.totalCostMxn);
  const lineas = data.planCompleto?.lineas ?? [];
  const anclajePorArcada = lineas.find((l) => l.clave === "anclaje")?.valor ?? null;
  const detalleDelPlan = lineas.filter((l) => !YA_EN_LA_CAJA.has(l.clave));
  return (
    <Document title={`${DOCUMENTO} · ${m.paciente.nombre}`} author={m.clinicName}>
      <Page size="LETTER" style={estilosPaginaOrto.carta} wrap>
        <MembreteOrto datos={m} documento={DOCUMENTO} />

        <Text style={styles.h1}>Plan de tratamiento ortodóntico</Text>
        {/* ws1-t8: la versión que se imprime (reevaluaciones). Sin historial, no se dice nada. */}
        {data.versiones && data.versiones.anteriores.length > 0 ? (
          <Text style={styles.paragraph}>
            Versión: {data.versiones.actual.etiqueta}, vigente desde el {data.versiones.actual.desde}.
          </Text>
        ) : null}

        <Text style={styles.h2}>Tu diagnóstico</Text>
        <View style={styles.box} wrap={false}>
          <Text>
            Clase de Angle derecha: {etiqueta(CLASE_ANGLE, data.diagnosis.angleClassRight)} · izquierda:{" "}
            {etiqueta(CLASE_ANGLE, data.diagnosis.angleClassLeft)}.
          </Text>
          <Text>
            Overbite: {data.diagnosis.overbiteMm} mm · Overjet: {data.diagnosis.overjetMm} mm.
          </Text>
        </View>
        {/* ws1-t8: el diagnóstico completo, apartado por apartado (la clasificación ya está arriba). */}
        {(data.diagnosticoCompleto ?? [])
          .filter((sec) => sec.clave !== "clasificacion")
          .map((sec) => (
            <View key={sec.clave} wrap={false}>
              <Text style={styles.h2} minPresenceAhead={40}>{sec.titulo}</Text>
              <View style={styles.box}>
                {sec.lineas.map((l) => (
                  <Metrica key={l.clave} etiqueta={l.etiqueta} valor={l.valor} />
                ))}
              </View>
            </View>
          ))}
        {data.diagnosis.clinicalSummary ? (
          <>
            <Text style={styles.h2}>Resumen clínico</Text>
            <Text style={styles.paragraph}>{data.diagnosis.clinicalSummary}</Text>
          </>
        ) : null}

        <Text style={styles.h2}>Tu plan de tratamiento</Text>
        <View style={styles.box}>
          <Metrica etiqueta="Técnica" valor={techniqueLabel(data.plan.technique as never, data.plan.techniqueName)} />
          {data.plan.techniqueNotes ? <Metrica etiqueta="Detalle de técnica" valor={data.plan.techniqueNotes} /> : null}
          <Metrica etiqueta="Duración estimada" valor={`${data.plan.estimatedDurationMonths} meses`} />
          {/* ws1-t12: con el plan completo, el anclaje se dice por arcada («superior máximo · inferior medio»). */}
          <Metrica etiqueta="Anclaje" valor={anclajePorArcada ?? etiqueta(ANCLAJE, data.plan.anchorageType)} />
          <Metrica etiqueta="Objetivos" valor={etiqueta(OBJETIVOS, data.plan.treatmentObjectives)} />
          {data.plan.extractionsRequired ? (
            <Metrica etiqueta="Extracciones" valor={`FDI ${data.plan.extractionsTeethFdi.join(", ") || "—"}`} />
          ) : null}
        </View>

        {/* ws1-t12: el resto del plan de tratamiento completo. Lo que ya sale arriba (duración, anclaje,
            extracciones indicadas) no se repite. */}
        {detalleDelPlan.length > 0 ? (
          <>
            <Text style={styles.h2} minPresenceAhead={60}>Detalle del plan de tratamiento</Text>
            <View style={styles.box}>
              {detalleDelPlan.map((l) => (
                <Metrica key={l.clave} etiqueta={l.etiqueta} valor={l.valor} />
              ))}
            </View>
          </>
        ) : null}

        {data.phases.length > 0 ? (
          <>
            <Text style={styles.h2} minPresenceAhead={40}>Fases del tratamiento</Text>
            {data.phases.map((p) => (
              <View key={p.phaseKey} style={{ ...styles.bullet, flexDirection: "row" }} wrap={false}>
                <Text style={{ width: 18 }}>{p.orderIndex + 1}.</Text>
                <Text>
                  {PHASE_LABELS[p.phaseKey as never] ?? p.phaseKey} · {ESTADO_FASE[p.status] ?? "pendiente"}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {/* Título y caja juntos: el título no se queda solo al pie de la hoja. */}
        <View wrap={false}>
          <Text style={styles.h2}>Costo</Text>
          <View style={styles.box}>
            <Metrica etiqueta={costo?.etiqueta ?? "Costo total del tratamiento"} valor={costo ? `${dinero(costo.valor)} MXN` : "Por definir"} />
            <Text style={[styles.paragraph, { marginTop: 4, marginBottom: 0 }]}>
              El detalle de pagos (enganche, mensualidades, fechas y condiciones) va en el convenio de pago, que se firma
              por separado.
            </Text>
          </View>
        </View>

        {data.plan.retentionPlanText ? (
          <>
            <Text style={styles.h2} minPresenceAhead={40}>Plan de retención</Text>
            <Text style={styles.paragraph}>{data.plan.retentionPlanText}</Text>
          </>
        ) : null}

        <Text style={styles.h2} minPresenceAhead={60}>Qué esperar mes a mes</Text>
        <Text style={styles.bullet}>• Cita mensual de control (~30-45 min).</Text>
        <Text style={styles.bullet}>• Higiene exhaustiva: cepillado 3 veces al día + hilo dental.</Text>
        <Text style={styles.bullet}>• Si te ponen elásticos: úsalos al menos 22 horas al día.</Text>
        <Text style={styles.bullet}>
          • Avisa de inmediato si se rompe un bracket, sale un elástico, o tienes dolor anormal.
        </Text>

        {/* ws1-t8: historial de reevaluaciones (las versiones anteriores se conservan completas en la ficha). */}
        {data.versiones && data.versiones.anteriores.length > 0 ? (
          <View wrap={false}>
            <Text style={styles.h2}>Historial de versiones</Text>
            {data.versiones.anteriores.map((v) => (
              <Text key={v.etiqueta} style={styles.bullet}>
                • {v.etiqueta}: del {v.desde} al {v.hasta}{v.motivo ? ` · motivo de la reevaluación siguiente: ${v.motivo}` : ""}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.nota}>
          Este documento es informativo. El consentimiento firmado contiene los términos legales completos.
        </Text>

        <PieOrto datos={m} documento={DOCUMENTO} />
      </Page>
    </Document>
  );
}
