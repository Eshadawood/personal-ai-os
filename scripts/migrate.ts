import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to run migrations.");

const parsed = new URL(url);
const tlsEnabled = process.env.VERCEL === "1" || process.env.NODE_ENV === "production" || process.env.DATABASE_SSL === "true";
const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, ""),
  ...(tlsEnabled ? { ssl: { rejectUnauthorized } } : {}),
});

const migrationFiles = [
  "drizzle/0001_sleepy_morph.sql",
  "drizzle/0002_auth_sessions.sql",
];

try {
  // The legacy auth migration alters users, so bootstrap that table first for
  // databases created from the current schema rather than the old template.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`openId\` varchar(128) NOT NULL,
      \`name\` text,
      \`email\` varchar(320),
      \`passwordHash\` text,
      \`loginMethod\` varchar(64),
      \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`lastSignedIn\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`users_openId_unique\` (\`openId\`)
    )
  `);

  // The repository's migrations predate the current auth schema and were not
  // recorded in a migration table. Make CREATE statements repeatable so a
  // Vercel build can safely repair an empty or partially initialized database.
  for (const file of migrationFiles) {
    const sql = await readFile(path.resolve(file), "utf8");
    const statements = sql
      .split(/(?:--> statement-breakpoint|;\s*$)/m)
      .map(statement => statement.trim())
      .filter(Boolean)
      .map(statement => statement.replace(/^CREATE TABLE `/i, "CREATE TABLE IF NOT EXISTS `"));

    for (const statement of statements) {
      const normalized = statement
        .replace(/^ALTER TABLE `users` ADD COLUMN /i, "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS ")
        .replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS ");
      try {
        await connection.query(normalized);
      } catch (error) {
        // Existing indexes/columns can still be reported as duplicate by older
        // TiDB/MySQL versions; all other errors must fail the deployment.
        const code = (error as { code?: string }).code;
        if (code !== "ER_DUP_KEYNAME" && code !== "ER_DUP_FIELDNAME") throw error;
      }
    }
    console.log(`Applied ${file}`);
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`openId\` varchar(128) NOT NULL,
      \`name\` text,
      \`email\` varchar(320),
      \`passwordHash\` text,
      \`loginMethod\` varchar(64),
      \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`lastSignedIn\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`users_openId_unique\` (\`openId\`)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`sessions\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`tokenHash\` varchar(128) NOT NULL,
      \`expiresAt\` timestamp NOT NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`sessions_tokenHash_unique\` (\`tokenHash\`),
      KEY \`sessions_userId_idx\` (\`userId\`),
      KEY \`sessions_expiresAt_idx\` (\`expiresAt\`)
    )
  `);
  console.log("Ensured current users and sessions schema.");
} finally {
  await connection.end();
}
