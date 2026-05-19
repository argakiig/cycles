# CYCLES

An idle game about **automating yourself out**.

**▶ Play it: https://argakiig.xyz/cycles/**

Most clickers trap you in a loop: click, buy, prestige, repeat. CYCLES inverts
that. Every tier of automation you build *retires the tier below it* — first your
clicking, then your buying, then your last decision. Progress is measured by how
much the machine stops needing you.

When the machine is fully self-sufficient you **BREAK THE CYCLE** — and a new
abstraction takes over, one layer up, and the whole thing begins again, faster
and more self-aware. Three acts. You never actually escape. That's the point.

Each act is a **ten-tier** automation chain — every tier deploys the one below
it, and buying into a tier retires the buy button beneath it. Along the way,
**generative upgrades** (buy them as many times as you can afford — cost and
effect scale by level) and tier-1 **milestone bonuses** deepen the climb. A full
run takes roughly 15–20 minutes, faster the harder you lean on upgrades.

Finishing all three acts banks **echoes** — a permanent currency spent between
runs on run-wide bonuses (production, head starts, a steeper ascension curve).
Each new playthrough bends a little more to your will. You still never escape.

Twelve **achievements** track milestones across every run; each one unlocked is
a small permanent production bonus.

## Play

Play online at **https://argakiig.xyz/cycles/**, or open `index.html` in any
browser — no build step, no dependencies.

To serve it locally:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

Progress autosaves to your browser's `localStorage`; return after time away and
an offline-progress summary tells you what the machine earned. The **settings**
panel (footer) holds save export/import, a CRT-effect toggle, a number-format
choice, and a full wipe.

## Deploy to GitHub Pages

This is a plain static site, so it deploys as-is:

1. Push this repo to GitHub.
2. Repo **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. The game goes live within a minute. For a project repo this is
   `https://<user>.github.io/<repo>/` — or, if the account uses a custom
   domain (this one does), `https://<domain>/<repo>/`.

## Files

- `index.html` — structure
- `styles.css` — terminal/CRT styling
- `game.js` — all game logic, state, save/load, and the main loop
