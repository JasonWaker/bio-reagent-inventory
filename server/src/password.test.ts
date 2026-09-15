import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies only the original password", async () => {
    const hash = await hashPassword("admin123");

    expect(hash).toMatch(/^\$scrypt\$/);
    await expect(verifyPassword(hash, "admin123")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
