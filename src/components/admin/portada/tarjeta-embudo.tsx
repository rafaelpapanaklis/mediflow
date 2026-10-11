import { prisma } from "@/lib/prisma";
import { CardNew } from "@/components/ui/design-system/card-new";
import {
  armarEmbudo, leerConteosEmbudo, sinEventosPropios, DIAS_EMBUDO, type FilaEmbudo,
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

/** Embudo de captación de los últimos 30 días, de la base (ws1-t9). Nunca tumba /admin. */
export async function TarjetaEmbudo() {
  let conteos;
  try {
    conteos = await leerConteosEmbudo(prisma);
  } catch {
    return null;
  }
  const filas = armarEmbudo(conteos);
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
    </div>
  );
}
