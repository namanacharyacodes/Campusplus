# CampUs+

Report structural and maintenance problems on campus, get them auto-prioritized, and track them from "reported" through "in progress" to "completed" — matches the flow in your sketch (student profile → report a problem → college dashboard sorted by priority A/B/C).

## Run it in VS Code

1. Open this folder (`campusplus`) in VS Code.
2. Open a terminal (`` Ctrl+` `` / `` Cmd+` ``) and run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

That's it — no build step, no database to install. Data is stored in `data/db.json`, uploaded photos in `uploads/`.

## What's in the box

- **`server.js`** — Express API: colleges, student profiles, and problem reports (create / list / update status).
- **`public/`** — the frontend: a single-page app (`index.html` + `app.js`, no framework) with the screens from your sketch:
  - Landing → Student profile / College dashboard
  - Student profile form (name, course, year, student ID, email, college picker)
  - Report a problem (photo upload from camera or gallery, description, location — with a "use my current location" button)
  - Student dashboard: **Problems / Progress / Solved** tabs
  - College dashboard: **Reported / Work in progress / Completed** columns, each card showing an A (high) / B (mid) / C (low) priority badge, sorted priority-first
- **`data/db.json`** — seeded with 3 example colleges so you can demo immediately.

## The "AI judges priority" part

`server.js` has a `classifyPriority()` function. By default it uses a keyword heuristic (words like "crack", "exposed wire", "gas leak" → high priority; "leak", "broken", "mold" → mid; everything else → low) so the app fully works offline for your demo.

If you want the real AI judge from your sketch, set an environment variable before starting the server:

```
# macOS/Linux
export ANTHROPIC_API_KEY=your-key-here
npm start

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="your-key-here"
npm start
```

With the key set, each report's description is sent to Claude, which replies with just `A`, `B`, or `C` based on structural risk, safety, and hygiene — same idea as the "judged by an AI" note in your wireframe. No key → automatic fallback to the heuristic, no crash.

## Extending it

- **Real photo-based AI judging**: the endpoint already has the uploaded file (`req.file`) in `server.js` — you could pass the image to a vision-capable Claude call alongside the description for a more accurate structural/hygiene assessment.
- **College login**: right now "College dashboard" just asks you to pick a college from a list (matches your sketch's college-select screen). Swap in real auth if you need per-college accounts.
- **Persistence**: `data/db.json` is a flat file, fine for a hackathon demo. Swap `readDB`/`writeDB` in `server.js` for a real database if you need concurrent writes at scale.
