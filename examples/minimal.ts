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
