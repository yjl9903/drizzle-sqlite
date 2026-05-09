import { DatabaseSync } from 'node:sqlite';
import {
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  alias,
  blob,
  foreignKey,
  getTableConfig,
  int,
  integer,
  numeric,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueKeyName,
} from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from 'vitest';
import { drizzle, type NodeSQLiteDatabase } from '../src/index.js';

// Ported from the sqlite-common suite used by drizzle-orm's SQLite drivers,
// including the bun:sqlite driver path. Keep these tests focused on behavior
// that should be identical for node:sqlite.

const usersTable = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  json: blob('json', { mode: 'json' }).$type<string[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`strftime('%s', 'now')`),
});

const users2Table = sqliteTable('users2', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  cityId: integer('city_id').references(() => citiesTable.id),
});

const citiesTable = sqliteTable('cities', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

const ordersTable = sqliteTable('orders', {
  id: integer('id').primaryKey(),
  region: text('region').notNull(),
  product: text('product').notNull().$default(() => 'random_string'),
  amount: integer('amount').notNull(),
  quantity: integer('quantity').notNull(),
});

const bigIntExample = sqliteTable('big_int_example', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  bigInt: blob('big_int', { mode: 'bigint' }).notNull(),
});

const allTypesTable = sqliteTable('all_types', {
  int: integer('int', { mode: 'number' }),
  bool: integer('bool', { mode: 'boolean' }),
  time: integer('time', { mode: 'timestamp' }),
  timeMs: integer('time_ms', { mode: 'timestamp_ms' }),
  bigint: blob('bigint', { mode: 'bigint' }),
  buffer: blob('buffer', { mode: 'buffer' }),
  json: blob('json', { mode: 'json' }),
  numeric: numeric('numeric'),
  numericNum: numeric('numeric_num', { mode: 'number' }),
  numericBig: numeric('numeric_big', { mode: 'bigint' }),
  real: real('real'),
  text: text('text', { mode: 'text' }),
  jsonText: text('json_text', { mode: 'json' }),
});

const schema = {
  usersTable,
  users2Table,
  citiesTable,
  ordersTable,
  bigIntExample,
  allTypesTable,
};

