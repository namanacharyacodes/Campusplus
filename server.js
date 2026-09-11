/**
 * CampusPulse backend
 * Express + JSON DB + optional OpenAI vision analysis.
 */
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function readDB() { return JSON.parse(fs.readFileSync(DB_PATH, "utf-8")); }
function writeDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

const sessions = new Map();
const collegeAIKeys = new Map(); // RAM only: API keys are never written to db.json.

// Only the CampUs+ web developer knows this — required to create a new college so
// students/staff can't spin up a fake college identity from the login screen.
const COLLEGE_SETUP_PASSWORD = process.env.COLLEGE_SETUP_PASSWORD || "NEXORA";
const collegeSetupAttempts = new Map(); // RAM only: brute-force throttle per IP.

const CATEGORIES = ["electrical", "plumbing", "structural", "cleaning", "furniture", "other"];
const LEVELS = [1, 2, 3];

// ---------- college staff hierarchy ----------
// Lowest authority first; escalating a problem moves it one step to the right.
const ESCALATION_CHAIN = ["student_rep", "class_advisor", "secretary", "hod"];
const STAFF_ROLES = ESCALATION_CHAIN;
const ROLE_LABEL = { student_rep: "Student Rep", class_advisor: "Class Advisor", secretary: "Secretary", hod: "HOD" };
function autoAssignRole() {
  // Every new report starts with the Student Rep. It only reaches Class Advisor → Secretary → HOD
  // when someone actively sends it up ("Send to higher authority").
  return "student_rep";
}
function nextRoleUp(role) {
  const i = ESCALATION_CHAIN.indexOf(role);
  if (i === -1 || i === ESCALATION_CHAIN.length - 1) return null; // already with the HOD — no one higher
  return ESCALATION_CHAIN[i + 1];
}
function publicStaff(s) { if (!s) return null; const { passwordHash, ...safe } = s; return safe; }

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, key] = stored.split(":");
  const derived = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
