import { prisma } from "@/lib/prisma";
import { CardNew } from "@/components/ui/design-system/card-new";
import {
  armarEmbudo, leerConteosEmbudo, leerEmbudoPorFuente, sinEventosPropios, DIAS_EMBUDO,
  ORDEN_PASOS, ETIQUETAS_PASO, type FilaEmbudo, type FilaPorFuente,
} from "@/lib/admin/embudo-captacion";

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-MX"));
const fmtPct = (p: number | null) => (p === null ? "" : `${p.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`);

function Fila({ f, max }: { f: FilaEmbudo; max: number }) {
  const ancho = f.total !== null && max > 0 ? Math.max(2, Math.round((f.total / max) * 100)) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1.2fr) 3fr 64px 72px", gap: 12, alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: "var(--text-2)" }}>{f.etiqueta}</span>
      <div style={{ background: "var(--bg-elev)", borderRadius: 6, height: 10, overflow: "hidden" }} aria-hidden="true">
        <div style={{ width: `${ancho}%`, height: "100%", background: "var(--brand)" }} />
      </div>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, textAlign: "right", color: "var(--text-1)" }}>{fmt(f.total)}</span>
      <span style={{ fontSize: 12, textAlign: "right", color: "var(--text-3)" }} title="Contra el paso anterior">{fmtPct(f.pctAnterior)}</span>
    </div>
  );
}

const ENCABEZADOS_CORTOS: Record<(typeof ORDEN_PASOS)[number], string> = {
  landing_vista: "Portada", clic_empezar: "Empezar", registro_vista: "Registro",
  registro_enviado: "Enviado", registro_ok: "Clínicas", onboarding_completo: "Activadas",
  checkout_iniciado: "Pago iniciado", pago_ok: "Pagaron",
};

function TablaPorFuente({ filas, origenClinica }: { filas: FilaPorFuente[]; origenClinica: boolean }) {
  if (filas.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Aún no hay datos por fuente en este periodo.</p>;
  }
  const celda = { padding: "6px 8px", textAlign: "right" as const, fontSize: 13, color: "var(--text-1)" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...celda, textAlign: "left", color: "var(--text-3)", fontWeight: 500 }}>Fuente</th>
            {ORDEN_PASOS.map((c) => (
              <th key={c} style={{ ...celda, color: "var(--text-3)", fontWeight: 500 }} title={ETIQUETAS_PASO[c]}>
                {ENCABEZADOS_CORTOS[c]}
              </th>
            ))}
            <th style={{ ...celda, color: "var(--text-3)", fontWeight: 500 }} title="Pagaron ÷ clínicas creadas">% pago</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.fuente} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ ...celda, textAlign: "left", fontWeight: 600 }}>{f.fuente}</td>
              {ORDEN_PASOS.map((c) => (
                <td key={c} className="mono" style={celda}>{fmt(f.pasos[c] ?? 0)}</td>
              ))}
              <td className="mono" style={celda}>{fmtPct(f.pctPago)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--text-3)", margin: "12px 0 0" }}>
        Portada a «Enviado»: sesiones, por su utm_source (o gclid / sitio de referencia / directo).
        «Clínicas» en adelante: clínicas creadas en el periodo, por el primer UTM guardado al registrarse.
        {origenClinica ? "" : " El origen de las clínicas aún no se guarda en la base: todas caen en «sin dato» hasta aplicar sql/ws1-t10-meta-origen.sql."}
      </p>
    </div>
  );
}

/** Embudo de captación de los últimos 30 días, de la base (ws1-t9). Nunca tumba /admin. */
export async function TarjetaEmbudo() {
  let conteos;
  try {
    conteos = await leerConteosEmbudo(prisma);
  } catch {
    return null;
  }
  const filas = armarEmbudo(conteos);
  let porFuente: Awaited<ReturnType<typeof leerEmbudoPorFuente>> | null = null;
  try {
    porFuente = await leerEmbudoPorFuente(prisma);
  } catch {
    porFuente = null;
  }
  const max = Math.max(1, ...filas.map((f) => f.total ?? 0));
  const sinPropios = sinEventosPropios(conteos);
  return (
    <div style={{ padding: "0 24px 32px", maxWidth: 1800, margin: "0 auto" }}>
      <CardNew
        title="Embudo de captación"
        sub={`Últimos ${DIAS_EMBUDO} días · pasos 1–4 en sesiones del sitio, 5–8 en clínicas creadas en el periodo`}
      >
        {filas.map((f) => <Fila key={f.clave} f={f} max={max} />)}
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "12px 0 0" }}>
          Clics en WhatsApp: {fmt(conteos.whatsapp_clic ?? null)}.
          {sinPropios ? " «Tocaron Empezar» y «Enviaron el formulario» aún no tienen datos: se llenan cuando se despliegue la portada con los botones conectados." : ""}
          {" "}La columna derecha es el % contra el paso anterior.
        </p>
      </CardNew>
      {porFuente ? (
        <div style={{ marginTop: 16 }}>
          <CardNew title="Embudo por fuente" sub={`Últimos ${DIAS_EMBUDO} días · de dónde llegan (utm_source, anuncios de Google, Meta, TikTok, ChatGPT…)`}>
            <TablaPorFuente filas={porFuente.filas} origenClinica={porFuente.origenClinica} />
          </CardNew>
        </div>
      ) : null}
    </div>
  );
}
