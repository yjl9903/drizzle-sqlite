# drizzle-sqlite

[![version](https://img.shields.io/npm/v/drizzle-sqlite?label=drizzle-sqlite)](https://www.npmjs.com/package/drizzle-sqlite)
[![CI](https://github.com/yjl9903/drizzle-sqlite/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/drizzle-sqlite/actions/workflows/ci.yml)

Drizzle-orm Node.js builtin SQLite `node:sqlite` driver.

> [!NOTE]  
> `node:sqlite` is enabled since Node.js v22.5.0, see [docs](https://nodejs.org/api/sqlite.html).

## Installation

```bash
npm i drizzle-orm drizzle-sqlite
```

## Usage

```typescript
import { eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { drizzle } from 'drizzle-sqlite';

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull()
});

const db = drizzle(':memory:', { schema: { users } });

db.run(sql`
  create table users (
    id integer primary key autoincrement,
    name text not null
  )
`);

db.insert(users).values({ name: 'Ada' }).run();
db.insert(users).values({ name: 'Lin' }).run();

const ada = await db.select().from(users).where(eq(users.name, 'Ada'));
const lin = await db.select().from(users).where(eq(users.name, 'Lin'));

console.log(ada, lin);

db.$client.close();
```

## Credits

Thanks to https://github.com/drizzle-team/drizzle-orm/pull/4346

## License

MIT License © 2026 [XLor](https://github.com/yjl9903)