function verifySetupPassword(input) {
  const expected = Buffer.from(COLLEGE_SETUP_PASSWORD);
  const provided = Buffer.from(String(input ?? ""));
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
function setupThrottleCheck(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, entry = collegeSetupAttempts.get(ip);
  if (!entry || now - entry.first > windowMs) { collegeSetupAttempts.set(ip, { count: 0, first: now }); return true; }
  return entry.count < 8;
}
function setupThrottleRecordFailure(ip) {
  const entry = collegeSetupAttempts.get(ip); if (entry) entry.count += 1;
}
function issueToken(role, id, collegeCode, extra = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { role, id, collegeCode, createdAt: Date.now(), ...extra });
  return token;
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: "Authentication required" });
  req.user = session;
  next();
}
function requireRole(role) {
  return (req, res, next) => req.user?.role === role ? next() : res.status(403).json({ error: "Access denied" });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${nanoid(10)}${path.extname(file.originalname) || ".jpg"}`)
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

function publicCollege(college) {
  if (!college) return null;
  const { adminPasswordHash, ...safe } = college;
  return safe;
}

function ensureCredentials() {
  const db = readDB(); let changed = false;
  db.students = db.students || []; db.colleges = db.colleges || []; db.problems = db.problems || [];
  if (!db.staff) { db.staff = []; changed = true; } // was missing from disk after the hierarchy feature was added — this persists it.
  for (const staffMember of db.staff) {
    if (staffMember.mustChangePassword === undefined) { staffMember.mustChangePassword = false; changed = true; }
  }
  for (const college of db.colleges) {
    if (!college.adminUsername || !college.adminPasswordHash) {
      college.adminUsername = `admin_${college.code.toLowerCase()}`;
      const defaultPasswords = { GEC01: "GEC@2026", RVU02: "RVU@2026", SPI03: "SPI@2026", SJEC04: "SJEC@2026" };
      college.adminPasswordHash = hashPassword(defaultPasswords[college.code] || `College@${college.code}2026`);
      changed = true;
    }
  }
  for (const p of db.problems) {
    if (!p.category) p.category = "other";
    if (!p.severity) p.severity = p.priority === "A" ? 1 : p.priority === "B" ? 2 : 3;
    if (!p.ai || typeof p.ai !== "object") p.ai = { analyzed: false };
    if (!p.duplicateGroupId) p.duplicateGroupId = p.id;
    if (!p.assignedRole) p.assignedRole = autoAssignRole(p.severity);
  }
  if (changed) writeDB(db);
}
ensureCredentials();

// ---------- AI ----------
const HIGH_KEYWORDS = ["collapse", "collapsed", "collapsing", "exposed wire", "live wire", "short circuit", "fire", "gas leak", "ceiling fall", "falling", "structural", "unsafe", "sewage", "flood", "asbestos"];
const MID_KEYWORDS = ["crack", "cracked", "leak", "leaking", "broken", "damaged", "mold", "mould", "blocked", "clogged", "pest", "insect", "rodent", "smell", "odor", "loose", "stain", "rust", "rusted"];
function heuristicAnalysis(description = "") {
  const text = description.toLowerCase();
  const severity = HIGH_KEYWORDS.some(k => text.includes(k)) ? 1 : MID_KEYWORDS.some(k => text.includes(k)) ? 2 : 3;
  const category = /wire|switch|socket|electric|fan|light|circuit|power/i.test(text) ? "electrical"
    : /pipe|tap|water|leak|toilet|drain|sewage/i.test(text) ? "plumbing"
    : /wall|beam|column|ceiling|roof|floor|crack|structural/i.test(text) ? "structural"
    : /clean|garbage|waste|dirty|dust|mold|mould|toilet|hygiene/i.test(text) ? "cleaning"
    : /chair|desk|table|bench|door|furniture/i.test(text) ? "furniture" : "other";
  return {
    severity, priority: severity, category,
    hygieneScore: category === "cleaning" ? 1 : 3,
    safetyScore: severity === 1 ? 1 : severity === 2 ? 2 : 3,
    cleanlinessScore: category === "cleaning" ? 1 : 3,
    summary: description || "Campus maintenance issue",
    confidence: 0.45,
    duplicateCandidateId: null,
    duplicateReason: "AI unavailable; heuristic classification"
  };
}

function dataUrlForImage(file) {
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file.path).toString("base64")}`;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

async function openAIAnalyze({ apiKey, imageDataUrl, description, location, candidates }) {
  const candidateText = candidates.length ? candidates.map(p => ({
    id: p.id, category: p.category, severity: p.severity, location: p.location,
    description: p.description, summary: p.ai?.summary || p.description
  })) : [];

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      category: { type: "string", enum: CATEGORIES },
      severity: { type: "integer", enum: [1, 2, 3] },
      priority: { type: "integer", enum: [1, 2, 3] },
      hygieneScore: { type: "integer", enum: [1, 2, 3] },
      safetyScore: { type: "integer", enum: [1, 2, 3] },
      cleanlinessScore: { type: "integer", enum: [1, 2, 3] },
      summary: { type: "string" },
      confidence: { type: "number" },
      duplicateCandidateId: { type: ["string", "null"] },
      duplicateReason: { type: "string" }
    },
    required: ["category", "severity", "priority", "hygieneScore", "safetyScore", "cleanlinessScore", "summary", "confidence", "duplicateCandidateId", "duplicateReason"]
  };

  const prompt = `Analyze this campus maintenance report and its photo.

Rules:
- Category must be exactly one of: electrical, plumbing, structural, cleaning, furniture, other.
- Scores use 1=worst/most urgent, 2=medium, 3=minor/best.
- severity is physical seriousness; priority is the recommended response urgency.
- hygieneScore evaluates hygiene risk; safetyScore evaluates immediate safety risk; cleanlinessScore evaluates visible cleanliness.
- Priority 1 should be used for serious structural failure, exposed/live electrical danger, fire/gas/sewage/flood hazards, or similarly urgent hazards.
- Do not claim certainty about hidden defects. Judge only what the image and report support.
- For duplicates, choose duplicateCandidateId only when this report clearly describes the same underlying campus problem as one candidate. Otherwise null.
- A duplicate means the same issue/location, not merely the same category.

Student description: ${description || "none"}
Location: ${location || "not supplied"}
Existing candidate reports from this college:\n${JSON.stringify(candidateText)}\n`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [{ role: "user", content: [
        { type: "input_text", text: prompt },
        ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl, detail: "high" }] : [])
      ] }],
      text: { format: { type: "json_schema", name: "campus_issue_analysis", strict: true, schema } }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(data);
  const parsed = JSON.parse(text);
  if (!CATEGORIES.includes(parsed.category) || !LEVELS.includes(parsed.severity) || !LEVELS.includes(parsed.priority)) throw new Error("AI returned invalid classification");
  return parsed;
}

