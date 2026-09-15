import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import { config } from "./config.js";

const directory = path.resolve("migrations");
for (const file of (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  await pool.query(await readFile(path.join(directory, file), "utf8"));
}
await pool.query(
  "INSERT INTO admin_credentials (username,password_hash,must_change_password) VALUES ($1,$2,true) ON CONFLICT (username) DO NOTHING",
  [config.ADMIN_USERNAME, config.ADMIN_PASSWORD_HASH],
);
await pool.end();
console.log(JSON.stringify({ event: "migrations_complete" }));
