"use client";
// Endodontics — comparativo radiográfico hasta 4 imágenes lado a lado. Spec §6.17, §11.6
// MVP: render simple en grid 2x2; zoom/pan sincronizado se difiere a v1.1.

export interface RadiographFile {
  id: string;
  url: string;
  takenAt: Date;
  label: string; // "Pre-TC", "Conductometría", "Post-TC", "Control 6m"…
}

export interface RadiographComparisonViewProps {
  files: RadiographFile[];
  toothFdi: number;
}

export function RadiographComparisonView({ files, toothFdi }: RadiographComparisonViewProps) {
  const slots = files.slice(0, 4);

  if (slots.length === 0) {
    return (
      <div className="endo-section">
        <p className="endo-section__eyebrow">Comparativo radiográfico · diente {toothFdi}</p>
        <p className="endo-section__placeholder">
          Sin radiografías vinculadas a este diente todavía.
        </p>
      </div>
    );
  }

  return (
    <section className="endo-section endo-radiograph-grid" aria-label={`Comparativo radiográfico diente ${toothFdi}`}>
      <header className="endo-pending__header">
        <p className="endo-section__eyebrow">Comparativo radiográfico</p>
        <h2 className="endo-section__title">Diente {toothFdi} · evolución</h2>
      </header>
      <div className="endo-radiograph-grid__images">
        {slots.map((f) => (
          <figure key={f.id}>
            <img src={f.url} alt={`${f.label} — ${f.takenAt.toLocaleDateString("es-MX")}`} loading="lazy" />
            <figcaption>
              <strong>{f.label}</strong>
              <span>{f.takenAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="endo-section__sub" style={{ marginTop: 8 }}>
        Zoom y pan sincronizados se incorporan en v1.1.
      </p>
    </section>
  );
}
