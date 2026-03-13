import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import messageRoutes from "./routes/messages.js";

const PORT = parseInt(process.env.ANT_CHAT_PORT || "6464", 10);
const HOST = process.env.ANT_HOST || "0.0.0.0";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

app.set("io", io);
app.use(cors());
app.use(express.json());

app.use(messageRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chat-sidecar" });
});

io.on("connection", (socket) => {
  console.log("[chat-server] Client connected");
  socket.on("disconnect", () => {
    console.log("[chat-server] Client disconnected");
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`
  ANT Chat Sidecar running at http://${HOST}:${PORT}
`);
});
