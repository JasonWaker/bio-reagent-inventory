import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import {
  changePassword,
  login,
  requireAuth,
  requirePasswordChanged,
} from "./auth.js";
import { pool } from "./db.js";
import { stateSchema } from "./schema.js";
import { readState, writeState } from "./state.js";
import { recognizeDocument } from "./recognition.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: ["Authorization", "Content-Type"],
  }),
);
app.use(express.json({ limit: "8mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) =>
    done(
      null,
      ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype),
    ),
});
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const recognitionLimit = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.post("/auth/login", authLimit, async (req, res) => {
  const input = z
    .object({
      username: z.string().min(1),
      password: z.string().min(1).max(200),
    })
    .safeParse(req.body);
  if (!input.success)
    return res.status(400).json({ error: "请填写账号和密码" });
  const session = await login(input.data.username, input.data.password);
  if (!session) return res.status(401).json({ error: "账号或密码不正确" });
  res.json({ ...session, expiresIn: 7200 });
});
app.post("/auth/change-password", authLimit, requireAuth, async (req, res) => {
  const input = z
    .object({ password: z.string().min(10).max(200) })
    .safeParse(req.body);
  if (!input.success)
    return res.status(400).json({ error: "新密码至少需要 10 个字符" });
  res.json({
    token: await changePassword(res.locals.user, input.data.password),
  });
});
app.get("/state", requireAuth, requirePasswordChanged, async (_req, res) =>
  res.json(await readState()),
);
app.put("/state", requireAuth, requirePasswordChanged, async (req, res) => {
  const input = z
    .object({
      state: stateSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .safeParse(req.body);
  if (!input.success)
    return res.status(400).json({ error: "库存数据格式不正确" });
  const revision = await writeState(
    input.data.state,
    input.data.expectedRevision,
    res.locals.user,
  );
  if (revision === null)
    return res
      .status(409)
      .json({ error: "云端数据已在其他设备更新，请先重新加载" });
  res.json({ revision });
});
app.post(
  "/recognition/:kind",
  requireAuth,
  requirePasswordChanged,
  recognitionLimit,
  upload.single("image"),
  async (req, res) => {
    if (req.params.kind !== "inbound" && req.params.kind !== "outbound")
      return res.status(404).json({ error: "不支持的单据类型" });
    if (!req.file)
      return res.status(400).json({ error: "请上传 JPG、PNG 或 WebP 图片" });
    const bytes = req.file.buffer;
    const validSignature =
      (req.file.mimetype === "image/jpeg" &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) ||
      (req.file.mimetype === "image/png" &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (req.file.mimetype === "image/webp" &&
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP");
    if (!validSignature)
      return res.status(400).json({ error: "图片文件内容与格式不一致" });
    try {
      res.json(
        await recognizeDocument(req.file, req.params.kind, res.locals.user),
      );
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "图片识别失败",
      });
    }
  },
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error instanceof Error ? error.message : "request_failed");
    res.status(500).json({ error: "服务器处理失败" });
  },
);

app.listen(config.PORT, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "server_started", port: config.PORT })),
);