describe('drizzle-orm bun-sqlite compatibility cases', () => {
  let client: DatabaseSync;
  let db: NodeSQLiteDatabase<typeof schema>;

  beforeEach(() => {
    client = new DatabaseSync(':memory:');
    db = drizzle(client, { schema });
    createBaseTables(db);
  });

  afterEach(() => {
    client.close();
  });

  test('table config names match sqlite common expectations', () => {
    const table = sqliteTable('cities_config', {
      id: int('id').primaryKey(),
      name: text('name').notNull(),
      state: text('state'),
    }, (t) => ({
      fk: foreignKey({ foreignColumns: [t.id], columns: [t.id], name: 'custom_fk' }),
      pk: primaryKey({ columns: [t.id, t.name], name: 'custom_pk' }),
      uniqueState: unique('custom_unique').on(t.name, t.state),
    }));

    const config = getTableConfig(table);

    expect(config.foreignKeys[0]!.getName()).toBe('custom_fk');
    expect(config.primaryKeys[0]!.getName()).toBe('custom_pk');
    expect(config.uniqueConstraints[0]!.name).toBe('custom_unique');
    expect(config.uniqueConstraints[0]!.columns.map((column) => column.name)).toEqual(['name', 'state']);
  });

  test('column unique names match sqlite common expectations', () => {
    const table = sqliteTable('cities_unique_columns', {
      id: int('id').primaryKey(),
      name: text('name').notNull().unique(),
      state: text('state').unique('custom'),
    });

    const config = getTableConfig(table);
    const nameColumn = config.columns.find((column) => column.name === 'name');
    const stateColumn = config.columns.find((column) => column.name === 'state');

    expect(nameColumn?.isUnique).toBe(true);
    expect(nameColumn?.uniqueName).toBe(uniqueKeyName(table, ['name']));
    expect(stateColumn?.isUnique).toBe(true);
    expect(stateColumn?.uniqueName).toBe('custom');
  });

  test('select all fields maps booleans, dates, defaults, and nullable json', () => {
    const now = Date.now();

    db.insert(usersTable).values({ name: 'John' }).run();
    const result = db.select().from(usersTable).all();

    expect(result[0]!.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(result[0]!.createdAt.getTime() - now)).toBeLessThan(5000);
    expect(result).toEqual([
      { id: 1, name: 'John', verified: false, json: null, createdAt: result[0]!.createdAt },
    ]);
  });

  test('select partial, sql expressions, and empty array predicates', () => {
    db.insert(usersTable).values([{ name: 'John' }, { name: 'Jane' }, { name: 'Jane' }]).run();

    expect(db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, 1)).all()).toEqual([
      { name: 'John' },
    ]);
    expect(db.select({ name: sql<string>`upper(${usersTable.name})` }).from(usersTable).where(eq(usersTable.id, 1)).all())
      .toEqual([{ name: 'JOHN' }]);
    expect(db.select({ name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, [])).all()).toEqual([]);
    expect(db.select({ name: usersTable.name }).from(usersTable).where(notInArray(usersTable.id, [])).all()).toEqual([
      { name: 'John' },
      { name: 'Jane' },
      { name: 'Jane' },
    ]);
  });

  test('select distinct preserves sqlite ordering semantics', () => {
    const distinctTable = sqliteTable('users_distinct', {
      id: integer('id').notNull(),
      name: text('name').notNull(),
    });

    db.run(sql`create table ${distinctTable} (id integer, name text)`);
    db.insert(distinctTable).values([
      { id: 1, name: 'John' },
      { id: 1, name: 'John' },
      { id: 2, name: 'John' },
      { id: 1, name: 'Jane' },
    ]).run();

    expect(db.selectDistinct().from(distinctTable).orderBy(distinctTable.id, distinctTable.name).all()).toEqual([
      { id: 1, name: 'Jane' },
      { id: 1, name: 'John' },
      { id: 2, name: 'John' },
    ]);
  });

  test('insert, update, and delete returning sql expressions', () => {
    expect(db.insert(usersTable).values({ name: 'John' }).returning({
      name: sql<string>`upper(${usersTable.name})`,
    }).all()).toEqual([{ name: 'JOHN' }]);

    expect(db.update(usersTable).set({ name: 'Jane' }).where(eq(usersTable.name, 'John')).returning({
      name: sql<string>`upper(${usersTable.name})`,
    }).all()).toEqual([{ name: 'JANE' }]);

    expect(db.delete(usersTable).where(eq(usersTable.name, 'Jane')).returning({
      name: sql<string>`upper(${usersTable.name})`,
    }).all()).toEqual([{ name: 'JANE' }]);
  });

  test('$default function and empty insert defaults', () => {
    db.insert(ordersTable).values({ id: 1, region: 'Ukraine', amount: 1, quantity: 1 }).run();
    expect(db.select().from(ordersTable).all()).toEqual([
      { id: 1, amount: 1, quantity: 1, region: 'Ukraine', product: 'random_string' },
    ]);

    const usersDefault = sqliteTable('empty_insert_multiple', {
      id: integer('id').primaryKey(),
      name: text('name').default('Dan'),
      state: text('state'),
    });

    db.run(sql`create table ${usersDefault} (id integer primary key, name text default 'Dan', state text)`);
    db.insert(usersDefault).values([{}, {}]).run();

    expect(db.select().from(usersDefault).all()).toEqual([
      { id: 1, name: 'Dan', state: null },
      { id: 2, name: 'Dan', state: null },
    ]);
  });

  test('insert auto increment and overridden defaults', () => {
    db.insert(usersTable).values([
      { name: 'John' },
      { name: 'Jane' },
      { name: 'George', verified: true },
    ]).run();

    expect(db.select({ id: usersTable.id, name: usersTable.name, verified: usersTable.verified }).from(usersTable).all())
      .toEqual([
        { id: 1, name: 'John', verified: false },
        { id: 2, name: 'Jane', verified: false },
        { id: 3, name: 'George', verified: true },
      ]);
  });

  test('bigint blob values round-trip', () => {
    db.insert(bigIntExample).values([
      { name: 'zero', bigInt: 0n },
      { name: 'small', bigInt: 127n },
      { name: 'large', bigInt: 12345678900987654321n },
    ]).run();

    expect(db.select().from(bigIntExample).all()).toEqual([
      { id: 1, name: 'zero', bigInt: 0n },
      { id: 2, name: 'small', bigInt: 127n },
      { id: 3, name: 'large', bigInt: 12345678900987654321n },
    ]);
  });

  test('cross join maps selected fields in stable order', () => {
    db.insert(usersTable).values([{ name: 'John' }, { name: 'Jane' }]).run();
    db.insert(citiesTable).values([{ name: 'Seattle' }, { name: 'New York City' }]).run();

    expect(
      db.select({
        user: usersTable.name,
        city: citiesTable.name,
      }).from(usersTable).crossJoin(citiesTable).orderBy(usersTable.name, citiesTable.name).all(),
    ).toEqual([
      { city: 'New York City', user: 'Jane' },
      { city: 'Seattle', user: 'Jane' },
      { city: 'New York City', user: 'John' },
      { city: 'Seattle', user: 'John' },
    ]);
  });

  test('all sqlite column modes round-trip', () => {
    const buffer = Buffer.from([0x44, 0x72, 0x69, 0x7a, 0x7a, 0x6c, 0x65]);

    db.run(sql`
      create table ${allTypesTable} (
        int integer,
        bool integer,
        time integer,
        time_ms integer,
        bigint blob,
        buffer blob,
        json blob,
        numeric numeric,
        numeric_num numeric,
        numeric_big numeric,
        real real,
        text text,
        json_text text
      )
    `);
    db.insert(allTypesTable).values({
      int: 1,
      bool: true,
      time: new Date(1741743161000),
      timeMs: new Date(1741743161623),
      bigint: 5044565289845416380n,
      buffer,
      json: { str: 'strval', arr: ['str', 10] },
      numeric: '475452353476',
      numericNum: 9007199254740991,
      numericBig: 5044565289845416380n,
      real: 1.048596,
      text: 'TEXT STRING',
      jsonText: { str: 'strvalb', arr: ['strb', 11] },
    }).run();

    const result = db.select().from(allTypesTable).all();

    expectTypeOf(result).toEqualTypeOf<{
      int: number | null;
      bool: boolean | null;
      time: Date | null;
      timeMs: Date | null;
      bigint: bigint | null;
      buffer: Buffer | null;
      json: unknown;
      numeric: string | null;
      numericNum: number | null;
      numericBig: bigint | null;
      real: number | null;
      text: string | null;
      jsonText: unknown;
    }[]>();
    expect(result).toEqual([{
      int: 1,
      bool: true,
      time: new Date('2025-03-12T01:32:41.000Z'),
      timeMs: new Date('2025-03-12T01:32:41.623Z'),
      bigint: 5044565289845416380n,
      buffer,
      json: { str: 'strval', arr: ['str', 10] },
      numeric: '475452353476',
      numericNum: 9007199254740991,
      numericBig: 5044565289845416380n,
      real: 1.048596,
      text: 'TEXT STRING',
      jsonText: { str: 'strvalb', arr: ['strb', 11] },
    }]);
  });

  test('limit edge cases', () => {
    db.insert(usersTable).values([
      { name: 'Barry', verified: false },
      { name: 'Alan', verified: false },
      { name: 'Carl', verified: false },
    ]).run();

    expect(db.select().from(usersTable).limit(0).all()).toEqual([]);
    expect(db.select().from(usersTable).limit(-1).all().length).toBeGreaterThan(0);
  });

  test.skip('update/delete with limit and order by', () => {
    // This mirrors drizzle-orm sqlite-common coverage for bun:sqlite. Node's
    // bundled SQLite currently rejects the generated syntax in this environment
    // because UPDATE/DELETE ORDER BY LIMIT support depends on SQLite compile flags.
    db.insert(usersTable).values([
      { name: 'Barry', verified: false },
      { name: 'Alan', verified: false },
      { name: 'Carl', verified: false },
    ]).run();
    db.update(usersTable).set({ verified: true }).limit(2).orderBy(asc(usersTable.name)).run();
    expect(db.select({ name: usersTable.name, verified: usersTable.verified }).from(usersTable).orderBy(asc(usersTable.name)).all())
      .toEqual([
        { name: 'Alan', verified: true },
        { name: 'Barry', verified: true },
        { name: 'Carl', verified: false },
      ]);

    db.delete(usersTable).where(eq(usersTable.verified, true)).limit(1).orderBy(asc(usersTable.name)).run();
    expect(db.select({ name: usersTable.name, verified: usersTable.verified }).from(usersTable).orderBy(asc(usersTable.name)).all())
      .toEqual([
        { name: 'Barry', verified: true },
        { name: 'Carl', verified: false },
      ]);
  });

  test('update from with alias', () => {
    db.insert(citiesTable).values([{ name: 'New York City' }, { name: 'Seattle' }]).run();
    db.insert(users2Table).values([{ name: 'John', cityId: 1 }, { name: 'Jane', cityId: 2 }]).run();

    const cities = alias(citiesTable, 'c');
    const result = db.update(users2Table)
      .set({ cityId: cities.id })
      .from(cities)
      .where(eq(cities.name, 'Seattle'))
      .returning()
      .all();

    expect(result).toEqual([
      { id: 1, name: 'John', cityId: 2 },
      { id: 2, name: 'Jane', cityId: 2 },
    ]);
  });

  test('insert into select and key-order validation', async () => {
    const notifications = sqliteTable('notifications_insert_into', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      message: text('message').notNull(),
    });
    const insertUsers = sqliteTable('users_insert_into', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      name: text('name').notNull(),
    });
    const userNotifications = sqliteTable('user_notifications_insert_into', {
      userId: integer('user_id').notNull(),
      notificationId: integer('notification_id').notNull(),
    }, (table) => ({
      pk: primaryKey({ columns: [table.userId, table.notificationId] }),
    }));

    db.run(sql`create table ${notifications} (id integer primary key autoincrement, message text not null)`);
    db.run(sql`create table ${insertUsers} (id integer primary key autoincrement, name text not null)`);
    db.run(sql`create table ${userNotifications} (user_id integer not null, notification_id integer not null, primary key (user_id, notification_id))`);

    const notification = db.insert(notifications).values({ message: 'Hello' }).returning({ id: notifications.id }).get();
    db.insert(insertUsers).values([{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]).run();

    expect(db.insert(userNotifications).select(
      db.select({
        userId: insertUsers.id,
        notificationId: sql`${notification.id}`.as('notification_id'),
      }).from(insertUsers).where(inArray(insertUsers.name, ['Alice', 'Charlie'])).orderBy(asc(insertUsers.id)),
    ).returning().all()).toEqual([
      { userId: 1, notificationId: 1 },
      { userId: 3, notificationId: 1 },
    ]);

    await expect(async () => {
      db.insert(insertUsers).select(
        db.select({
          name: users2Table.name,
          id: users2Table.id,
        }).from(users2Table),
      );
    }).rejects.toThrowError();
  });

  test('object keys as column names and sql operator cte', () => {
    const objectKeyUsers = sqliteTable('object_key_users', {
      id: integer().primaryKey({ autoIncrement: true }),
      createdAt: integer({ mode: 'timestamp' }),
      name: text(),
    });

    db.run(sql`create table ${objectKeyUsers} ("id" integer primary key autoincrement, "createdAt" integer, "name" text)`);
    db.insert(objectKeyUsers).values([
      { createdAt: new Date(Date.now() - 2592000000), name: 'John' },
      { createdAt: new Date(Date.now() - 86400000), name: 'Jane' },
    ]).run();

    expect(
      db.select({ id: objectKeyUsers.id, name: objectKeyUsers.name })
        .from(objectKeyUsers)
        .where(gt(objectKeyUsers.createdAt, new Date(Date.now() - 2592000000)))
        .all(),
    ).toEqual([{ id: 2, name: 'Jane' }]);

    const cteUsers = sqliteTable('cte_users', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      name: text('name').notNull(),
    });
    db.run(sql`create table ${cteUsers} (id integer not null primary key autoincrement, name text not null)`);
    db.insert(cteUsers).values([{ name: 'John' }, { name: 'Jane' }]).run();

    const sq = db.$with('sq', {
      userId: cteUsers.id,
      data: { name: cteUsers.name },
    }).as(sql`select * from ${cteUsers} where ${cteUsers.name} = 'John'`);

    expect(db.with(sq).select().from(sq).all()).toEqual([
      { userId: 1, data: { name: 'John' } },
    ]);
  });

  test('getTableColumns works with insert values spread', () => {
    const columns = getTableColumns(usersTable);

    db.insert(usersTable).values({ name: 'John', verified: true }).run();

    expect(db.select({ id: columns.id, name: columns.name, verified: columns.verified }).from(usersTable).all())
      .toEqual([{ id: 1, name: 'John', verified: true }]);
  });
});

function createBaseTables(db: NodeSQLiteDatabase<typeof schema>) {
  db.run(sql`
    create table ${usersTable} (
      id integer primary key,
      name text not null,
      verified integer not null default 0,
      json blob,
      created_at integer not null default (strftime('%s', 'now'))
    )
  `);
  db.run(sql`
    create table ${citiesTable} (
      id integer primary key,
      name text not null
    )
  `);
  db.run(sql`
    create table ${users2Table} (
      id integer primary key,
      name text not null,
      city_id integer references cities(id)
    )
  `);
  db.run(sql`
    create table ${ordersTable} (
      id integer primary key,
      region text not null,
      product text not null,
      amount integer not null,
      quantity integer not null
    )
  `);
  db.run(sql`
    create table ${bigIntExample} (
      id integer primary key,
      name text not null,
      big_int blob not null
    )
  `);
}
