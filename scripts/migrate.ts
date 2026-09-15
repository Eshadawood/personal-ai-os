import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to run migrations.");
const connection = await mysql.createConnection(url);
try {
  for (const file of ["drizzle/0001_sleepy_morph.sql", "drizzle/0002_auth_sessions.sql"]) {
    const sql = await readFile(path.resolve(file), "utf8");
    const statements = sql.split(/(?:--> statement-breakpoint|;\s*$)/m).map(statement => statement.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    console.log(`Applied ${file}`);
  }
} finally {
  await connection.end();
}
