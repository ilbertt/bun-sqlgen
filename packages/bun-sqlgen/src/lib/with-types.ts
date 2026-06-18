import type { SQL } from 'bun';
// Relative (not `#*`) so the emitted, published `index.d.ts` re-export chain
// resolves for consumers, who don't have this package's subpath-imports map.
import type { TypedSQL } from './registry.ts';

/**
 * Wrap a Bun `SQL` client so a `sql.QueryName` tagged template resolves to the
 * generated row type. Unknown property names forward to the underlying tag, so the
 * untyped `sql` escape hatch and real methods (`sql.begin`, …) keep working.
 */
export function withTypes(sql: SQL): TypedSQL {
  return new Proxy(sql, {
    // biome-ignore lint/complexity/useMaxParams: native Proxy trap signature
    get(target, prop, receiver) {
      const existing = Reflect.get(target, prop, receiver);
      if (existing !== undefined) {
        return existing;
      }
      // biome-ignore lint/complexity/useMaxParams: native template-tag signature
      return (strings: TemplateStringsArray, ...values: unknown[]) =>
        (target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values);
    },
  }) as TypedSQL;
}
