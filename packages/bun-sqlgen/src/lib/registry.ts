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
