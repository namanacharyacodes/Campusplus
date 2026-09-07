/**
 * CampUs+ backend
 * -----------------
 * Plain Express server + a JSON file as the database (data/db.json).
 * No build step, no external DB — designed to run in a hackathon in
 * under a minute: `npm install && npm start`.
 */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- tiny JSON "database" ----------
function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- priority classification ----------
// If ANTHROPIC_API_KEY is set in the environment, we ask Claude to judge
// severity from the description (structural risk, hygiene, safety).
// Otherwise we fall back to a keyword heuristic so the app still works
// fully offline — handy for a hackathon demo with no key on hand.
const HIGH_KEYWORDS = [
  "collapse", "collapsed", "collapsing", "crack", "cracked", "cracking",
  "exposed wire", "electrical", "live wire", "short circuit", "fire",
  "gas leak", "gas smell", "ceiling fall", "falling", "structural",
  "unsafe", "sewage", "flood", "flooding", "asbestos"
];
const MID_KEYWORDS = [
  "leak", "leaking", "broken", "damaged", "damage", "mold", "mould",
  "blocked", "clogged", "pest", "insect", "rodent", "smell", "odor",
  "loose", "stain", "rust", "rusted"
];

function heuristicPriority(description = "") {
  const text = description.toLowerCase();
  if (HIGH_KEYWORDS.some((k) => text.includes(k))) return "A";
  if (MID_KEYWORDS.some((k) => text.includes(k))) return "B";
  return "C";
}

async function classifyPriority(description) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return heuristicPriority(description);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 10,
        system:
          "You triage campus facility-maintenance reports. Judge risk from structural damage, safety hazard, and hygiene. Reply with exactly one character: A (high priority — immediate safety/structural risk), B (mid priority — needs attention soon), or C (low priority — cosmetic/minor). No other text.",
        messages: [{ role: "user", content: description || "No description provided." }]
      })
    });
    const data = await response.json();
    const text = (data?.content?.[0]?.text || "").trim().toUpperCase();
    if (["A", "B", "C"].includes(text)) return text;
    return heuristicPriority(description);
  } catch (err) {
    console.error("AI classification failed, falling back to heuristic:", err.message);
    return heuristicPriority(description);
  }
}

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${nanoid(10)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

// -- colleges --
app.get("/api/colleges", (req, res) => {
  const db = readDB();
  res.json(db.colleges);
});

app.get("/api/colleges/:code", (req, res) => {
  const db = readDB();
  const college = db.colleges.find((c) => c.code === req.params.code);
  if (!college) return res.status(404).json({ error: "College not found" });
  res.json(college);
});

// -- students --
app.post("/api/students", (req, res) => {
  const { name, course, yearOfStudy, studentId, email, collegeCode } = req.body;
  if (!name || !collegeCode) {
    return res.status(400).json({ error: "name and collegeCode are required" });
  }
  const db = readDB();
  const college = db.colleges.find((c) => c.code === collegeCode);
  if (!college) return res.status(400).json({ error: "Unknown college" });

  const student = {
    id: nanoid(10),
    name,
    course: course || "",
    yearOfStudy: yearOfStudy || "",
    studentId: studentId || "",
    email: email || "",
    collegeCode,
    createdAt: new Date().toISOString()
  };
  db.students.push(student);
  writeDB(db);
  res.status(201).json(student);
});

app.get("/api/students/:id", (req, res) => {
  const db = readDB();
  const student = db.students.find((s) => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  res.json(student);
});

// -- problems --
app.post("/api/problems", upload.single("photo"), async (req, res) => {
  const { studentId, collegeCode, description, location } = req.body;
  if (!collegeCode || !description) {
    return res.status(400).json({ error: "collegeCode and description are required" });
  }
  const priority = await classifyPriority(description);

  const db = readDB();
  const problem = {
    id: nanoid(10),
    studentId: studentId || null,
    collegeCode,
    description,
    location: location || "",
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    priority, // "A" | "B" | "C"
    status: "reported", // reported -> in_progress -> completed
    progressPercent: 0,
    progressNote: "",
    approxCompletionDate: null,
    completionDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.problems.push(problem);
  writeDB(db);
  res.status(201).json(problem);
});

app.get("/api/problems", (req, res) => {
  const { collegeCode, studentId, status } = req.query;
  const db = readDB();
  let problems = db.problems;
  if (collegeCode) problems = problems.filter((p) => p.collegeCode === collegeCode);
  if (studentId) problems = problems.filter((p) => p.studentId === studentId);
  if (status) problems = problems.filter((p) => p.status === status);

  const priorityRank = { A: 0, B: 1, C: 2 };
  problems = [...problems].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  res.json(problems);
});

app.patch("/api/problems/:id", (req, res) => {
  const db = readDB();
  const problem = db.problems.find((p) => p.id === req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });

  const { status, progressPercent, progressNote, approxCompletionDate } = req.body;
  if (status) problem.status = status;
  if (progressPercent !== undefined) problem.progressPercent = progressPercent;
  if (progressNote !== undefined) problem.progressNote = progressNote;
  if (approxCompletionDate !== undefined) problem.approxCompletionDate = approxCompletionDate;
  if (status === "completed") {
    problem.completionDate = new Date().toISOString();
    problem.progressPercent = 100;
  }
  problem.updatedAt = new Date().toISOString();
  writeDB(db);
  res.json(problem);
});

app.listen(PORT, () => {
  console.log(`CampUs+ running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY set — priority classification is using the keyword fallback.");
  }
});
