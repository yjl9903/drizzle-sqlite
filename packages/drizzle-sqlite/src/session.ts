import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Cache } from 'drizzle-orm/cache/core';
import { NoopCache } from 'drizzle-orm/cache/core';
import type { WithCacheConfig } from 'drizzle-orm/cache/core/types';
import { entityKind } from 'drizzle-orm/entity';
import type { Logger } from 'drizzle-orm/logger';
import { NoopLogger } from 'drizzle-orm/logger';
import type { RelationalSchemaConfig, TablesRelationalConfig } from 'drizzle-orm/relations';
import { fillPlaceholders, type Query, sql } from 'drizzle-orm/sql/sql';
import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import type { SelectedFieldsOrdered } from 'drizzle-orm/sqlite-core/query-builders/select.types';
import {
  type PreparedQueryConfig as PreparedQueryConfigBase,
  type SQLiteExecuteMethod,
  SQLitePreparedQuery as PreparedQueryBase,
  SQLiteSession,
  type SQLiteTransactionConfig
} from 'drizzle-orm/sqlite-core/session';
import * as drizzleUtils from 'drizzle-orm/utils';

import type { NodeSQLiteRunResult } from './driver.js';

const mapResultRow = (
  drizzleUtils as unknown as {
    mapResultRow<TResult>(
      columns: SelectedFieldsOrdered,
      row: unknown[],
      joinsNotNullableMap: Record<string, boolean> | undefined
    ): TResult;
  }
).mapResultRow;

export interface NodeSQLiteSessionOptions {
  logger?: Logger;
  cache?: Cache;
}

type PreparedQueryConfig = Omit<PreparedQueryConfigBase, 'statement' | 'run'>;

export class NodeSQLiteSession<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig
> extends SQLiteSession<'sync', NodeSQLiteRunResult, TFullSchema, TSchema> {
  static override readonly [entityKind]: string = 'NodeSQLiteSession';

  private logger: Logger;
  private cache: Cache;

  constructor(
    private client: DatabaseSync,
    dialect: SQLiteSyncDialect,
    private schema: RelationalSchemaConfig<TSchema> | undefined,
    options: NodeSQLiteSessionOptions = {}
  ) {
    super(dialect);
    this.logger = options.logger ?? new NoopLogger();
    this.cache = options.cache ?? new NoopCache();
  }

  exec(query: string): void {
    this.client.exec(query);
  }

  prepareQuery<T extends Omit<PreparedQueryConfig, 'run'>>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    isResponseInArrayMode: boolean,
    customResultMapper?: (
      rows: unknown[][],
      mapColumnValue?: (value: unknown) => unknown
    ) => unknown,
    queryMetadata?: {
      type: 'select' | 'update' | 'delete' | 'insert';
      tables: string[];
    },
    cacheConfig?: WithCacheConfig
  ): NodeSQLitePreparedQuery<T> {
    const stmt = this.client.prepare(query.sql);
    return new NodeSQLitePreparedQuery(
      stmt,
      query,
      this.logger,
      this.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper
    );
  }

  override transaction<T>(
    transaction: (tx: NodeSQLiteTransaction<TFullSchema, TSchema>) => T,
    config: SQLiteTransactionConfig = {}
  ): T {
    const tx = new NodeSQLiteTransaction<TFullSchema, TSchema>(
      'sync',
      (this as any).dialect,
      this,
      this.schema
    );
    this.client.exec(`begin ${config.behavior ?? 'deferred'}`);
    try {
      const result = transaction(tx);
      this.client.exec('commit');
      return result;
    } catch (err) {
      this.client.exec('rollback');
      throw err;
    }
  }
}

export class NodeSQLiteTransaction<
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig
> extends SQLiteTransaction<'sync', NodeSQLiteRunResult, TFullSchema, TSchema> {
  static override readonly [entityKind]: string = 'NodeSQLiteTransaction';

  override transaction<T>(transaction: (tx: NodeSQLiteTransaction<TFullSchema, TSchema>) => T): T {
    const savepointName = `sp${this.nestedIndex}`;
    const tx = new NodeSQLiteTransaction<TFullSchema, TSchema>(
      'sync',
      (this as any).dialect,
      (this as any).session,
      (this as any).schema,
      this.nestedIndex + 1
    );
    (this as any).session.run(sql.raw(`savepoint ${savepointName}`));
    try {
      const result = transaction(tx);
      (this as any).session.run(sql.raw(`release savepoint ${savepointName}`));
      return result;
    } catch (err) {
      (this as any).session.run(sql.raw(`rollback to savepoint ${savepointName}`));
      throw err;
    }
  }
}

export class NodeSQLitePreparedQuery<
  T extends PreparedQueryConfig = PreparedQueryConfig
> extends PreparedQueryBase<{
  type: 'sync';
  run: NodeSQLiteRunResult;
  all: T['all'];
  get: T['get'];
  values: T['values'];
  execute: T['execute'];
}> {
  static override readonly [entityKind]: string = 'NodeSQLitePreparedQuery';

  constructor(
    private stmt: StatementSync,
    query: Query,
    private logger: Logger,
    cache: Cache,
    queryMetadata:
      | {
          type: 'select' | 'update' | 'delete' | 'insert';
          tables: string[];
        }
      | undefined,
    cacheConfig: WithCacheConfig | undefined,
    private fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    private _isResponseInArrayMode: boolean,
    private customResultMapper?: (
      rows: unknown[][],
      mapColumnValue?: (value: unknown) => unknown
    ) => unknown
  ) {
    super('sync', executeMethod, query, cache, queryMetadata, cacheConfig);
  }

  run(placeholderValues?: Record<string, unknown>): NodeSQLiteRunResult {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    this.stmt.setReturnArrays(false);
    return this.stmt.run(...(params as any[]));
  }

  all(placeholderValues?: Record<string, unknown>): T['all'] {
    const { fields, query, logger, stmt, customResultMapper } = this;
    const joinsNotNullableMap = (this as any).joinsNotNullableMap as
      | Record<string, boolean>
      | undefined;
    if (!fields && !customResultMapper) {
      const params = fillPlaceholders(query.params, placeholderValues ?? {});
      logger.logQuery(query.sql, params);
      stmt.setReturnArrays(false);
      return stmt.all(...(params as any[])) as T['all'];
    }

    const rows = this.values(placeholderValues) as unknown[][];
    if (customResultMapper) {
      return customResultMapper(rows) as T['all'];
    }

    return rows.map((row) => mapResultRow(fields!, row, joinsNotNullableMap)) as T['all'];
  }

  get(placeholderValues?: Record<string, unknown>): T['get'] {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);

    const { fields, stmt, customResultMapper } = this;
    const joinsNotNullableMap = (this as any).joinsNotNullableMap as
      | Record<string, boolean>
      | undefined;
    if (!fields && !customResultMapper) {
      stmt.setReturnArrays(false);
      return stmt.get(...(params as any[])) as T['get'];
    }

    stmt.setReturnArrays(true);
    const row = stmt.get(...(params as any[])) as unknown[] | undefined;
    if (!row) {
      return undefined as T['get'];
    }

    if (customResultMapper) {
      return customResultMapper([row]) as T['get'];
    }

    return mapResultRow(fields!, row, joinsNotNullableMap) as T['get'];
  }

  values(placeholderValues?: Record<string, unknown>): T['values'] {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    this.stmt.setReturnArrays(true);
    return this.stmt.all(...(params as any[])) as T['values'];
  }

  /** @internal */
  isResponseInArrayMode(): boolean {
    return this._isResponseInArrayMode;
  }
}
