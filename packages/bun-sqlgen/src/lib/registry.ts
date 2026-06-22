import type { SQL, TransactionSQL } from 'bun';

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

// A typed tag for every generated query name — added to the top-level client and to
// the transaction/savepoint clients alike, so `sql.Name\`...\`` and `tx.Name\`...\``
// both resolve to the generated row type.
type TypedTags = { readonly [K in keyof QueryResults]: NamedTag<QueryResults[K]> };

type TxCallback<T> = (tx: TypedTransactionSQL) => T | Promise<T>;

// `begin`/`transaction`/`savepoint` overrides that hand the callback a *typed*
// client. Kept leftmost in the intersections below so overload resolution prefers
// them over Bun's own signatures (which pass a plain `TransactionSQL`).
type TypedBegin = {
  begin<T>(fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
  begin<T>(options: string, fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
  transaction<T>(fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
  transaction<T>(options: string, fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
};

/**
 * A transaction/savepoint client, carrying the same typed tags, and whose own
 * `begin`/`savepoint` keep handing back typed clients (so nested transactions and
 * savepoints stay typed too).
 */
export type TypedTransactionSQL = TypedBegin & {
  savepoint<T>(fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
  savepoint<T>(name: string, fn: TxCallback<T>): Promise<SQL.ContextCallbackResult<T>>;
} & TransactionSQL &
  TypedTags;

/** Bun's `SQL`, augmented with a typed tag for every generated query name, and with
 * `begin`/`transaction` handing the callback a typed transaction client. */
export type TypedSQL = TypedBegin & SQL & TypedTags;
