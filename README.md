# CampusPulse — AI Image Triage

CampusPulse lets students upload a campus-maintenance photo and report. The server can send the image + description to OpenAI's Responses API and return structured triage data.

## AI features

Each new report can be analyzed for:

- **Category:** electrical, plumbing, structural, cleaning, furniture, other
- **Severity:** 1 = critical, 2 = medium, 3 = minor
- **Priority:** 1 = highest response priority, 2 = medium, 3 = low
- **Hygiene score:** 1 = highest hygiene risk, 3 = lowest
- **Safety score:** 1 = highest safety risk, 3 = lowest
- **Cleanliness score:** 1 = worst cleanliness, 3 = best
- **Duplicate grouping:** compares the new report with recent reports from the same college and links clear duplicates into the same `duplicateGroupId`
- **AI summary and confidence**

The college dashboard displays the AI category, scores, priority, and duplicate information.

## Add the API key from the dashboard

1. Start the project with `npm install` and `npm start`.
2. Open the college authority login.
3. Open the college dashboard.
4. Click **Add AI API key**.
5. Paste an OpenAI API key beginning with `sk-` and save it.
6. New student reports will use that key for image analysis.

The pasted college key is held **in server memory only** and is not written into `data/db.json`. It is lost when the server restarts, so it must be pasted again. For a production deployment, prefer a server-side environment variable such as `OPENAI_API_KEY` rather than allowing browser administrators to paste keys.

### Server-side key option

Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm start
```

Command Prompt:

```cmd
set OPENAI_API_KEY=sk-...
npm start
```

You can optionally choose another vision-capable model with `OPENAI_MODEL`.

## Important

Without an API key, CampusPulse still works. It uses a small keyword-based fallback so the demo does not break. The fallback does **not** truly understand the image; real image judgement, category detection and duplicate reasoning require an OpenAI API key.

OpenAI image analysis is performed server-side so the API key is not placed in the student browser code.
