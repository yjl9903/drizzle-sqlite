import type { MigrationConfig } from 'drizzle-orm/migrator';

import { readMigrationFiles } from 'drizzle-orm/migrator';

import type { NodeSQLiteDatabase } from './driver.js';

export function migrate<TSchema extends Record<string, unknown>>(
  db: NodeSQLiteDatabase<TSchema>,
  config: MigrationConfig
): void {
  const migrations = readMigrationFiles(config);
  (db as any).dialect.migrate(migrations, (db as any).session, config);
}
