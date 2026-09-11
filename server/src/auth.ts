import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import { config } from "./config.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export async function login(username: string, password: string) {
  if (
    username !== config.ADMIN_USERNAME ||
    !(await argon2.verify(config.ADMIN_PASSWORD_HASH, password))
  )
    return null;
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "请先登录" });
  try {
    res.locals.user = (await jwtVerify(token, secret)).payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}
