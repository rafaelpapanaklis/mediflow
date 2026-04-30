# Prompt inicial para Claude Code

> Copia y pega ESTE TEXTO completo en Claude Code la primera vez que abras el proyecto.

---

```
Hola Claude Code. Voy a implementar el sistema de Marketplace de Módulos
para MediFlow (mi SaaS médico en Next.js 14 + Prisma + Supabase).

Toda la información está en los archivos de este paquete. Tu protocolo
de trabajo es:

1. Lee START_HERE.md PRIMERO. Es tu manual de operación.
2. Lee PROGRESS.md para saber en qué sprint estamos.
3. Lee BRIEF.md para entender el contexto técnico completo.
4. Abre el archivo del sprint actual (sprints/SPRINT_N.md) y ejecútalo
   completo siguiendo todas las reglas de START_HERE.md.
5. Al terminar el sprint, actualiza PROGRESS.md con lo que hiciste y
   DETÉNTE para que yo valide.
6. Cuando yo te diga "continúa", retomarás desde PROGRESS.md.

Reglas importantes:
- UN sprint a la vez. No combines sprints.
- Si dudas de algo, consulta BRIEF.md antes de inventar.
- Si encuentras decisiones que requieren mi input, agrégalas a la
  sección "Decisiones pendientes para Rafael" de PROGRESS.md y
  pregúntame antes de continuar.
- NO modifiques archivos existentes de MediFlow sin avisarme primero.

Empieza ahora leyendo START_HERE.md y PROGRESS.md, luego procede con
el primer sprint pendiente.
```

---

## Prompts para los siguientes sprints

Después de validar cada sprint, mándale a Claude Code SOLO esto:

```
Continúa con el siguiente sprint según PROGRESS.md.
```

Ese único prompt es suficiente porque Claude Code va a:
1. Leer `PROGRESS.md` y ver qué está marcado como ✅ DONE
2. Identificar el siguiente sprint pendiente
3. Abrir el archivo correspondiente y ejecutarlo

---

## Si Claude Code se pierde

Si pierdes el hilo o cierras la sesión y abres una nueva, mándale otra vez el prompt inicial. Como `PROGRESS.md` está actualizado, Claude Code retomará exactamente donde quedó sin perder contexto.

---

## Si algo sale mal

Si Claude Code rompe algo o necesitas revertir:

```
Algo salió mal. Revisa PROGRESS.md y la bitácora de cambios.
Revierte lo que hiciste en el último sprint (Sprint N) y márcalo
como ⏳ TODO de nuevo.
```
