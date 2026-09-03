# DaleControl — reglas de la casa

## Qué es

Un solo repo Next.js (App Router) con **cuatro verticales** que comparten base de datos, auth y componentes:

| Vertical | Rutas | Librería |
|---|---|---|
| Dental (núcleo) | `src/app/dashboard/`, `src/app/api/` | `src/lib/` |
| Instituto / edu | `src/app/instituto/`, `src/app/instituciones/` | `src/lib/edu/` |
| Barbería | `src/app/barber/`, `src/app/b/`, `src/app/barberias/` | `src/lib/barber/` |
| Inmuebles / realty | `src/app/inmobiliaria/`, `src/app/i/`, `src/app/inmobiliarias/` | `src/lib/realty/` |

Los tres verticales no dentales tienen un **guardia mecánico** que evita que una tarea de un vertical
toque el resto del monorepo. Los tres funcionan igual: juntan el diff contra `origin/main` más lo
staged, lo del working tree y lo no rastreado; clasifican cada ruta en **propia** (siempre permitida),
**compartida** (solo si la declaras en su variable de entorno) o **prohibida**; y salen con **exit 1**
si aparece una prohibida o una compartida sin declarar.

- `node scripts/barber-guard.cjs` — propio: `src/app/barber|b|barberias/`, `src/{components,lib}/barber/`,
  `sql/barber*.sql`. Compartidos vía `BARBER_GUARD_SHARED` (`prisma/schema.prisma`, `src/lib/auth.ts`,
  `src/lib/whatsapp.ts`, `tailwind.config.ts`…).
- `node scripts/edu-guard.cjs` — propio: `src/app/instituto|instituciones/`, `src/{components,lib}/edu/`,
  `scripts/edu-*.cjs|ts`, `sql/edu-*.sql`. Compartidos vía `EDU_GUARD_SHARED`.
- `node scripts/realty-guard.cjs` — propio: `src/app/inmobiliaria|i|inmobiliarias/`, `src/app/api/realty/`,
  `src/app/api/cron/realty-*/`, `src/{components,lib}/realty/`, `sql/realty*.sql`. Compartidos vía
  `REALTY_GUARD_SHARED`. Ojo: aquí `src/lib/whatsapp.ts` está **deliberadamente fuera** de la lista.

La variable de entorno **no es un comodín**: solo indulta rutas que ya están en la lista de compartidos
del propio guardia. Una carpeta nueva del vertical se añade a `OWN_PREFIXES`, no a la variable.
Ninguno de los tres es un script de npm; se invocan a mano.

## Reglas duras

