import type { SQL } from 'bun';

/**
 * Registry of generated query names → result row types. Empty here; each generated
 * `*.gen.d.ts` augments it:
 *
 * ```ts
 * declare module '@ilbertt/bun-sqlgen' {
 *   interface QueryResults { GetUser: IGetUserResult }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation point — filled by generated files
export interface QueryResults {}

// biome-ignore lint/complexity/useMaxParams: native template-tag signature
type NamedTag<Row> = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** Bun's `SQL`, augmented with a typed tag for every generated query name. */
export type TypedSQL = SQL & { readonly [K in keyof QueryResults]: NamedTag<QueryResults[K]> };

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
