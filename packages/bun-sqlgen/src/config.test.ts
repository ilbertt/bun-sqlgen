import { expect, test } from 'bun:test';
import { defineConfig } from '#config.ts';

test('the schema allowlist is specific to PostgreSQL configs', () => {
  const config = { schemas: ['app'] };
  expect(defineConfig(config)).toBe(config);
  expect(defineConfig({ dialect: 'postgres', schemas: [] }).schemas).toEqual([]);
  // @ts-expect-error PostgreSQL schema names are unavailable for SQLite.
  defineConfig({ dialect: 'sqlite', schemas: ['app'] });
});
