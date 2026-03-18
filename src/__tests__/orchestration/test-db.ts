import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { CREATE_TABLES } from "../../state/schema.js";

export type TestDatabase = BetterSqlite3.Database;

export function createInMemoryDb(): TestDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  return db;
}
