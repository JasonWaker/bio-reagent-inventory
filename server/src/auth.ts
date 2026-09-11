import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import { config } from "./config.js";
import { pool } from "./db.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

async function sign(username: string, mustChangePassword: boolean) {
  return new SignJWT({ role: "admin", mustChangePassword })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

export async function login(username: string, password: string) {
  const found = await pool.query(
    "SELECT password_hash,must_change_password FROM admin_credentials WHERE username=$1",
    [username],
  );
  if (
    !found.rowCount ||
    !(await argon2.verify(found.rows[0].password_hash, password))
  )
    return null;
  const mustChangePassword = Boolean(found.rows[0].must_change_password);
  return {
    token: await sign(username, mustChangePassword),
    mustChangePassword,
  };
}

export async function changePassword(username: string, password: string) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const changed = await pool.query(
    "UPDATE admin_credentials SET password_hash=$2,must_change_password=false,updated_at=now() WHERE username=$1 AND must_change_password=true",
    [username, passwordHash],
  );
  if (!changed.rowCount) throw new Error("默认密码已修改，请重新登录");
  await pool.query(
    "INSERT INTO audit_logs (actor,action,entity_type) VALUES ($1,'password.change','admin_credentials')",
    [username],
  );
  return sign(username, false);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "请先登录" });
  try {
    const payload = (await jwtVerify(token, secret)).payload;
    res.locals.user = payload.sub;
    res.locals.mustChangePassword = payload.mustChangePassword === true;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

export function requirePasswordChanged(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.locals.mustChangePassword)
    return res.status(403).json({ error: "首次登录请先修改默认密码" });
  next();
}
