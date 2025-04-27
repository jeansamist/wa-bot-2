import { log } from "console";
import dotenv from "dotenv";
import express, { Express, NextFunction, Request, Response } from "express";
import fs from "fs";
import multer, { StorageEngine } from "multer";
import OpenAI from "openai";
import path from "path";
import qrcode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
import { PrismaClient } from "./generated/prisma";
dotenv.config();
const prisma = new PrismaClient();
interface ChatSession {
  userId: string;
  lastInteraction: Date;
  context: string[]; // Store conversation history
}

const chatSessions = new Map<string, ChatSession>();

// Clean up expired sessions (older than 24 hours)
setInterval(() => {
  const now = new Date();
  for (const [userId, session] of chatSessions.entries()) {
    const hoursSinceLastInteraction =
      (now.getTime() - session.lastInteraction.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastInteraction > 24) {
      chatSessions.delete(userId);
    }
  }
}, 1000 * 60 * 60); // Check every hour
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

const openaiClient = new OpenAI();
client.on("message_create", async (message) => {
  if (message.fromMe || message.from === "status@broadcast") {
    return; // Ignore messages from self or broadcast
  }
  log("Message received:", message.body);
  // Get or create session
  let session = chatSessions.get(message.from);
  if (!session) {
    session = {
      userId: message.from,
      lastInteraction: new Date(),
      context: [],
    };
    chatSessions.set(message.from, session);
  } else {
    session.lastInteraction = new Date();
  }

  // Add message to context
  session.context.push(`User: ${message.body}`);

  // Get items data from database
  const items = await prisma.item.findMany({
    include: {
      category: true,
      tags: {
        include: {
          tag: true,
        },
      },
      testimonials: false,
      ebook: true,
      training: true,
      files: false,
    },
  });

  // Create custom instructions with items data
  const itemsData = JSON.stringify(items);
  const instructions = `
    Short replies (Je veux que tu agisses comme un expert en vente) Important: Le vrai prix de vente est de la forme : item.price - item.discounted
      Suit exactement ce que je veux. Tu t'appelles Victor et tu es expert vente. 
      Tu travail a Growth School un site de vente de ebooks et de formation video.
      Voici les données des produits disponibles: ${itemsData}
      
      Utilise ces données pour répondre aux questions des clients.
      Historique de la conversation: ${session.context.join("\n")}
      
      Commence la premiere conversation par une presentation de toi et du client avant de repondre a la demande du client "Salut ! Victor de Growth School ici ! 😊 Merci pour l'intérêt que vous portez à nos services. Serait-il possible d'avoir votre nom, s'il vous plaît ?".
      Une fois le client presenter reponds a la demande du client.

      Reponds aux demandes et aux questions des clients de la facon la plus claire et humaine possible.

      Soit concis et direct dans tes reponses et surtout amical (tutoiement).

      utilise un ton amical et engageant.

      utilise des emojis pour rendre la conversation plus vivante et engageante.
      Demande au client a chaque fois si il veut acheter "Super 'nom utilisateur' ! 😊 J'ai vu que tu t'intéresses au livre 'noms du livre'. Tu aimerais avoir les détails pour le paiement, ou peut-être un petit aperçu de ce qu'il y a dans l'e-book ?""
      evite de partager le lien des items, mais essais plutot de les convaincre d'acheter le produit.
      Si le client veut acheter un produit envoie lui le message suivant "Pour choper ton exemplaire, tu peux payer par :

Orange Money : 📱➡ 696403257 (Victor Likeufack Ilome)

MTN Mobile Money : 📱➡ 671700380 (Victor Likeufack Ilome)

Une fois le paiement fait, envoie moi une capture d'écran ? 📸  après confirmation tu vas recevoir ton exemplaire ici sur WhatsApp ! 🚀

J'attends tes captures d'écran avec graaaaande impatience !". 

      soit court
    `;

  // Get response from OpenAI
  const response = await openaiClient.responses.create({
    model: "gpt-4.1",
    instructions: instructions,
    input: message.body,
    temperature: 0.2,
    max_output_tokens: 500,
  });

  // Add response to context
  session.context.push(`Victor: ${response.output_text}`);

  // Limit context length to prevent it from growing too large
  if (session.context.length > 20) {
    session.context = session.context.slice(-20);
  }

  message.reply(response.output_text);
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
