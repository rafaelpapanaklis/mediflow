import styles from "./inbox.module.css";

/**
 * Skeleton de la bandeja unificada. Reutiliza la grilla responsive de
 * inbox.module.css (3 columnas en desktop; en mobile las columnas laterales
 * quedan off-canvas y sólo se ve la lista) para que el esqueleto calce con la
 * bandeja real mientras el server component resuelve su query inicial.
 * Shimmer: clase global .skel-new (light + dark ya resueltos en globals.css).
 */
export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true">
      {/* ─── Col 1: Sidebar ─── */}
      <aside className={styles.sidebar}>
        <div className={styles.brandHeader}>
          <span className="skel-new" style={{ height: 20, width: 84, borderRadius: 6 }} />
          <span className="skel-new" style={{ height: 36, borderRadius: "var(--radius)" }} />
        </div>
        <div className={styles.folderList}>
          <span className="skel-new" style={{ height: 11, width: 64, margin: "12px 8px 8px" }} />
          {[62, 48, 54, 44].map((w, i) => (
            <div key={`f${i}`} className={styles.folder}>
              <span className="skel-new" style={{ width: 16, height: 16, borderRadius: 5 }} />
              <span className="skel-new" style={{ height: 11, width: `${w}%` }} />
              {i === 0 && (
                <span className="skel-new" style={{ height: 16, width: 22, borderRadius: 999 }} />
              )}
            </div>
          ))}
          <span className="skel-new" style={{ height: 11, width: 76, margin: "12px 8px 8px" }} />
          {[58, 50, 64, 46, 52].map((w, i) => (
            <div key={`c${i}`} className={styles.folder}>
              <span className="skel-new" style={{ width: 16, height: 16, borderRadius: 5 }} />
              <span className="skel-new" style={{ height: 11, width: `${w}%` }} />
            </div>
          ))}
        </div>
        <div className={styles.userBlock}>
          <span
            className="skel-new"
            style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="skel-new" style={{ height: 10, width: "55%" }} />
            <span className="skel-new" style={{ height: 9, width: "38%" }} />
          </div>
        </div>
      </aside>

      {/* ─── Col 2: Lista de conversaciones ─── */}
      <section className={styles.threadCol}>
        <div className={styles.threadHeader}>
          <div className={styles.threadHeaderTitle}>
            <span className="skel-new" style={{ height: 14, width: 96 }} />
            <span className="skel-new" style={{ height: 11, width: 52 }} />
          </div>
          <div className={styles.threadSearch}>
            <span className="skel-new" style={{ height: 34, borderRadius: 8 }} />
          </div>
          <div className={styles.threadFilters}>
            {[64, 58, 70, 54].map((w, i) => (
              <span
                key={i}
                className="skel-new"
                style={{ height: 26, width: w, borderRadius: 999, flexShrink: 0 }}
              />
            ))}
          </div>
        </div>
        <div className={styles.threadList}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={styles.thread}>
              <span className={styles.threadCheckbox} />
              <span
                className="skel-new"
                style={{ width: 36, height: 36, borderRadius: "50%" }}
              />
              <span className={styles.threadBody}>
                <span className={styles.threadRow1}>
                  <span className="skel-new" style={{ height: 12, width: "52%" }} />
                  <span className="skel-new" style={{ height: 10, width: 28 }} />
                </span>
                <span className="skel-new" style={{ height: 10, width: "78%" }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Col 3: Panel de conversación (estado vacío) ─── */}
      <section className={styles.detailCol}>
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
          <span className="skel-new" style={{ width: 48, height: 48, borderRadius: "50%" }} />
          <span className="skel-new" style={{ height: 14, width: 180, maxWidth: "70%" }} />
          <span className="skel-new" style={{ height: 11, width: 240, maxWidth: "80%" }} />
        </div>
      </section>
    </div>
  );
}
