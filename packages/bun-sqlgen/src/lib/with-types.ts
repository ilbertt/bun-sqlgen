import type { SQL, TransactionSQL } from 'bun';
import type { TypedSQL } from './registry';

// Methods that hand a fresh SQL client to a callback. We wrap that client too, so a
// `tx.QueryName\`...\`` inside the callback resolves the same way as on the parent.
// `satisfies (keyof TransactionSQL)[]` pins these to Bun's actual method names, so a
// typo here — or Bun renaming one — is a compile error (TransactionSQL carries
// begin/transaction/savepoint). Kept a plain `Set<string>` so `.has(prop)` accepts
// an arbitrary key.
const SCOPED_CLIENT_METHODS: ReadonlySet<string> = new Set([
  'begin',
  'transaction',
  'savepoint',
] satisfies (keyof TransactionSQL)[]);

/**
 * Wrap a Bun `SQL` client so a `sql.QueryName` tagged template resolves to the
 * generated row type. Unknown property names forward to the underlying tag, so the
 * untyped `sql` escape hatch and real methods (`sql.begin`, …) keep working. The
 * client passed to a `begin`/`transaction`/`savepoint` callback is wrapped too, so
 * named queries work inside transactions.
 */
export function withTypes(sql: SQL): TypedSQL {
  return wrap(sql) as TypedSQL;
}

function wrap(sql: SQL): SQL {
  return new Proxy(sql, {
    // biome-ignore lint/complexity/useMaxParams: native Proxy trap signature
    get(target, prop, receiver) {
      const existing = Reflect.get(target, prop, receiver);
      if (existing !== undefined) {
        if (
          typeof existing === 'function' &&
          typeof prop === 'string' &&
          SCOPED_CLIENT_METHODS.has(prop)
        ) {
          return scopedMethod({ method: existing as (...a: unknown[]) => unknown, target });
        }
        return existing;
      }
      // biome-ignore lint/complexity/useMaxParams: native template-tag signature
      return (strings: TemplateStringsArray, ...values: unknown[]) =>
        (target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values);
    },
  });
}

// Re-bind a transaction method so any callback argument receives a wrapped client.
function scopedMethod(input: { method: (...args: unknown[]) => unknown; target: SQL }) {
  const { method, target } = input;
  return (...args: unknown[]): unknown => {
    const wrapped = args.map((arg) =>
      typeof arg === 'function'
        ? // biome-ignore lint/complexity/useMaxParams: forwards the callback's own args verbatim
          (client: SQL, ...rest: unknown[]) =>
            (arg as (...a: unknown[]) => unknown)(wrap(client), ...rest)
        : arg,
    );
    return method.apply(target, wrapped);
  };
}
