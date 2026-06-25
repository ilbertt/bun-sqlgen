import type { SQL, TransactionSQL } from 'bun';

/**
 * The global registry of generated query names → result row types. Empty here; each
 * generated `*.gen.d.ts` exports its own `Queries` and merges it in:
 *
 * ```ts
 * export interface Queries {
 *   GetUser: IGetUserResult;
 * }
 * declare module '@ilbertt/bun-sqlgen' {
 *   interface QueryResults extends Queries {}
 * }
 * ```
 *
 * It's the default registry for `withTypes` / `TypedSQL`, so a single-package project
 * just calls `withTypes(sql)`. A project whose typed `sql` crosses a package boundary
 * (e.g. its types are re-emitted in another package's `.d.ts`) should instead pass the
 * generated `Queries` explicitly — `withTypes<Queries>(sql)` — so the row types travel
 * through the normal import graph rather than this global augmentation.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation point — filled by generated files
export interface QueryResults {}

// biome-ignore lint/complexity/useMaxParams: native template-tag signature
type NamedTag<Row> = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

// A typed tag for every query name in the registry `Q` — added to the top-level client
// and to the transaction/savepoint clients alike, so `sql.Name\`...\`` and `tx.Name\`...\``
// both resolve to the generated row type.
type TypedTags<Q> = { readonly [K in keyof Q]: NamedTag<Q[K]> };

type TxCallback<Q, T> = (tx: TypedTransactionSQL<Q>) => T | Promise<T>;

// `begin`/`transaction`/`savepoint` overrides that hand the callback a *typed*
// client. Kept leftmost in the intersections below so overload resolution prefers
// them over Bun's own signatures (which pass a plain `TransactionSQL`).
type TypedBegin<Q> = {
  begin<T>(fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
  begin<T>(options: string, fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
  transaction<T>(fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
  transaction<T>(options: string, fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
};

/**
 * A transaction/savepoint client, carrying the same typed tags, and whose own
 * `begin`/`savepoint` keep handing back typed clients (so nested transactions and
 * savepoints stay typed too). `Q` defaults to the global `QueryResults` registry.
 */
export type TypedTransactionSQL<Q = QueryResults> = TypedBegin<Q> & {
  savepoint<T>(fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
  savepoint<T>(name: string, fn: TxCallback<Q, T>): Promise<SQL.ContextCallbackResult<T>>;
} & TransactionSQL &
  TypedTags<Q>;

/** Bun's `SQL`, augmented with a typed tag for every query name in `Q`, and with
 * `begin`/`transaction` handing the callback a typed transaction client. `Q` defaults
 * to the global `QueryResults` registry; pass the generated `Queries` explicitly to
 * thread the types through imports instead of the global augmentation. */
export type TypedSQL<Q = QueryResults> = TypedBegin<Q> & SQL & TypedTags<Q>;
