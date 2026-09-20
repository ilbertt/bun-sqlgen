import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

export const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));
