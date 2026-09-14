import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// Test-only D1 adapter over the real SQLite engine. No network access.
// Async entrypoints allow requests to interleave; a batch is one transaction.
export class SQLiteD1 {
  constructor({ filename = ":memory:", initialize = true } = {}) {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    if (initialize) this.sqlite.exec(schema);
  }

  prepare(sql) {
    return new D1Statement(this, sql, []);
  }

  async batch(statements) {
    await Promise.resolve();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.sqlite.close();
  }
}

class D1Statement {
  constructor(database, sql, parameters) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new D1Statement(this.database, this.sql, parameters);
  }

  async first() {
    await Promise.resolve();
    return this.database.sqlite.prepare(this.sql).get(...this.parameters) ?? null;
  }

  execute() {
    const statement = this.database.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      return { success: true, results: statement.all(...this.parameters), meta: { changes: 0 } };
    }
    const info = statement.run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}
