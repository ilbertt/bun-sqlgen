import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

declare module 'bun' {
  interface Env {
    DATABASE_URL: string;
  }
}

export const sql = withTypes(new SQL(Bun.env.DATABASE_URL));
