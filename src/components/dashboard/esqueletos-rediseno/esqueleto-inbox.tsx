import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import inbox from "@/app/dashboard/inbox/inbox.module.css";
import s from "./esqueletos.module.css";

/**
 * La bandeja unificada con el pulido del rediseño. Reutiliza la MISMA rejilla
 * de `inbox.module.css` que la pantalla real (tres columnas; las laterales
 * quedan fuera de la vista en anchos chicos) con `data-pulido`, igual que
 * `InboxClient` cuando la clínica tiene la bandera: así el esqueleto calza
 * con lo que llega. Los huesos son los de `esqueletos.module.css`.
 */
function Hueso({ style }: { style: React.CSSProperties }) {
  return <span className={s.hueso} style={style} aria-hidden />;
}

export function EsqueletoInbox() {
  return (
    <div className={`${CLASES_MENU} ${s.raiz} ${inbox.page}`} data-pulido="true" aria-busy="true" aria-label="Cargando la bandeja">
      {/* ─── Col 1: Sidebar ─── */}
      <aside className={inbox.sidebar}>
        <div className={inbox.brandHeader}>
          <Hueso style={{ height: 20, width: 84, borderRadius: 6 }} />
          <Hueso style={{ height: 36 }} />
        </div>
        <div className={inbox.folderList}>
          <Hueso style={{ height: 11, width: 64, margin: "12px 8px 8px", borderRadius: 5 }} />
          {[62, 48, 54, 44].map((w, i) => (
            <div key={`f${i}`} className={inbox.folder}>
              <Hueso style={{ width: 16, height: 16, borderRadius: 5 }} />
              <Hueso style={{ height: 11, width: `${w}%`, borderRadius: 5 }} />
              {i === 0 && <Hueso style={{ height: 16, width: 22, borderRadius: 999 }} />}
            </div>
          ))}
          <Hueso style={{ height: 11, width: 76, margin: "12px 8px 8px", borderRadius: 5 }} />
          {[58, 50, 64, 46, 52].map((w, i) => (
            <div key={`c${i}`} className={inbox.folder}>
              <Hueso style={{ width: 16, height: 16, borderRadius: 5 }} />
              <Hueso style={{ height: 11, width: `${w}%`, borderRadius: 5 }} />
            </div>
          ))}
        </div>
        <div className={inbox.userBlock}>
          <Hueso style={{ width: 32, height: 32, borderRadius: "50%" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <Hueso style={{ height: 10, width: "55%", borderRadius: 5 }} />
            <Hueso style={{ height: 9, width: "38%", borderRadius: 5 }} />
          </div>
        </div>
      </aside>

      {/* ─── Col 2: Lista de conversaciones ─── */}
      <section className={inbox.threadCol}>
        <div className={inbox.threadHeader}>
          <div className={inbox.threadHeaderTitle}>
            <Hueso style={{ height: 14, width: 96, borderRadius: 6 }} />
            <Hueso style={{ height: 11, width: 52, borderRadius: 5 }} />
          </div>
          <div className={inbox.threadSearch}>
            <Hueso style={{ height: 34, borderRadius: 8 }} />
          </div>
          <div className={inbox.threadFilters}>
            {[64, 58, 70, 54].map((w, i) => (
              <Hueso key={i} style={{ height: 26, width: w, borderRadius: 999 }} />
            ))}
          </div>
        </div>
        <div className={inbox.threadList}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={inbox.thread}>
              <span className={inbox.threadCheckbox} />
              <Hueso style={{ width: 36, height: 36, borderRadius: "50%" }} />
              <span className={inbox.threadBody}>
                <span className={inbox.threadRow1}>
                  <Hueso style={{ height: 12, width: "52%", borderRadius: 6 }} />
                  <Hueso style={{ height: 10, width: 28, borderRadius: 5 }} />
                </span>
                <Hueso style={{ height: 10, width: "78%", borderRadius: 5 }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Col 3: Panel de conversación (estado vacío) ─── */}
      <section className={inbox.detailCol}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
          }}
        >
          <Hueso style={{ width: 48, height: 48, borderRadius: "50%" }} />
          <Hueso style={{ height: 14, width: 180, maxWidth: "70%", borderRadius: 6 }} />
          <Hueso style={{ height: 11, width: 240, maxWidth: "80%", borderRadius: 5 }} />
        </div>
      </section>
    </div>
  );
}
