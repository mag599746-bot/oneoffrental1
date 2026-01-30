import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import sqlite3 from "sqlite3";
import { createHmac } from "crypto";
import { Pool } from "pg";

dotenv.config();

const {
  PORT = 4000,
  ADMIN_PASSWORD,
  ADMIN_TOKEN_SECRET,
  ALLOWED_ORIGINS = "",
  SMTP_HOST,
  SMTP_PORT = "465",
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  ADMIN_EMAIL,
  SENS_SERVICE_ID,
  SENS_ACCESS_KEY,
  SENS_SECRET_KEY,
  SENS_FROM_NUMBER,
  ADMIN_PHONE,
  DATABASE_URL,
  PG_SSL = "true",
} = process.env;

if (!ADMIN_PASSWORD || !ADMIN_TOKEN_SECRET) {
  console.warn("ADMIN_PASSWORD or ADMIN_TOKEN_SECRET is missing.");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const allowList = ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowList.length === 0 || allowList.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "DELETE"],
  })
);

const dbType = DATABASE_URL ? "postgres" : "sqlite";
let sqliteDb = null;
let pgPool = null;

function initSqlite() {
  sqliteDb = new sqlite3.Database("./data.sqlite");
  sqliteDb.serialize(() => {
    sqliteDb.run(
      `CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventName TEXT NOT NULL,
        eventDate TEXT NOT NULL,
        eventPlace TEXT NOT NULL,
        eventDuration TEXT,
        ledType TEXT,
        ledSize TEXT,
        ledContent TEXT,
        power TEXT,
        extra TEXT,
        contactName TEXT NOT NULL,
        contactCompany TEXT,
        contactPhone TEXT NOT NULL,
        contactEmail TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`
    );
  });
}

async function initPostgres() {
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  await pgPool.query(
    `CREATE TABLE IF NOT EXISTS quotes (
      id SERIAL PRIMARY KEY,
      eventName TEXT NOT NULL,
      eventDate TEXT NOT NULL,
      eventPlace TEXT NOT NULL,
      eventDuration TEXT,
      ledType TEXT,
      ledSize TEXT,
      ledContent TEXT,
      power TEXT,
      extra TEXT,
      contactName TEXT NOT NULL,
      contactCompany TEXT,
      contactPhone TEXT NOT NULL,
      contactEmail TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`
  );
}

function runSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function allSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function insertQuote(values) {
  if (dbType === "postgres") {
    await pgPool.query(
      `INSERT INTO quotes (eventName, eventDate, eventPlace, eventDuration, ledType, ledSize, ledContent, power, extra, contactName, contactCompany, contactPhone, contactEmail, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
      ,
      values
    );
    return;
  }

  await runSqlite(
    `INSERT INTO quotes (eventName, eventDate, eventPlace, eventDuration, ledType, ledSize, ledContent, power, extra, contactName, contactCompany, contactPhone, contactEmail, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ,
    values
  );
}

async function getQuotes() {
  if (dbType === "postgres") {
    const result = await pgPool.query("SELECT * FROM quotes ORDER BY id DESC");
    return result.rows;
  }
  return allSqlite("SELECT * FROM quotes ORDER BY id DESC");
}

async function deleteQuote(id) {
  if (dbType === "postgres") {
    await pgPool.query("DELETE FROM quotes WHERE id = $1", [id]);
    return;
  }
  await runSqlite("DELETE FROM quotes WHERE id = ?", [id]);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  try {
    jwt.verify(token, ADMIN_TOKEN_SECRET || "");
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}

function createTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendEmail(payload) {
  const transporter = createTransport();
  if (!transporter || !ADMIN_EMAIL) {
    return;
  }
  const subject = `견적 요청: ${payload.eventName}`;
  const text = [
    `행사명: ${payload.eventName}`,
    `행사일: ${payload.eventDate}`,
    `장소: ${payload.eventPlace}`,
    `운영기간: ${payload.eventDuration || "-"}`,
    `장비: ${payload.ledType || "-"}`,
    `규격: ${payload.ledSize || "-"}`,
    `콘텐츠: ${payload.ledContent || "-"}`,
    `전력: ${payload.power || "-"}`,
    `요청사항: ${payload.extra || "-"}`,
    `담당자: ${payload.contactName}`,
    `회사/기관: ${payload.contactCompany || "-"}`,
    `연락처: ${payload.contactPhone}`,
    `이메일: ${payload.contactEmail}`,
    `접수시간: ${payload.createdAt}`,
  ].join("\n");

  await transporter.sendMail({
    from: SMTP_FROM,
    to: ADMIN_EMAIL,
    subject,
    text,
  });
}

function makeSensSignature({ method, url, timestamp }) {
  const message = `${method} ${url}\n${timestamp}\n${SENS_ACCESS_KEY}`;
  return createHmac("sha256", SENS_SECRET_KEY || "")
    .update(message)
    .digest("base64");
}

async function sendSms(payload) {
  if (!SENS_SERVICE_ID || !SENS_ACCESS_KEY || !SENS_SECRET_KEY || !SENS_FROM_NUMBER || !ADMIN_PHONE) {
    return;
  }

  const method = "POST";
  const urlPath = `/sms/v2/services/${SENS_SERVICE_ID}/messages`;
  const timestamp = Date.now().toString();
  const signature = makeSensSignature({ method, url: urlPath, timestamp });

  const body = {
    type: "SMS",
    from: SENS_FROM_NUMBER,
    content: `견적 요청: ${payload.eventName} / ${payload.eventDate} / ${payload.contactName}`,
    messages: [{ to: ADMIN_PHONE }],
  };

  const response = await fetch(`https://sens.apigw.ntruss.com${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-ncp-apigw-timestamp": timestamp,
      "x-ncp-iam-access-key": SENS_ACCESS_KEY,
      "x-ncp-apigw-signature-v2": signature,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SMS send failed: ${response.status} ${text}`);
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.redirect(302, "https://mag599746-bot.github.io/oneoffrental2/admin.html");
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    res.status(401).json({ message: "Invalid password" });
    return;
  }
  const token = jwt.sign({ role: "admin" }, ADMIN_TOKEN_SECRET || "", { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/admin/quotes", authMiddleware, async (req, res) => {
  try {
    const rows = await getQuotes();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to load quotes" });
  }
});

app.delete("/api/admin/quotes/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteQuote(id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: "Failed to delete" });
  }
});

app.post("/api/quotes", async (req, res) => {
  const payload = req.body || {};
  const requiredFields = ["eventName", "eventDate", "eventPlace", "contactName", "contactPhone", "contactEmail"];
  for (const field of requiredFields) {
    if (!payload[field]) {
      res.status(400).json({ message: `Missing ${field}` });
      return;
    }
  }

  const createdAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const values = [
    payload.eventName,
    payload.eventDate,
    payload.eventPlace,
    payload.eventDuration || "",
    payload.ledType || "",
    payload.ledSize || "",
    payload.ledContent || "",
    payload.power || "",
    payload.extra || "",
    payload.contactName,
    payload.contactCompany || "",
    payload.contactPhone,
    payload.contactEmail,
    createdAt,
  ];

  try {
    await insertQuote(values);

    await Promise.all([
      sendEmail({ ...payload, createdAt }),
      sendSms({ ...payload, createdAt }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to save quote" });
  }
});

async function start() {
  try {
    if (dbType === "postgres") {
      await initPostgres();
    } else {
      initSqlite();
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

start();
