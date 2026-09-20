import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

export const sql = withTypes(new SQL()); // connects with DATABASE_URL