async function analyzeProblem({ collegeCode, description, location, file }) {
  const apiKey = collegeAIKeys.get(collegeCode) || process.env.OPENAI_API_KEY;
  if (!apiKey) return { ...heuristicAnalysis(description), aiEnabled: false, aiError: "No API key configured" };
  const db = readDB();
  // Limit duplicate candidates to recent reports in the same college/category area to control cost.
  const candidates = db.problems.filter(p => p.collegeCode === collegeCode && p.status !== "completed").slice(-40).reverse();
  try {
    const result = await openAIAnalyze({ apiKey, imageDataUrl: file ? dataUrlForImage(file) : null, description, location, candidates });
    return { ...result, aiEnabled: true, aiError: null };
  } catch (err) {
    console.error("OpenAI analysis failed:", err.message);
    return { ...heuristicAnalysis(description), aiEnabled: false, aiError: err.message };
  }
}

// ---------- colleges ----------
app.get("/api/colleges", (req, res) => res.json(readDB().colleges.map(publicCollege)));
app.get("/api/colleges/:code", (req, res) => {
  const c = readDB().colleges.find(x => x.code === req.params.code);
  if (!c) return res.status(404).json({ error: "College not found" });
  res.json(publicCollege(c));
});

app.post("/api/colleges", (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  if (!setupThrottleCheck(ip)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const { developerPassword, name, code, since, details, adminUsername, adminPassword } = req.body || {};
  if (!verifySetupPassword(developerPassword)) {
    setupThrottleRecordFailure(ip);
    return res.status(403).json({ error: "Invalid developer authorization password. New colleges can only be created by an authorized web developer." });
  }
  if (!name || !code || !adminPassword) return res.status(400).json({ error: "College name, college code and admin password are required" });
  if (String(adminPassword).length < 6) return res.status(400).json({ error: "Admin password must be at least 6 characters" });
  const normalizedCode = String(code).trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{3,12}$/.test(normalizedCode)) return res.status(400).json({ error: "College code must be 3-12 letters/numbers, e.g. SJEC04" });
  const db = readDB();
  if (db.colleges.some(c => c.code === normalizedCode)) return res.status(409).json({ error: "A college with this code already exists" });
  const username = (adminUsername && String(adminUsername).trim()) || `admin_${normalizedCode.toLowerCase()}`;
  if (db.colleges.some(c => c.adminUsername === username)) return res.status(409).json({ error: "That admin username is already taken" });
  const college = { code: normalizedCode, name: String(name).trim(), since: since ? String(since).trim() : "", details: details ? String(details).trim() : "", adminUsername: username, adminPasswordHash: hashPassword(adminPassword) };
  db.colleges.push(college); writeDB(db);
  res.status(201).json({ college: publicCollege(college), adminUsername: username });
});

