// Periodontics — PDF "Comparativo pre/post tratamiento". SPEC §9.3.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PerioMetrics } from "../periodontogram-math";

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, fontWeight: "bold", marginBottom: 6, color: "#0F172A" },
  h2: { fontSize: 13, fontWeight: "bold", marginBottom: 6, color: "#334155" },
  meta: { fontSize: 9, color: "#64748B", marginBottom: 6 },
  twoCols: { flexDirection: "row", gap: 12, marginTop: 8 },
  col: { flex: 1, padding: 10, backgroundColor: "#F1F5F9", borderRadius: 4 },
  changesBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  metric: { flexDirection: "row", marginBottom: 3 },
  metricLabel: { color: "#64748B", width: 200 },
  metricValue: { color: "#0F172A", fontWeight: "bold" },
  green: { color: "#15803D" },
  red: { color: "#B91C1C" },
});

export type PrePostCompareProps = {
  patientName: string;
  doctorName: string;
  initial: { recordedAt: string; metrics: PerioMetrics };
  post: { recordedAt: string; metrics: PerioMetrics };
  residualCount: number;
  surgicalCandidatesTeeth: number[];
};

export function PrePostComparePDF(props: PrePostCompareProps) {
  const m1 = props.initial.metrics;
  const m2 = props.post.metrics;
  const dBop = round1(m1.bopPct - m2.bopPct);
  const dPlaque = round1(m1.plaquePct - m2.plaquePct);
  const dSites6 = m1.sites6plus - m2.sites6plus;
  const dPocketsTeeth = m1.teethWithPockets5plus - m2.teethWithPockets5plus;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h1}>Comparativo pre/post tratamiento periodontal</Text>
        <Text style={styles.meta}>
          Paciente: {props.patientName} · Dr./Dra. {props.doctorName}
        </Text>

        <View style={styles.twoCols}>
          <View style={styles.col}>
            <Text style={styles.h2}>Inicial — {props.initial.recordedAt}</Text>
            <MetricsBlock metrics={m1} />
          </View>
          <View style={styles.col}>
            <Text style={styles.h2}>Post-tratamiento — {props.post.recordedAt}</Text>
            <MetricsBlock metrics={m2} />
          </View>
        </View>

        <View style={styles.changesBox}>
          <Text style={styles.h2}>Cambios significativos</Text>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>BoP:</Text>
            <Text style={[styles.metricValue, dBop > 0 ? styles.green : styles.red]}>
              {m1.bopPct}% → {m2.bopPct}% (Δ {fmtDelta(dBop)}%)
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Índice de placa:</Text>
            <Text style={[styles.metricValue, dPlaque > 0 ? styles.green : styles.red]}>
              {m1.plaquePct}% → {m2.plaquePct}% (Δ {fmtDelta(dPlaque)}%)
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sitios PD ≥6 mm:</Text>
            <Text style={[styles.metricValue, dSites6 > 0 ? styles.green : styles.red]}>
              {m1.sites6plus} → {m2.sites6plus} (Δ {fmtDeltaInt(dSites6)})
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Dientes con bolsa ≥5 mm:</Text>
            <Text
              style={[styles.metricValue, dPocketsTeeth > 0 ? styles.green : styles.red]}
            >
              {m1.teethWithPockets5plus} → {m2.teethWithPockets5plus} (Δ{" "}
              {fmtDeltaInt(dPocketsTeeth)})
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Sitios residuales con BoP+:</Text>
            <Text style={styles.metricValue}>{props.residualCount}</Text>
          </View>
          {props.surgicalCandidatesTeeth.length > 0 ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Dientes candidatos a cirugía:</Text>
              <Text style={styles.metricValue}>
                {props.surgicalCandidatesTeeth.join(", ")}
              </Text>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

function MetricsBlock({ metrics }: { metrics: PerioMetrics }) {
  return (
    <>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>BoP:</Text>
        <Text style={styles.metricValue}>{metrics.bopPct}%</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>Plaque (O'Leary):</Text>
        <Text style={styles.metricValue}>{metrics.plaquePct}%</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>Sitios 1-3 mm:</Text>
        <Text style={styles.metricValue}>{metrics.sites1to3}</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>Sitios 4-5 mm:</Text>
        <Text style={styles.metricValue}>{metrics.sites4to5}</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>Sitios ≥6 mm:</Text>
        <Text style={styles.metricValue}>{metrics.sites6plus}</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>Dientes con bolsa ≥5 mm:</Text>
        <Text style={styles.metricValue}>{metrics.teethWithPockets5plus}</Text>
      </View>
      <View style={styles.metric}>
        <Text style={styles.metricLabel}>PD promedio:</Text>
        <Text style={styles.metricValue}>{metrics.avgPd} mm</Text>
      </View>
    </>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtDelta = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "0");
const fmtDeltaInt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "0");
