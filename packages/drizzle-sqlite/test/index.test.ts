import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { drizzle, type NodeSQLiteDatabase } from '../src/index.js';
import { migrate } from '../src/migrator.js';

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  age: integer('age'),
});

const schema = { users };

describe('drizzle-sqlite node:sqlite driver', () => {
  let client: DatabaseSync | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  function createDb<TSchema extends Record<string, unknown> = typeof schema>() {
    client = new DatabaseSync(':memory:');
    const db = drizzle<TSchema>(client, { schema: schema as unknown as TSchema });
    db.run(sql`
      create table users (
        id integer primary key autoincrement,
        name text not null,
        age integer
      )
    `);
    return db;
  }

  it('opens default, path, client, and config-object connections', () => {
    const defaultDb = drizzle();
    expect(defaultDb.$client).toBeInstanceOf(DatabaseSync);
    defaultDb.$client.close();

    const pathDb = drizzle(':memory:');
    expect(pathDb.$client).toBeInstanceOf(DatabaseSync);
    pathDb.$client.close();

    client = new DatabaseSync(':memory:');
    const clientDb = drizzle(client);
    expect(clientDb.$client).toBe(client);

    const configDb = drizzle({ connection: { path: ':memory:' } });
    expect(configDb.$client).toBeInstanceOf(DatabaseSync);
    configDb.$client.close();
  });

  it('runs inserts, selects, updates, deletes, returning, and raw queries', () => {
    const db = createDb();

    const inserted = db.insert(users).values({ name: 'Ada', age: 37 }).run();
    expect(inserted).toEqual({ changes: 1, lastInsertRowid: 1 });

    db.insert(users).values([{ name: 'Lin', age: 29 }, { name: 'Max', age: null }]).run();

    expect(db.select().from(users).all()).toEqual([
      { id: 1, name: 'Ada', age: 37 },
      { id: 2, name: 'Lin', age: 29 },
      { id: 3, name: 'Max', age: null },
    ]);

    expect(
      db.select({ userName: users.name }).from(users).where(eq(users.id, 2)).get(),
    ).toEqual({ userName: 'Lin' });

    expect(db.select({ id: users.id, name: users.name }).from(users).values()).toEqual([
      [1, 'Ada'],
      [2, 'Lin'],
      [3, 'Max'],
    ]);

    expect(
      db.update(users).set({ age: 38 }).where(eq(users.name, 'Ada')).returning({
        id: users.id,
        age: users.age,
      }).get(),
    ).toEqual({ id: 1, age: 38 });

    expect(db.delete(users).where(eq(users.name, 'Max')).returning({ id: users.id }).all()).toEqual([
      { id: 3 },
    ]);

    expect(db.get<{ count: number }>(sql`select count(*) as count from users`)).toEqual({ count: 2 });
    expect(db.values<[number, string]>(sql`select id, name from users order by id`)).toEqual([
      [1, 'Ada'],
      [2, 'Lin'],
    ]);
  });

  it('commits, rolls back, and uses nested savepoints', () => {
    const db = createDb();

    db.transaction((tx) => {
      tx.insert(users).values({ name: 'Ada', age: 37 }).run();
    });
    expect(db.select().from(users).all()).toHaveLength(1);

    expect(() => {
      db.transaction((tx) => {
        tx.insert(users).values({ name: 'Lin', age: 29 }).run();
        throw new Error('rollback');
      });
    }).toThrow('rollback');
    expect(db.select().from(users).all()).toEqual([{ id: 1, name: 'Ada', age: 37 }]);

    db.transaction((tx) => {
      tx.insert(users).values({ name: 'Grace', age: 85 }).run();
      try {
        tx.transaction((nested) => {
          nested.insert(users).values({ name: 'Nested', age: 1 }).run();
          throw new Error('nested rollback');
        });
      } catch {
        // expected savepoint rollback
      }
    });

    expect(db.select({ name: users.name }).from(users).all()).toEqual([
      { name: 'Ada' },
      { name: 'Grace' },
    ]);
  });

  it('runs migrations through drizzle migrator', () => {
    client = new DatabaseSync(':memory:');
    const db = drizzle(client);
    const migrationsFolder = mkdtempSync(join(tmpdir(), 'drizzle-sqlite-migrations-'));
    mkdirSync(join(migrationsFolder, 'meta'));
    writeFileSync(
      join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '7', when: 1, tag: '0000_init', breakpoints: true }],
      }),
    );
    writeFileSync(
      join(migrationsFolder, '0000_init.sql'),
      'create table users (id integer primary key autoincrement, name text not null, age integer);',
    );

    migrate(db, { migrationsFolder });

    db.insert(users).values({ name: 'Ada', age: 37 }).run();
    expect(db.select().from(users).all()).toEqual([{ id: 1, name: 'Ada', age: 37 }]);
    expect(db.get<{ count: number }>(sql`select count(*) as count from __drizzle_migrations`)).toEqual({
      count: 1,
    });
  });

  it('preserves public types', () => {
    client = new DatabaseSync(':memory:');
    const db = drizzle<typeof schema>(client, { schema });

    expectTypeOf(db).toMatchTypeOf<NodeSQLiteDatabase<typeof schema>>();
    expectTypeOf(db.$client).toEqualTypeOf<DatabaseSync>();
    expectTypeOf(migrate<typeof schema>).parameter(0).toMatchTypeOf<NodeSQLiteDatabase<typeof schema>>();
  });
});
