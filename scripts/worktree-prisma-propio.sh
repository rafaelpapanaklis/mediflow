#!/usr/bin/env bash
# worktree-prisma-propio.sh — cliente de Prisma PROPIO para un worktree (solo el servidor Linux).
#
#   scripts/worktree-prisma-propio.sh [<carpeta-del-worktree>]    # por defecto, la actual
#
# EL PROBLEMA. `wt.sh` deja node_modules como UN enlace simbólico al del clon principal, y
# `prisma generate` escribe el cliente dentro de node_modules/.prisma/client. Resultado: un
# solo cliente para todos los worktrees. Si t2 añade un modelo y t5 genera después con su
# schema, el build de t2 muere con «Property 'x' does not exist on type 'PrismaClient'».
#
# LO QUE HACE. Cambia node_modules por una carpeta real con UN ENLACE POR PAQUETE al del
# clon, salvo @prisma/client y .prisma, que son copias propias (unos 80 MB). Por qué basta
# con eso: @prisma/client hace require('.prisma/client/default'), y Node, TypeScript y
# webpack lo resuelven desde la ruta REAL de @prisma/client. Si esa ruta es del worktree,
# el .prisma que encuentra también lo es, y `prisma generate` escribe ahí. El resto de
# paquetes (next, react…) sigue resolviendo a una sola ruta real, la del clon.
# Es el mismo esquema que usa el panel desde el 16-sep (preparar() de
# ~/.config/panel-dental/panel.sh).
#
# LO QUE NO CAMBIA. Nada del repo: ni schema.prisma, ni imports, ni package.json. Vercel
# clona y compila con su node_modules normal; este script no existe para él.
#
# SEGURIDAD. Del node_modules actual solo quita el ENLACE, nunca su destino. Si encuentra
# una carpeta real que no hizo él (¿un npm install dentro del worktree?), no la toca y
# sale con error. Se niega a correr sobre el clon principal. Se puede repetir: rehace los
# enlaces (paquetes nuevos del clon entran, los que desaparecieron salen) y regenera.
# No toca la base: `prisma generate` solo escribe código. No lo corras con un build o un
# `next dev` vivos en ese mismo worktree: durante unos segundos no hay node_modules.
#
# ⚠️ `wt.sh borrar` todavía exige que node_modules sea un enlace: con este esquema sale con
# error sin borrar nada. Ver el reporte de WS1-T2 para el cambio que necesita wt.sh.
set -euo pipefail

MARCA=".worktree-prisma-propio"

wt="$(realpath "${1:-$PWD}")"
[ -f "$wt/prisma/schema.prisma" ] || { echo "ERROR: $wt no tiene prisma/schema.prisma" >&2; exit 1; }

# El clon principal es el primer worktree que lista git.
clon="$(git -C "$wt" worktree list --porcelain | awk 'NR==1 && /^worktree /{print $2}')"
clon="$(realpath "$clon")"
if [ "$wt" = "$clon" ]; then
  echo "ERROR: $wt es el clon principal; su node_modules es el original y no se toca." >&2
  exit 1
fi

src="$clon/node_modules"
nm="$wt/node_modules"
[ -d "$src/next" ] && [ -d "$src/@prisma/client" ] || {
  echo "ERROR: $src no tiene next o @prisma/client (falta npm install en el clon)." >&2
  exit 1
}

if [ -L "$nm" ]; then
  # El enlace de wt.sh: se quita el enlace, nunca el destino (sin barra final).
  rm "$nm"
  echo "-> quitado el enlace node_modules (el del clon sigue intacto)"
elif [ -d "$nm" ] && [ ! -f "$nm/$MARCA" ]; then
  echo "ERROR: $nm es una carpeta real que no hizo este script. No se toca." >&2
  exit 1
fi

# Lo que es propio tiene que ser carpeta real: si fuera un enlace, el rm -rf y el
# generate de abajo lo atravesarían y escribirían en el node_modules del clon.
for d in "$nm/@prisma" "$nm/.prisma" "$nm/.cache"; do
  if [ -L "$d" ]; then echo "ERROR: $d es un enlace y debería ser propio. No se sigue." >&2; exit 1; fi
done

mkdir -p "$nm/@prisma" "$nm/.cache"
touch "$nm/$MARCA"

# Un enlace por paquete. .cache se queda propio (lo usan herramientas de build).
# ln -sfn no sustituye una carpeta real (la anidaría): si aparece una, se para.
enlazar() {
  if [ -e "$2" ] && [ ! -L "$2" ]; then
    echo "ERROR: $2 es una carpeta real (¿npm install aquí?). No se toca." >&2
    exit 1
  fi
  ln -sfn "$1" "$2"
}
shopt -s dotglob nullglob
for e in "$src"/*; do
  case "$(basename "$e")" in @prisma|.prisma|.cache) continue ;; esac
  enlazar "$e" "$nm/$(basename "$e")"
done
for e in "$src"/@prisma/*; do
  [ "$(basename "$e")" = client ] && continue
  enlazar "$e" "$nm/@prisma/$(basename "$e")"
done
shopt -u dotglob nullglob
# Paquetes que desaparecieron del clon dejan enlaces rotos.
find "$nm" "$nm/@prisma" -maxdepth 1 -xtype l -delete

# @prisma/client: copia propia, y de la MISMA versión que el CLI `prisma` del clon.
version() { node -p "require('$1/package.json').version" 2>/dev/null || echo "?"; }
if [ -L "$nm/@prisma/client" ] || [ ! -d "$nm/@prisma/client" ] \
   || [ "$(version "$nm/@prisma/client")" != "$(version "$src/@prisma/client")" ]; then
  rm -rf "$nm/@prisma/client"
  cp -a "$src/@prisma/client" "$nm/@prisma/client"
  echo "-> @prisma/client propio ($(version "$nm/@prisma/client"))"
fi

echo "-> prisma generate (escribe en $nm/.prisma, no en el clon)"
(cd "$wt" && "$nm/.bin/prisma" generate)

# Comprobación: el cliente que va a usar este worktree es el suyo.
resuelto="$(cd "$wt" && node -p "require('path').dirname(require.resolve('.prisma/client/default', { paths: [require('fs').realpathSync('node_modules/@prisma/client')] }))")"
if [ "$resuelto" != "$nm/.prisma/client" ]; then
  echo "ERROR: @prisma/client resuelve a $resuelto y no a $nm/.prisma/client" >&2
  exit 1
fi
echo "Listo: $wt usa su propio cliente ($resuelto)."