// ---------- auth ----------
app.post("/api/auth/student/signup", (req, res) => {
  const { name, course, yearOfStudy, studentId, email, collegeCode, password } = req.body;
  if (!name || !email || !collegeCode || !password) return res.status(400).json({ error: "name, email, collegeCode and password are required" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const db = readDB(); const college = db.colleges.find(c => c.code === collegeCode);
  if (!college) return res.status(400).json({ error: "Unknown college" });
  if (db.students.some(s => s.email?.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: "A student account with this email already exists" });
  const student = { id: nanoid(10), name, course: course || "", yearOfStudy: yearOfStudy || "", studentId: studentId || "", email, collegeCode, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  db.students.push(student); writeDB(db);
  res.status(201).json({ token: issueToken("student", student.id, collegeCode), student: { ...student, passwordHash: undefined } });
});
app.post("/api/auth/student/login", (req, res) => {
  const { email, password } = req.body; const db = readDB();
  const student = db.students.find(s => s.email?.toLowerCase() === String(email || "").toLowerCase());
  if (!student || !verifyPassword(password, student.passwordHash)) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: issueToken("student", student.id, student.collegeCode), student: { ...student, passwordHash: undefined } });
});
app.post("/api/auth/college/login", (req, res) => {
  const { username, password } = req.body; const db = readDB();
  const college = db.colleges.find(c => c.adminUsername === username);
  if (!college || !verifyPassword(password, college.adminPasswordHash)) return res.status(401).json({ error: "Invalid authority username or password" });
  res.json({ token: issueToken("college", college.code, college.code), college: { code: college.code, name: college.name, details: college.details, since: college.since } });
});
app.post("/api/auth/staff/login", (req, res) => {
  const { username, password } = req.body; const db = readDB();
  const staff = db.staff.find(s => s.username === username);
  if (!staff || !verifyPassword(password, staff.passwordHash)) return res.status(401).json({ error: "Invalid staff username or password" });
  const token = issueToken("staff", staff.id, staff.collegeCode, { staffRole: staff.role, mustChangePassword: Boolean(staff.mustChangePassword) });
  res.json({ token, staff: publicStaff(staff), mustChangePassword: Boolean(staff.mustChangePassword) });
});
app.post("/api/auth/staff/set-password", auth, requireRole("staff"), (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  const db = readDB(); const staff = db.staff.find(s => s.id === req.user.id);
  if (!staff) return res.status(404).json({ error: "Staff account not found" });
  staff.passwordHash = hashPassword(newPassword); staff.mustChangePassword = false;
  writeDB(db);
  const token = (req.headers.authorization || "").slice(7); const session = sessions.get(token);
  if (session) session.mustChangePassword = false;
  res.json({ ok: true, staff: publicStaff(staff) });
});
app.post("/api/auth/logout", auth, (req, res) => { sessions.delete((req.headers.authorization || "").slice(7)); res.status(204).end(); });
app.get("/api/auth/me", auth, (req, res) => {
  const db = readDB();
  if (req.user.role === "student") {
    const student = db.students.find(s => s.id === req.user.id);
    return student ? res.json({ role: "student", student: { ...student, passwordHash: undefined } }) : res.status(404).json({ error: "Student not found" });
  }
  if (req.user.role === "staff") {
    const staff = db.staff.find(s => s.id === req.user.id);
    return staff ? res.json({ role: "staff", staff: publicStaff(staff) }) : res.status(404).json({ error: "Staff account not found" });
  }
  res.json({ role: "college", college: publicCollege(db.colleges.find(c => c.code === req.user.collegeCode)) });
});
app.get("/api/students/:id", auth, (req, res) => {
  if (req.user.role !== "student" || req.user.id !== req.params.id) return res.status(403).json({ error: "Access denied" });
  const s = readDB().students.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: "Student not found" });
  res.json({ ...s, passwordHash: undefined });
});

