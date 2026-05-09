import { DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';
import { NoopCache } from 'drizzle-orm/cache/core';
import { entityKind } from 'drizzle-orm/entity';
import { DefaultLogger } from 'drizzle-orm/logger';
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  type ExtractTablesWithRelations,
  type RelationalSchemaConfig,
  type TablesRelationalConfig
} from 'drizzle-orm/relations';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import { type DrizzleConfig, isConfig } from 'drizzle-orm/utils';

import { NodeSQLiteSession } from './session.js';

export type NodeSQLitePath = string | Buffer | URL;

export type DrizzleNodeSQLiteConfig =
  | ({
      path?: NodeSQLitePath;
    } & DatabaseSyncOptions)
  | NodeSQLitePath
  | undefined;

export type NodeSQLiteRunResult = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};

export class NodeSQLiteDatabase<
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
> extends BaseSQLiteDatabase<'sync', NodeSQLiteRunResult, TFullSchema, TSchema> {
  static override readonly [entityKind]: string = 'NodeSQLiteDatabase';
}

function construct<
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
>(
  client: DatabaseSync,
  config: DrizzleConfig<TFullSchema> = {}
): NodeSQLiteDatabase<TFullSchema, TSchema> & {
  $client: DatabaseSync;
} {
  const dialect = new SQLiteSyncDialect({ casing: config.casing });
  let logger;
  if (config.logger === true) {
    logger = new DefaultLogger();
  } else if (config.logger !== false) {
    logger = config.logger;
  }

  const cache = config.cache ?? new NoopCache();

  let schema: RelationalSchemaConfig<TSchema> | undefined;
  if (config.schema) {
    const tablesConfig = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
    schema = {
      fullSchema: config.schema,
      schema: tablesConfig.tables as TSchema,
      tableNamesMap: tablesConfig.tableNamesMap
    };
  }

  const session = new NodeSQLiteSession<TFullSchema, TSchema>(client, dialect, schema, {
    logger,
    cache
  });
  const db = new NodeSQLiteDatabase<TFullSchema, TSchema>('sync', dialect, session, schema);
  (db as any).$client = client;
  (db as any).$cache = cache;
  if ((db as any).$cache) {
    (db as any).$cache.invalidate = cache.onMutate;
  }

  return db as any;
}

function isNodeSQLitePath(value: unknown): value is NodeSQLitePath {
  return typeof value === 'string' || value instanceof Buffer || value instanceof URL;
}

function createClient(connection?: DrizzleNodeSQLiteConfig): DatabaseSync {
  if (connection && typeof connection === 'object' && !isNodeSQLitePath(connection)) {
    const { path = ':memory:', ...options } = connection as {
      path?: NodeSQLitePath;
    } & DatabaseSyncOptions;
    return new DatabaseSync(path, options);
  }

  return new DatabaseSync((connection ?? ':memory:') as NodeSQLitePath);
}

export function drizzle<
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
>(
  ...params:
    | []
    | [DatabaseSync | NodeSQLitePath]
    | [DatabaseSync | NodeSQLitePath, DrizzleConfig<TFullSchema>]
    | [
        DrizzleConfig<TFullSchema> &
          (
            | {
                connection?: DrizzleNodeSQLiteConfig;
              }
            | {
                client: DatabaseSync;
              }
          )
      ]
): NodeSQLiteDatabase<TFullSchema, TSchema> & {
  $client: DatabaseSync;
} {
  if (params[0] === undefined || isNodeSQLitePath(params[0])) {
    return construct(createClient(params[0]), params[1]);
  }

  if (isConfig(params[0])) {
    const { connection, client, ...drizzleConfig } = params[0] as {
      connection?: DrizzleNodeSQLiteConfig;
      client?: DatabaseSync;
    } & DrizzleConfig<TFullSchema>;

    if (client) {
      return construct(client, drizzleConfig);
    }

    return construct(createClient(connection), drizzleConfig);
  }

  return construct(params[0] as DatabaseSync, params[1] as DrizzleConfig<TFullSchema> | undefined);
}

export namespace drizzle {
  export function mock<
    TFullSchema extends Record<string, unknown> = Record<string, never>,
    TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
  >(
    config?: DrizzleConfig<TFullSchema>
  ): NodeSQLiteDatabase<TFullSchema, TSchema> & {
    $client: '$client is not available on drizzle.mock()';
  } {
    return construct({} as any, config) as any;
  }
}
