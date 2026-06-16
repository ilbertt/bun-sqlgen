export type ColumnType = 'text' | 'integer' | 'real' | 'blob';

export interface TableSchema {
  name: string;
  columns: Record<string, ColumnType>;
}

/**
 * Generates a `CREATE TABLE` statement from a table schema.
 *
 * This is a placeholder scaffold for the `@ilbertt/bun-sqlgen` package — replace
 * it with the real SQL generation API.
 */
export function createTableSql({ name, columns }: TableSchema): string {
  const definitions = Object.entries(columns).map(
    ([column, type]) => `  ${column} ${type.toUpperCase()}`,
  );
  return `CREATE TABLE ${name} (\n${definitions.join(',\n')}\n);`;
}
