import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { ActionKind, Card, GameState, LegalAction, NewGameRequest, PlayerState } from "../shared/types";

const defaultSettings: Required<NewGameRequest> = {
  playerCount: 6,
  startingStack: 2000,
  smallBlind: 10,
  bigBlind: 20,
  aiDifficulty: "balanced"
};

export default function App() {
  const [game, setGame] = useState<GameState | undefined>();
  const [settings, setSettings] = useState(defaultSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [actionAmount, setActionAmount] = useState(20);

  const activePlayer = game?.players.find((player) => player.id === game.activeSeatId);
  const hero = game?.players.find((player) => player.isHuman);
  const aggressiveAction = game?.legalActions.find((action) => action.kind === "bet" || action.kind === "raise");
  const amountToCall = game?.legalActions[0]?.amountToCall ?? 0;

  useEffect(() => {
    void createGame(settings);
    // Initial load only; subsequent setting changes are applied by the New Game form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (aggressiveAction?.minAmount !== undefined) {
      setActionAmount(aggressiveAction.minAmount);
    }
  }, [aggressiveAction?.minAmount, game?.id, game?.handNumber, game?.street]);

  async function createGame(request: NewGameRequest) {
    await apiRequest("/api/games", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async function submitAction(kind: ActionKind, amount?: number) {
    if (!game) {
      return;
    }

    await apiRequest(`/api/games/${game.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ kind, amount })
    });
  }

  async function nextHand() {
    if (!game) {
      return;
    }

    await apiRequest(`/api/games/${game.id}/next-hand`, { method: "POST" });
  }

  async function apiRequest(path: string, init: RequestInit) {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...init
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Request failed.");
      }
      setGame(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unexpected error.");
    } finally {
      setPending(false);
    }
  }

  function updateSetting<Key extends keyof Required<NewGameRequest>>(key: Key, value: Required<NewGameRequest>[Key]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function submitNewGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createGame(settings);
  }

  const winners = useMemo(() => {
    if (!game?.winners.length) {
      return "No winner yet";
    }
    return game.winners.map((winner) => `${winner.playerName} +${winner.amount} (${winner.hand.label})`).join(" | ");
  }, [game?.winners]);

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Texas Hold'em full-stack simulator</p>
          <h1>Poker Sim</h1>
          <p>
            Play a complete no-limit Hold'em hand against automated opponents with blinds, betting rounds, all-ins,
            side pots, board runouts, and showdown hand evaluation.
          </p>
        </div>
        <form className="settings-card" onSubmit={submitNewGame}>
          <label>
            Players
            <input
              type="number"
              min="2"
              max="9"
              value={settings.playerCount}
              onChange={(event) => updateSetting("playerCount", Number(event.target.value))}
            />
          </label>
          <label>
            Starting stack
            <input
              type="number"
              min="200"
              step="100"
              value={settings.startingStack}
              onChange={(event) => updateSetting("startingStack", Number(event.target.value))}
            />
          </label>
          <label>
            Small blind
            <input
              type="number"
              min="1"
              value={settings.smallBlind}
              onChange={(event) => updateSetting("smallBlind", Number(event.target.value))}
            />
          </label>
          <label>
            Big blind
            <input
              type="number"
              min="2"
              value={settings.bigBlind}
              onChange={(event) => updateSetting("bigBlind", Number(event.target.value))}
            />
          </label>
          <label>
            AI style
            <select
              value={settings.aiDifficulty}
              onChange={(event) => updateSetting("aiDifficulty", event.target.value as Required<NewGameRequest>["aiDifficulty"])}
            >
              <option value="balanced">Balanced</option>
              <option value="loose">Loose aggressive</option>
              <option value="tight">Tight</option>
            </select>
          </label>
          <button type="submit" disabled={pending}>
            New table
          </button>
        </form>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="game-layout">
        <div className="table-card">
          <div className="table-felt">
            <div className="table-center">
              <p className="street">{formatStreet(game?.street)}</p>
              <div className="community">
                {Array.from({ length: 5 }, (_, index) => (
                  <PlayingCard key={index} card={game?.communityCards[index]} placeholder="Board" />
                ))}
              </div>
              <div className="pot">
                <span>Total pot</span>
                <strong>{game?.totalPot ?? 0}</strong>
              </div>
              <div className="pots">
                {game?.pots.map((pot, index) => (
                  <span key={`${pot.amount}-${index}`}>{index === 0 ? "Main" : `Side ${index}`}: {pot.amount}</span>
                ))}
              </div>
            </div>

            {game?.players.map((player) => (
              <Seat key={player.id} player={player} totalSeats={game.players.length} isActive={player.id === game.activeSeatId} />
            ))}
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel">
            <p className="eyebrow">Hand {game?.handNumber ?? "-"}</p>
            <h2>{activePlayer ? `${activePlayer.name}'s turn` : "Hand complete"}</h2>
            <p className="winner-line">{winners}</p>
            <div className="hero-cards">
              <span>Your hand</span>
              <div>
                {hero?.holeCards.map((card, index) => (
                  <PlayingCard key={`${card.rank}-${card.suit}-${index}`} card={card} compact />
                ))}
              </div>
            </div>
          </section>

          <section className="panel action-panel">
            <h2>Actions</h2>
            {game?.street === "complete" ? (
              <button className="primary" onClick={() => void nextHand()} disabled={pending}>
                Deal next hand
              </button>
            ) : game?.legalActions.length ? (
              <>
                <p className="hint">{amountToCall > 0 ? `You are facing ${amountToCall} to call.` : "No bet is currently facing you."}</p>
                <div className="button-grid">
                  {game.legalActions.map((action) => (
                    <ActionButton
                      key={action.kind}
                      action={action}
                      amount={action.kind === "bet" || action.kind === "raise" ? actionAmount : undefined}
                      disabled={pending}
                      onAction={submitAction}
                    />
                  ))}
                </div>
                {aggressiveAction ? (
                  <label className="range-control">
                    {aggressiveAction.kind === "bet" ? "Bet amount" : "Raise to"}
                    <input
                      type="range"
                      min={aggressiveAction.minAmount}
                      max={aggressiveAction.maxAmount}
                      value={actionAmount}
                      onChange={(event) => setActionAmount(Number(event.target.value))}
                    />
                    <output>{actionAmount}</output>
                  </label>
                ) : null}
              </>
            ) : (
              <p className="hint">AI players are acting automatically.</p>
            )}
          </section>

          <section className="panel features">
            <h2>Implemented Hold'em features</h2>
            <ul>
              <li>Button rotation, small blind, and big blind rules</li>
              <li>Preflop, flop, turn, river, and showdown streets</li>
              <li>No-limit betting with checks, calls, folds, bets, raises, and all-ins</li>
              <li>Side-pot construction and split-pot tie handling</li>
              <li>Seven-card hand evaluation including ace-low straights</li>
              <li>Configurable AI opponents with loose, balanced, and tight styles</li>
            </ul>
          </section>
        </aside>
      </section>

      <section className="history panel">
        <h2>Hand history</h2>
        <ol>
          {game?.actionLog
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
        </ol>
      </section>
    </main>
  );
}

function Seat({ player, totalSeats, isActive }: { player: PlayerState; totalSeats: number; isActive: boolean }) {
  const angle = (player.seat / totalSeats) * Math.PI * 2 - Math.PI / 2;
  const radiusX = 43;
  const radiusY = 39;
  const style = {
    left: `${50 + Math.cos(angle) * radiusX}%`,
    top: `${50 + Math.sin(angle) * radiusY}%`
  } satisfies CSSProperties;

  return (
    <article className={`seat ${isActive ? "active" : ""} ${player.isHuman ? "human" : ""}`} style={style}>
      <div className="seat-header">
        <strong>{player.name}</strong>
        {player.isDealer ? <span className="dealer">D</span> : null}
      </div>
      <div className="mini-cards">
        {player.holeCards.map((card, index) => (
          <PlayingCard key={`${player.id}-${index}`} card={card} compact />
        ))}
      </div>
      <div className="seat-stats">
        <span>Stack {player.stack}</span>
        <span>Bet {player.bet}</span>
      </div>
      <p className={`status status-${player.status}`}>{player.lastAction ?? player.status}</p>
    </article>
  );
}

function ActionButton({
  action,
  amount,
  disabled,
  onAction
}: {
  action: LegalAction;
  amount?: number;
  disabled: boolean;
  onAction: (kind: ActionKind, amount?: number) => Promise<void>;
}) {
  return (
    <button
      className={action.kind === "fold" ? "danger" : action.kind === "all-in" ? "warning" : ""}
      type="button"
      disabled={disabled}
      onClick={() => void onAction(action.kind, amount)}
    >
      {action.kind === "bet" ? `Bet ${amount}` : action.kind === "raise" ? `Raise to ${amount}` : action.label}
    </button>
  );
}

function PlayingCard({ card, placeholder, compact = false }: { card?: Card; placeholder?: string; compact?: boolean }) {
  if (!card) {
    return <div className={`playing-card empty ${compact ? "compact" : ""}`}>{placeholder ?? ""}</div>;
  }

  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div className={`playing-card ${red ? "red" : "black"} ${compact ? "compact" : ""}`}>
      <span>{card.rank}</span>
      <small>{card.suit[0].toUpperCase()}</small>
    </div>
  );
}

function formatStreet(street?: GameState["street"]): string {
  if (!street) {
    return "Loading";
  }
  return street === "complete" ? "Complete" : street[0].toUpperCase() + street.slice(1);
}
