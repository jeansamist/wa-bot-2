import dotenv from "dotenv";
import express, { Express, Request, Response } from "express";
import qrcode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
dotenv.config();
const client = new Client({
  puppeteer: {
    headless: true,
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

const app: Express = express();
app.use(express.json());
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server2");
});

app.post("/send", (req: Request, res: Response) => {
  const { number, message, key } = req.body;
  if (key !== process.env.KEY) {
    res.status(401).send({ status: false, message: "Unauthorized" });
    return;
  }
  client.sendMessage("237" + number + "@c.us", message);
  res.send({
    status: true,
    data: { contact: "237" + number + "@c.us", message: message },
    message: "Message sent",
  });
});
app.listen(port, "0.0.0.0", () => {
  console.log(`[server]: Server is running at http://0.0.0.0:${port}`);
});
