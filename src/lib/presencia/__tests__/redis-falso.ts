/**
 * Un Redis en memoria con la semántica de los comandos que usa la señal (SET con
 * EX caduca, ZADD/ZRANGE BYSCORE, MGET, ZREMRANGEBYSCORE…) y un reloj que mueven
 * las pruebas. Sin EVAL: la señal usa entonces el camino de varios comandos.
 * No es Upstash ni Redis: cubre la LÓGICA del camino de reserva; el script de Lua
 * se prueba contra un Redis real en presencia-lua.test.ts.
 */
import type { PipelineMini, RedisMini } from "../presencia-store";

type Valor = { tipo: "str"; v: string } | { tipo: "zset"; v: Map<string, number> };

export class RedisFalso implements RedisMini {
  reloj = 1_000_000_000_000;
  /** Comandos ejecutados (cada comando de un pipeline cuenta). */
  comandos = 0;
  /** Viajes de red (cada exec() o eval es uno). */
  viajes = 0;
  /** Si se pone, el siguiente exec() lanza esto. */
  fallar: Error | null = null;
  private datos = new Map<string, Valor>();
  private vence = new Map<string, number>();

  avanzar(ms: number) { this.reloj += ms; }

  private vivo(k: string): Valor | undefined {
    const t = this.vence.get(k);
    if (t !== undefined && t <= this.reloj) { this.datos.delete(k); this.vence.delete(k); }
    return this.datos.get(k);
  }
  llaves(): string[] { return Array.from(this.datos.keys()).filter((k) => this.vivo(k)); }
  /** Todo lo que hay guardado, serializado: para comprobar que no se filtra una ruta cruda. */
  volcado(): string {
    return JSON.stringify(this.llaves().map((k) => {
      const v = this.vivo(k)!;
      return [k, v.tipo === "str" ? v.v : Array.from(v.v.entries())];
    }));
  }
  ttl(k: string): number | null {
    this.vivo(k);
    const t = this.vence.get(k);
    return t === undefined ? null : Math.round((t - this.reloj) / 1000);
  }

  pipeline(): PipelineMini {
    const cola: Array<() => unknown> = [];
    const self = this;
    const p: PipelineMini = {
      get(k) { cola.push(() => { const v = self.vivo(k); return v && v.tipo === "str" ? v.v : null; }); return p; },
      mget(...ks) { cola.push(() => ks.map((k) => { const v = self.vivo(k); return v && v.tipo === "str" ? v.v : null; })); return p; },
      set(k, v, opts) {
        cola.push(() => {
          self.datos.set(k, { tipo: "str", v: String(v) });
          if (opts?.ex) self.vence.set(k, self.reloj + opts.ex * 1000); else self.vence.delete(k);
          return "OK";
        });
        return p;
      },
      zadd(k, { score, member }) {
        cola.push(() => {
          let z = self.vivo(k);
          if (!z) { z = { tipo: "zset", v: new Map() }; self.datos.set(k, z); }
          (z.v as Map<string, number>).set(member, score);
          return 1;
        });
        return p;
      },
      zrange(k, min, max) {
        cola.push(() => {
          const z = self.vivo(k);
          if (!z) return [];
          const tope = max === "+inf" ? Infinity : max;
          return Array.from((z.v as Map<string, number>).entries())
            .filter(([, s]) => s >= min && s <= tope)
            .sort((a, b) => a[1] - b[1])
            .map(([m]) => m);
        });
        return p;
      },
      zremrangebyscore(k, min, max) {
        cola.push(() => {
          const z = self.vivo(k);
          if (!z) return 0;
          const piso = min === "-inf" ? -Infinity : min;
          let n = 0;
          for (const [m, s] of Array.from((z.v as Map<string, number>).entries())) if (s >= piso && s <= max) { (z.v as Map<string, number>).delete(m); n++; }
          return n;
        });
        return p;
      },
      async exec() {
        if (self.fallar) throw self.fallar;
        self.viajes++;
        self.comandos += cola.length;
        return cola.map((f) => f());
      },
    };
    return p;
  }
}

/** El mismo Redis con EVAL/EVALSHA que lanzan lo que se diga (para probar la caída al camino de varios comandos). */
export class RedisConEvalRoto extends RedisFalso {
  intentosEval = 0;
  constructor(private error: Error) { super(); }
  async evalsha(): Promise<unknown> { this.intentosEval++; throw this.error; }
  async eval(): Promise<unknown> { this.intentosEval++; throw this.error; }
}
