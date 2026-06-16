import { createTableSql } from '@repo/bun-sqlgen';

const sql = createTableSql({
  name: 'users',
  columns: {
    id: 'integer',
    name: 'text',
    email: 'text',
  },
});

console.log(sql);
