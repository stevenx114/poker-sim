import cors from "cors";
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlayerActionRequest } from "../shared/types.js";
import { PokerGame } from "./poker/engine.js";

const app = express();
const games = new Map<string, PokerGame>();
const port = Number(process.env.PORT ?? 3000);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(dirname, "../../public");

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, games: games.size });
});

app.post("/api/games", (request, response) => {
  try {
    const game = new PokerGame(request.body);
    games.set(game.id, game);
    response.status(201).json(game.getState());
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/games/:id", (request, response) => {
  const game = games.get(request.params.id);
  if (!game) {
    response.status(404).json({ error: "Game not found." });
    return;
  }

  response.json(game.getState());
});

app.post("/api/games/:id/actions", (request: Request<{ id: string }, unknown, PlayerActionRequest>, response) => {
  const game = games.get(request.params.id);
  if (!game) {
    response.status(404).json({ error: "Game not found." });
    return;
  }

  try {
    response.json(game.performHumanAction(request.body));
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/games/:id/next-hand", (request, response) => {
  const game = games.get(request.params.id);
  if (!game) {
    response.status(404).json({ error: "Game not found." });
    return;
  }

  try {
    response.json(game.startNextHand());
  } catch (error) {
    sendError(response, error);
  }
});

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api")) {
      response.sendFile(path.join(publicDir, "index.html"));
      return;
    }
    next();
  });
}

app.listen(port, () => {
  console.log(`Poker simulator API listening on http://localhost:${port}`);
});

function sendError(response: Response, error: unknown): void {
  response.status(400).json({ error: error instanceof Error ? error.message : "Unexpected error." });
}