// ---------- college staff hierarchy (HOD / Secretary / Class Advisor / Student Rep) ----------
app.get("/api/colleges/:code/staff", auth, requireRole("college"), (req, res) => {
  if (req.user.collegeCode !== req.params.code) return res.status(403).json({ error: "Access denied" });
  res.json(readDB().staff.filter(s => s.collegeCode === req.params.code).map(publicStaff));
});
app.post("/api/colleges/:code/staff", auth, requireRole("college"), (req, res) => {
  if (req.user.collegeCode !== req.params.code) return res.status(403).json({ error: "Access denied" });
  const { name, role, username, password } = req.body || {};
  if (!name || !role || !username || !password) return res.status(400).json({ error: "Name, role, username and password are required" });
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const db = readDB();
  if (db.staff.some(s => s.username === username) || db.colleges.some(c => c.adminUsername === username)) return res.status(409).json({ error: "That username is already taken" });
  const staff = { id: nanoid(10), collegeCode: req.params.code, name: String(name).trim(), role, username: String(username).trim(), passwordHash: hashPassword(password), mustChangePassword: true, createdAt: new Date().toISOString() };
  db.staff.push(staff); writeDB(db);
  res.status(201).json(publicStaff(staff));
});
app.delete("/api/colleges/:code/staff/:id", auth, requireRole("college"), (req, res) => {
  if (req.user.collegeCode !== req.params.code) return res.status(403).json({ error: "Access denied" });
  const db = readDB(); const before = db.staff.length;
  db.staff = db.staff.filter(s => !(s.id === req.params.id && s.collegeCode === req.params.code));
  if (db.staff.length === before) return res.status(404).json({ error: "Staff member not found" });
  writeDB(db); res.status(204).end();
});

// ---------- AI key settings (RAM only) ----------
app.get("/api/ai/config", auth, requireRole("college"), (req, res) => {
  res.json({ configured: Boolean(collegeAIKeys.get(req.user.collegeCode) || process.env.OPENAI_API_KEY), source: collegeAIKeys.has(req.user.collegeCode) ? "college" : (process.env.OPENAI_API_KEY ? "server" : null), model: process.env.OPENAI_MODEL || "gpt-5.6-luna" });
});
app.post("/api/ai/config", auth, requireRole("college"), (req, res) => {
  const key = String(req.body?.apiKey || "").trim();
  if (!key) { collegeAIKeys.delete(req.user.collegeCode); return res.json({ configured: Boolean(process.env.OPENAI_API_KEY), source: process.env.OPENAI_API_KEY ? "server" : null }); }
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) return res.status(400).json({ error: "That does not look like a valid OpenAI API key." });
  collegeAIKeys.set(req.user.collegeCode, key);
  res.json({ configured: true, source: "college", model: process.env.OPENAI_MODEL || "gpt-5.6-luna" });
});

// ---------- problems ----------
app.post("/api/problems", auth, requireRole("student"), upload.single("photo"), async (req, res) => {
  const { studentId, collegeCode, description, location } = req.body;
  if (studentId !== req.user.id || collegeCode !== req.user.collegeCode) return res.status(403).json({ error: "Access denied" });
  if (!collegeCode || !description) return res.status(400).json({ error: "collegeCode and description are required" });

  const ai = await analyzeProblem({ collegeCode, description, location, file: req.file });
  const db = readDB();
  const duplicate = ai.duplicateCandidateId && db.problems.find(p => p.id === ai.duplicateCandidateId && p.collegeCode === collegeCode);
  const duplicateGroupId = duplicate ? (duplicate.duplicateGroupId || duplicate.id) : nanoid(10);
  const problem = {
    id: nanoid(10), studentId, collegeCode, description, location: location || "",
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    category: ai.category, severity: ai.severity, priority: ai.priority,
    hygieneScore: ai.hygieneScore, safetyScore: ai.safetyScore, cleanlinessScore: ai.cleanlinessScore,
    ai: { analyzed: ai.aiEnabled, summary: ai.summary, confidence: ai.confidence, error: ai.aiError || null },
    duplicateGroupId, duplicateOf: duplicate ? duplicate.id : null,
    duplicateReason: ai.duplicateReason || "", status: "reported", progressPercent: 0,
    progressNote: "", approxCompletionDate: null, completionDate: null,
    assignedRole: autoAssignRole(ai.severity), escalatedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  db.problems.push(problem); writeDB(db);
  res.status(201).json(problem);
});

app.get("/api/problems", auth, blockPendingPasswordReset, (req, res) => {
  const { collegeCode, studentId, status, category, duplicateGroupId, assignedRole } = req.query; const db = readDB();
  if (req.user.role === "student") {
    if (studentId && studentId !== req.user.id) return res.status(403).json({ error: "Access denied" });
    if (collegeCode && collegeCode !== req.user.collegeCode) return res.status(403).json({ error: "Access denied" });
  } else if (req.user.role === "college" && collegeCode && collegeCode !== req.user.collegeCode) return res.status(403).json({ error: "Access denied" });
  else if (req.user.role === "staff" && collegeCode && collegeCode !== req.user.collegeCode) return res.status(403).json({ error: "Access denied" });
  let problems = db.problems;
  if (req.user.role === "staff") { problems = problems.filter(p => p.collegeCode === req.user.collegeCode && p.assignedRole === req.user.staffRole); }
  if (collegeCode) problems = problems.filter(p => p.collegeCode === collegeCode);
  if (studentId) problems = problems.filter(p => p.studentId === studentId);
  if (status) problems = problems.filter(p => p.status === status);
  if (category) problems = problems.filter(p => p.category === category);
  if (assignedRole) problems = problems.filter(p => p.assignedRole === assignedRole);
  if (duplicateGroupId) problems = problems.filter(p => (p.duplicateGroupId || p.id) === duplicateGroupId);
  const priorityRank = { 1: 0, 2: 1, 3: 2, A: 0, B: 1, C: 2 };
  res.json([...problems].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)));
});