**(a) Build completo antes de cada commit.** `npm run build` (= `prisma generate && next build`), entero,
sin `| tail`, sin `| head`, sin recortes. Si muere con **exit 134** es el heap de Node, no tu código:
repite con `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.

**(b) Push SIEMPRE a tu rama:** `git push -u origin <tu-rama>`.
⛔ Nunca `HEAD:main`, nunca `push origin main`, nunca `--force`. La integración a `main` la hace Rafael
en un solo push desde el clon principal. El hook `scripts/git-guard.cjs` bloquea estas formas desde
cualquier worktree; si te sale `[git-guard]`, no lo rodees: empuja a tu rama.

**(c) Aísla TODO por `clinicId`.** Cada consulta de Prisma lleva su filtro de tenant, y el `clinicId`
sale de la sesión, nunca del cliente. ⛔ `clinicId: undefined` **no filtra nada**: Prisma descarta la
clave y devuelve las filas de todas las clínicas. Si el valor puede faltar, corta antes de consultar.

**(d) Precios jamás hardcodeados en la UI.** La fuente única es la tabla `plan_configs`
(`model PlanConfig` en `prisma/schema.prisma`), leída por `src/lib/plan-shared.ts`. Cada vertical tiene
la suya: `src/lib/barber/plan-shared.ts` (`barber_plan_configs`) y `src/lib/realty/plan-shared.ts`
(`realty_plan_configs`). Se editan desde `/admin/settings → Planes` sin redeploy; un número escrito a
mano en un componente rompe eso.

**(e) SQL a mano.** Todo script vive en `sql/` (hoy 151 archivos). Lo entregas en un bloque copy-paste
para que Rafael lo pegue. ⛔ La terminal **nunca** aplica SQL contra la base.

**(f) Reporte final por append, sin leer.** Al cerrar una tarea, añade tu bloque al final de
`C:\Users\Rafael\ClauCode\MediFlow\ORQUESTA.md` bajo `## [nombre de tarea] — fecha`. Append puro: no
leas el archivo (pesa megas y te come el contexto). **ORQUESTA.md ya no vive en el repo**; el histórico
hasta el 3-sep-2026 está en `C:\Users\Rafael\ClauCode\MediFlow\orquesta-archivo\`.

**(g) Sin archivos temporales en la raíz.** Ni `salida.txt`, ni `build.log`, ni `tmp-*.js`. Lo temporal
va a `os.tmpdir()`. La raíz se queda como está.

**(h) No escribas "queda en producción".** Un push a tu rama no genera preview ni deploy: el
`ignoreCommand` de Vercel salta el build de toda rama que no sea `preview/*` ni producción. Di
"pusheado a la rama `<x>`, pendiente de que Rafael integre".

## Cómo se trabaja

**Worktrees.** Cada tarea vive en `C:\Users\Rafael\Documents\GitHub\mediflow-worktrees\<rama>`, con
`node_modules` como **junction** al del clon principal (`mklink /J`). No corras `npm install` dentro de
un worktree: reemplazarías el junction por una copia de disco.

**Tests.** Son 66 scripts planos `npm run test:<cosa>` en `package.json`, casi todos
`tsx --test <archivo>.test.ts`. **No hay** un `npm test` pelado, ni `test:all`, ni `test:barber`, ni
`test:realty`. Corre los que toquen tu área; algunos ejemplos reales:
`test:agenda`, `test:permissions`, `test:billing`, `test:plan-status`, `test:wa-booking`,
`test:patient-visibility`, `test:invoice-number`, `test:afiliados`, `test:crm`, `test:cbct-geometry`.
`test:edu` es el único con descubrimiento automático (`node scripts/edu-tests.cjs`) y falla si no
encuentra ningún test. Los `.cjs` de `scripts/` se corren con `node --test scripts/<x>.test.cjs`.

**Tipos.** `next.config.mjs` tiene `eslint.ignoreDuringBuilds: true` (el lint es un gate aparte:
`npm run lint`), pero **NO** hay `typescript.ignoreBuildErrors`. Y `tsconfig.json` incluye `**/*.ts`,
así que **tus `__tests__` sí entran al type-check de `next build`**: un tipo roto en un test te tumba la
build. Lo que sí afloja es `"strict": false` y `"skipLibCheck": true`.

**Base de datos.** Menos de 7 consultas por `Promise.all`: el pooler se satura y empiezan los timeouts.
Si necesitas más, parte en tandas.

**Cliente/servidor.** `"use client"` explícito en la primera línea del componente que lo necesite.
Nada de asumirlo por herencia.

## La línea TABLERO

Cada prompt empieza con `TABLERO: WSx-Ty · tarea`. **No tienes que hacer nada con ella**: la lee un hook
para saber en qué casilla del tablero estás. No la copies al reporte ni la comentes.

## Subagentes disponibles

Están en `.claude/agents/`. Lánzalos en paralelo cuando el trabajo sea independiente.

- **`mecanico`** (sonnet, effort low) — aplica cambios ya decididos en archivos que tú le nombras.
  Para renombrar un símbolo en N archivos, propagar un prop, añadir un campo. No decide arquitectura.
- **`revisor`** (opus, effort xhigh, solo lectura) — audita a fondo: fugas de tenant, envíos duplicados
  a clientes, precios hardcodeados, permisos. Úsalo antes de dar por buena una tarea grande.
- **`refutador`** (sonnet, effort medium, solo lectura) — intenta demostrar que un hallazgo o un arreglo
  está MAL. Lánzalo después del `revisor` para filtrar falsos positivos, o después de un arreglo para
  encontrar el caso raro que lo rompe.

El patrón que funciona: `revisor` encuentra → `refutador` intenta tumbarlo → `mecanico` arregla lo que
sobrevive.

## Config del espacio de trabajo

`.claude/settings.json` (versionado) fija `model: opusplan`, `effortLevel: high`, los permisos de Bash
de uso diario y el hook `PreToolUse` que corre `scripts/git-guard.cjs`. `.claude/settings.local.json`
sigue siendo tuyo y sigue ignorado por git.
