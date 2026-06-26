# PROMPT PARA CLAUDE CODE — Integrar "Importar mi clínica" en DaleControl

> Copia y pega el bloque de abajo en la terminal de Claude Code, dentro del repo de tu panel DaleControl (Next.js 14). Antes, descomprime este ZIP en una carpeta accesible (p. ej. `design/import-clinic/`) para que Claude pueda leer los archivos de referencia.

---

## Bloque para pegar en Claude Code

```
Contexto: tengo un prototipo de diseño en HTML/CSS/JS vanilla (sin frameworks) del
módulo "Importar mi clínica" para DaleControl, un panel web de gestión para clínicas
dentales en México hecho con Next.js 14 (App Router) en español. Está en la carpeta
design/import-clinic/. Quiero que lo traduzcas a componentes reales de mi proyecto,
NO que lo copies tal cual.

Archivos de referencia (léelos antes de empezar):
- design/import-clinic/index.html  → prototipo navegable: lanzador + wizard de 6 pasos
  (Origen → Cómo exportar → Qué importar → Subir → Mapear columnas → Revisar →
  Importando → Resultado) + toggle de tema light/dark.
- design/import-clinic/estados.html → galería con TODOS los estados alternos (los 4
  estados del dropzone, mapeo automático vs manual, migración asistida, móvil) en
  light y dark. Úsala como catálogo visual de cada estado.
- design/import-clinic/styles.css   → fuente de la verdad del diseño: tokens (CSS
  variables para light en :root y dark en .dark) y todos los componentes. La marca
  violeta es #7c3aed (fija en ambos temas). Semáforo: éxito/error/advertencia.
- design/import-clinic/app.js       → lógica de la máquina de pasos, validaciones de
  UI y simulaciones. Es la referencia de COMPORTAMIENTO, no de implementación.
- design/import-clinic/estados.js   → render de la galería (mismos componentes).
- design/import-clinic/README.md    → mapa pantalla→paso del flujo y notas de
  interacción. EMPIEZA leyendo esto.

Lo que quiero que hagas:
1. Lee el README.md y styles.css completos. Inventaríame qué componentes UI hay
   (.btn, .badge, .modal, .table, .stat-card, .dropzone, .src-card, .opt, .stepbar,
   .select, .switch, etc.) y mapéalos a mis componentes existentes o propón nuevos.
2. Antes de escribir código, dime tu plan: estructura de carpetas/rutas, qué
   componentes crearás, y cómo manejarás el estado del wizard. Espera mi OK.
3. Respeta MI stack y convenciones actuales (revisa el repo: ¿usan Tailwind, CSS
   Modules, shadcn/ui, Zustand, etc.?). Adapta los tokens del prototipo a mi sistema
   de theming en vez de duplicarlos. NO introduzcas librerías nuevas sin preguntar.
4. El wizard debe ser client component con estado de paso; el shell (sidebar/topbar)
   ya existe en mi panel, así que el módulo vive DENTRO de una ruta tipo
   /pacientes/importar. Mantén accesibilidad (foco visible, aria, navegación por
   teclado) y el soporte light/dark.
5. Deja claramente marcado con TODO todo lo que es backend/datos reales (parsing de
   .xlsx/.csv, validación, deduplicado, persistencia, endpoint de migración asistida):
   el prototipo solo simula esos pasos.

Reglas:
- El microcopy está en español neutro; consérvalo.
- No inventes pantallas ni features fuera de lo que está en el prototipo.
- Pregúntame cualquier ambigüedad sobre mis convenciones antes de asumir.
```

---

## Notas rápidas para ti (humano)

- El prototipo es **diseño puro**: las cifras, filas de la tabla y validaciones son de
  muestra. Toda la lógica de archivos/datos hay que implementarla del lado de Next.js.
- El flujo y los estados están documentados en `README.md` (mapa pantalla→paso).
- Si tu panel ya tiene design tokens, pídele a Claude que **mapee** los del prototipo
  a los tuyos en lugar de pegar el `styles.css` completo.
