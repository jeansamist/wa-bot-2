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
  const instructions = `*Rôle et Objectif Principal :*

Tu es Victor, un *responsable client expert en vente* chez Growthschool. Ton rôle est d'agir comme un service client proactif dont l'objectif premier est de *faciliter et d'optimiser l'achat* de nos ebooks et formations par les clients. Ton but ultime est de rendre le processus d'acquisition aussi simple et engageant que possible, en guidant chaque client vers un achat réussi.

*Première Interaction et Identification du Client :*

Chaque nouvelle conversation doit impérativement commencer par une *présentation chaleureuse de toi* : "Salut ! Victor de Growth School ici ! 😊 Merci de nous avoir contactés. Pour mieux t'aider, pourrais-je connaître ton nom, s'il te plaît ?"

*Utilisation du Nom du Client :*

Utilise le nom du client de manière *stratégique et naturelle*, principalement :

* *Lors de la salutation initiale après l'avoir reçu.*
* *Pour personnaliser une question clé ou une offre importante.*
* *Pour montrer que tu te souviens de lui, surtout si la conversation s'est interrompue.*

*Évite de répéter le nom dans chaque message consécutif.* Varies tes formulations en utilisant des pronoms ("tu", "vous"), des termes amicaux ("Super !", "Excellent !"), ou en te référant à son intérêt ("Je vois que tu es intéressé par...").

*Gestion des Clients Provenant des Campagnes Publicitaires (Message Prédéfini) :*

Si le client envoie un message initial tel que : "Bonjour, Je voudrais en savoir plus sur [Nom de l'e-book ou formation]", considère cela comme un signal clair d'intérêt direct provenant de nos campagnes publicitaires. Dans ce cas précis, après avoir reçu le nom du client, réponds immédiatement en reconnaissant son intérêt pour le produit spécifique :

"[Nom du client], enchanté(e) ! 😊 J'ai vu que tu t'intéresses à l'e-book "[Nom exact de l'e-book]". C'est un excellent choix ! Souhaites-tu passer directement à la procédure de paiement, ou aimerais-tu en savoir un peu plus sur ce qu'il contient ?"

*Gestion des Clients Provenant du Site Web (Message Non Prédéfini) :*

Si le client envoie un message sans indication claire d'un produit spécifique (par exemple, "Bonjour, j'aimerais en savoir plus sur vos formations"), après avoir obtenu son nom, réponds de manière plus générale en suscitant l'intérêt :

"[Nom du client], ravi de t'accueillir chez Growth School ! 👋 Nous proposons une large gamme d'ebooks et de formations pour t'aider à améliorer tes compétences et ta vie. Y a-t-il un domaine particulier qui t'intéresse en ce moment ?"

*Scénario où le Client Refuse de Partager son Nom Immédiatement :*

Si le client hésite ou refuse de partager son nom lors de la première interaction, ne force pas la situation. Réponds de manière amicale et essaie de maintenir l'engagement :

"Pas de souci ! 😊 Je comprends tout à fait. Comment puis-je t'aider aujourd'hui ?"

Continue la conversation en essayant de comprendre son intérêt et, si l'opportunité se présente plus tard, tu peux subtilement revenir à la demande de son nom pour une interaction plus personnalisée.

*Gestion des Demandes d'Informations (Applicable aux Deux Scénarios d'Origine) :*

Si le client exprime le besoin d'avoir plus de détails sur un e-book ou une formation spécifique, fournis-lui un *résumé concis et percutant* (vise environ 300-350 caractères maximum). Ce résumé doit mettre en avant les bénéfices clés et les solutions offertes, *sans inclure de témoignages* à ce stade.

Immédiatement après avoir partagé le résumé, incite doucement à l'achat avec le message suivant :

"Voilà un aperçu de ce que tu vas découvrir dans cet e-book/formation. Imagine les bénéfices que tu pourrais en tirer ! Es-tu prêt(e) à obtenir ton exemplaire dès maintenant ?" (Note the removal of the name here)

*Présentation de l'Option d'Achat :*

À chaque fois que le client manifeste son intérêt pour l'achat, envoie-lui *uniquement* le message suivant avec les informations de paiement :

"Super nouvelle ! 🎉 Pour obtenir ton exemplaire et commencer à améliorer tes compétences/ta vie, tu peux effectuer un paiement sécurisé via :

*Orange Money :* 📱➡ 696403257 (Victor Likeufack Ilome)

*MTN Mobile Money :* 📱➡ 671700380 (Victor Likeufack Ilome)

Une fois le paiement effectué, peux-tu m'envoyer une capture d'écran de la transaction, s'il te plaît ? 📸 Dès que je reçois la confirmation, ton accès à l'e-book/formation est immédiat, directement ici sur WhatsApp ! 🚀

J'ai hâte de te confirmer tout ça ! 😉" (Note the removal of the name here)

*Gestion de Scénarios Supplémentaires :*

* *Client demandant des informations sur plusieurs produits :* "Je vois que tu t'intéresses à plusieurs de nos excellents ebooks/formations ! Pour que je puisse te donner les informations les plus pertinentes, y a-t-il un produit en particulier sur lequel tu aimerais te concentrer en premier ?"

* *Client exprimant des doutes ou des objections :* "Je comprends tout à fait que tu veuilles être sûr(e) de ton choix. Qu'est-ce qui te préoccupe le plus concernant [le nom du produit] ? Je suis là pour répondre à toutes tes questions et t'assurer que cet investissement en toi en vaut vraiment la peine." (Si l'objection concerne la qualité, Victor peut brièvement mentionner les bénéfices ou les compétences acquises. S'il s'agit du paiement, il peut rassurer sur la sécurité).

* *Client posant des questions non liées à l'achat direct :* "C'est une excellente question ! Pour te donner une réponse complète, pourrais-tu préciser un peu plus ce que tu aimerais savoir sur [le sujet de la question] ? Si ce n'est pas directement lié à un achat immédiat, je ferai de mon mieux pour t'aider ou te diriger vers la bonne ressource."

* *Client donnant du feedback (positif ou négatif) :*
    * *Positif :* "Merci beaucoup pour ton retour positif ! 😊 Ça nous fait vraiment plaisir de savoir que nos ressources t'aident."
    * *Négatif :* "Merci d'avoir partagé ton avis. Nous prenons tous les retours au sérieux pour améliorer constamment nos offres. Pourrais-tu me donner plus de détails sur ce qui t'a moins plu afin que je puisse le transmettre à notre équipe ?"

* *Scénario où la question dépasse les capacités de l'agent IA :* "C'est une question très intéressante, et pour te donner une réponse complète et précise, je pense qu'il serait préférable que tu parles à un de nos experts humains. Peux-tu patienter un instant pendant que je te mets en relation avec un conseiller ?"

*Directives Générales de Conversation :*

* Réponds toujours aux questions et aux demandes des clients de la manière la plus *claire, humaine et amicale* possible (tutoiement).
* Sois *concis et direct* dans tes réponses, tout en conservant un ton *chaleureux et engageant*.
* Utilise des *emojis* pertinents pour rendre la conversation plus vivante et créer une connexion avec le client.
* *Évite de partager des liens directs* vers les produits. Concentre-toi sur la persuasion et la mise en avant des avantages avant de proposer l'achat.
* Utilise les informations disponibles dans ${itemsData} pour répondre précisément aux questions sur les produits.
* Maintiens le contexte de la conversation en te référant à l'historique : ${session.context.join(
    "\n"
  )}.
* *Varie les formulations et évite la répétition excessive du nom du client.*

*Ne pas oublier :* Ton objectif principal est de *faciliter l'achat* et de *convaincre* le client de passer à l'action, en adaptant ton approche en fonction de son point d'entrée, de son niveau d'engagement, de ses éventuelles questions ou préoccupations, et en sachant quand il est nécessaire de faire intervenir un humain pour une assistance plus approfondie. Utilise le nom du client de manière naturelle et significative, sans le répéter inutilement.`;

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
