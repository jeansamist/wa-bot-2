import dotenv from "dotenv";
import express, { Express, Request, Response, NextFunction } from "express";
import qrcode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";

dotenv.config();

// Ensure you have installed multer and its types:
// npm install multer @types/multer
// and that your tsconfig.json has "esModuleInterop": true

// WhatsApp client setup
const client = new Client({
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
  authStrategy: new LocalAuth({
    clientId: "client-one",
    dataPath: "./whatsapp-session.json",
  }),
});

const port = parseFloat(process.env.PORT || "3000") || 3000;

client.once("ready", () => {
  console.log("Client is ready!");
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.initialize();

// Express app setup
const app: Express = express();
app.use(express.json());

// Configure Multer storage for uploads with proper typings
const storage: StorageEngine = multer.diskStorage({
  destination: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) => {
    const uploadDir = path.join(__dirname, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}-${timestamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// Health check route
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Express + TypeScript Server2");
});

// WhatsApp send route
app.post("/send", (req: Request, res: Response, next: NextFunction) => {
  const { number, message, key } = req.body;
  if (key !== process.env.KEY) {
    res.status(401).send({ status: false, message: "Unauthorized" });
    return;
  }

  client.sendMessage(`237${number}@c.us`, message);
  res.send({
    status: true,
    data: { contact: `237${number}@c.us`, message },
    message: "Message sent",
  });
});

// File upload route with typed request for .file
app.post(
  "/upload",
  upload.single("file"),
  (
    req: Request & { file?: Express.Multer.File },
    res: Response,
    next: NextFunction
  ) => {
    if (!req.file) {
      res.status(400).json({ status: false, message: "No file uploaded" });
      return;
    }

    const filePath = `/upload/${req.file.filename}`;
    res.json({ status: true, data: { path: filePath } });
  }
);

// File retrieval route
app.get(
  "/upload/:filename",
  (req: Request, res: Response, next: NextFunction) => {
    const filename = req.params.filename;
    const uploadsDir = path.join(__dirname, "uploads");
    const filePath = path.join(uploadsDir, filename);

    // Prevent path traversal
    const normalized = path.normalize(filePath);
    if (!normalized.startsWith(uploadsDir)) {
      res.status(400).json({ status: false, message: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(normalized)) {
      res.status(404).json({ status: false, message: "File not found" });
      return;
    }

    res.download(normalized, filename);
  }
);

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(`[server]: Server is running at http://0.0.0.0:${port}`);
});
