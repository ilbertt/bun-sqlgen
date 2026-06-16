# @ilbertt/bun-sqlgen

> SQL generation utilities for [Bun](https://bun.sh)'s built-in SQL module.

## Installation

```sh
npm install @ilbertt/bun-sqlgen
# or
bun add @ilbertt/bun-sqlgen
```

## Usage

```ts
import { createTableSql } from '@ilbertt/bun-sqlgen';

const sql = createTableSql({
  name: 'users',
  columns: {
    id: 'integer',
    name: 'text',
  },
});

console.log(sql);
// CREATE TABLE users (
//   id INTEGER,
//   name TEXT
// );
```

## License

[Unlicense](https://unlicense.org/)