function canManageProblem(user, problem) {
  if (user.role === "college") return problem.collegeCode === user.collegeCode;
  if (user.role === "staff") return problem.collegeCode === user.collegeCode && problem.assignedRole === user.staffRole;
  return false;
}
function blockPendingPasswordReset(req, res, next) {
  if (req.user.role === "staff" && req.user.mustChangePassword) return res.status(403).json({ error: "Set your new password before continuing.", mustChangePassword: true });
  next();
}
app.patch("/api/problems/:id", auth, blockPendingPasswordReset, (req, res) => {
  const db = readDB(); const problem = db.problems.find(p => p.id === req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  if (!canManageProblem(req.user, problem)) return res.status(403).json({ error: "Access denied" });
  const { status, progressPercent, progressNote, approxCompletionDate } = req.body;
  const allowed = ["reported", "acknowledged", "in_progress", "on_hold", "completed"];
  if (status !== undefined && !allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  if (progressPercent !== undefined && (!Number.isFinite(Number(progressPercent)) || Number(progressPercent) < 0 || Number(progressPercent) > 100)) return res.status(400).json({ error: "Progress must be between 0 and 100" });
  if (status) problem.status = status; if (progressPercent !== undefined) problem.progressPercent = Number(progressPercent);
  if (progressNote !== undefined) problem.progressNote = progressNote; if (approxCompletionDate !== undefined) problem.approxCompletionDate = approxCompletionDate;
  if (status === "completed") { problem.completionDate = new Date().toISOString(); problem.progressPercent = 100; }
  problem.updatedAt = new Date().toISOString(); writeDB(db); res.json(problem);
});

app.post("/api/problems/:id/escalate", auth, blockPendingPasswordReset, (req, res) => {
  const db = readDB(); const problem = db.problems.find(p => p.id === req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  if (!canManageProblem(req.user, problem)) return res.status(403).json({ error: "Access denied" });
  const next = nextRoleUp(problem.assignedRole);
  if (!next) return res.status(400).json({ error: "This is already with the HOD — there is no higher authority to send it to." });
  problem.assignedRole = next; problem.escalatedAt = new Date().toISOString(); problem.updatedAt = new Date().toISOString();
  writeDB(db); res.json(problem);
});

app.listen(PORT, () => {
  console.log(`CampusPulse running at http://localhost:${PORT}`);
  console.log(`AI model: ${process.env.OPENAI_MODEL || "gpt-5.6-luna"}`);
});
