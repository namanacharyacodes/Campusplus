/* CampUs+ — single-page app, no build step, no framework. */
const root = document.getElementById("app");
const toastEl = document.getElementById("toast");

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}
function esc(str) { const d = document.createElement("div"); d.textContent = str ?? ""; return d.innerHTML; }
function fmtDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
const PRIORITY_LABEL = { A: "High priority", B: "Mid priority", C: "Low priority" };
const STATUS_LABEL = { reported: "Reported", acknowledged: "Acknowledged", in_progress: "In progress", on_hold: "On hold", completed: "Completed" };
const CATEGORY_LABEL = { electrical: "Electrical", plumbing: "Plumbing", structural: "Structural", cleaning: "Cleaning", furniture: "Furniture", other: "Other" };
const LEVEL_LABEL = { 1: "1 · Critical", 2: "2 · Medium", 3: "3 · Minor" };
const ROLE_LABEL = { hod: "HOD", secretary: "Secretary", class_advisor: "Class Advisor", student_rep: "Student Rep" };
const ESCALATION_CHAIN = ["student_rep", "class_advisor", "secretary", "hod"];

const session = {
  get token() { return localStorage.getItem("campusplus_token"); },
  set token(v) { if (v) localStorage.setItem("campusplus_token", v); else localStorage.removeItem("campusplus_token"); },
  get user() { try { return JSON.parse(localStorage.getItem("campusplus_user") || "null"); } catch { return null; } },
  set user(v) { if (v) localStorage.setItem("campusplus_user", JSON.stringify(v)); else localStorage.removeItem("campusplus_user"); },
  clear() { this.token = null; this.user = null; }
};

async function api(path, opts = {}) {
  const headers = opts.body instanceof FormData ? {} : { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) { session.clear(); if (!location.hash.startsWith("#/login")) location.hash = "#/login"; }
    if (err.mustChangePassword && !location.hash.startsWith("#/staff/set-password")) location.hash = "#/staff/set-password";
    throw new Error(err.error || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}
const getColleges = () => api("/api/colleges");
const getCollege = (code) => api(`/api/colleges/${code}`);
const studentSignup = (data) => api("/api/auth/student/signup", { method: "POST", body: JSON.stringify(data) });
const studentLogin = (data) => api("/api/auth/student/login", { method: "POST", body: JSON.stringify(data) });
const collegeLogin = (data) => api("/api/auth/college/login", { method: "POST", body: JSON.stringify(data) });
const createCollege = (data) => api("/api/colleges", { method: "POST", body: JSON.stringify(data) });
const staffLogin = (data) => api("/api/auth/staff/login", { method: "POST", body: JSON.stringify(data) });
const setStaffPassword = (newPassword) => api("/api/auth/staff/set-password", { method: "POST", body: JSON.stringify({ newPassword }) });
const getStaffList = (code) => api(`/api/colleges/${code}/staff`);
const createStaff = (code, data) => api(`/api/colleges/${code}/staff`, { method: "POST", body: JSON.stringify(data) });
const deleteStaff = (code, id) => api(`/api/colleges/${code}/staff/${id}`, { method: "DELETE" });
const escalateProblem = (id) => api(`/api/problems/${id}/escalate`, { method: "POST" });
const logout = () => api("/api/auth/logout", { method: "POST" }).catch(() => null);
const getStudent = (id) => api(`/api/students/${id}`);
const getProblems = (params) => api(`/api/problems?${new URLSearchParams(params)}`);
const createProblem = (formData) => api("/api/problems", { method: "POST", body: formData });
const updateProblem = (id, data) => api(`/api/problems/${id}`, { method: "PATCH", body: JSON.stringify(data) });
const getAIConfig = () => api("/api/ai/config");
const saveAIConfig = (apiKey) => api("/api/ai/config", { method: "POST", body: JSON.stringify({ apiKey }) });

function shell(innerHtml) {
  const u = session.user;
  const roleLabel = u?.role === "college" ? "College Authority" : u?.role === "staff" ? ROLE_LABEL[u.staff.role] || "Staff" : "Student";
  const actions = u ? `<span class="session-badge">${roleLabel}</span><button class="btn secondary top-logout" id="logout-btn">Logout</button>` : "";
  root.innerHTML = `<div class="topbar"><div class="brand" onclick="location.hash='#/'">CampUs<span class="plus">+</span></div><div class="topbar-actions"><span>report it. track it. fix it.</span>${actions}</div></div><div class="content">${innerHtml}</div>`;
  document.getElementById("logout-btn")?.addEventListener("click", async () => { await logout(); session.clear(); location.hash = "#/"; });
}

async function renderLanding() {
  const u = session.user;
  shell(`<div class="landing-hero"><h1>CampUs+</h1><p>Report a broken railing, a leaking ceiling, an exposed wire — get it seen, prioritized, and fixed.</p></div>
    <div class="role-grid">
      <div class="role-card"><h3>Student</h3><p>Sign in to report campus issues and follow every update from your college.</p>${u?.role === "student" ? `<button class="btn" onclick="location.hash='#/student/${u.student.id}'">Open my dashboard</button>` : `<button class="btn" onclick="location.hash='#/login/student'">Student sign in</button> <button class="btn secondary" onclick="location.hash='#/signup/student'">Create account</button>`}</div>
      <div class="role-card"><h3>College Authority</h3><p>Securely manage reports, update progress, add notes and control the resolution status.</p><button class="btn" onclick="location.hash='#/login/college'">Authority login</button></div>
    </div>`);
}

async function renderStudentSignup() {
  shell(`<button class="back-link" onclick="location.hash='#/'">← Back</button><div class="card auth-card"><h2>Create student account</h2><p class="hint auth-intro">Use your college email and create a password to access your student dashboard.</p><form id="student-signup-form">
    <div class="field"><label>Full name</label><input name="name" required placeholder="Your name" /></div>
    <div class="field-row"><div class="field"><label>Course</label><input name="course" placeholder="e.g. B.Tech Computer Science" /></div><div class="field"><label>Year of study</label><input name="yearOfStudy" placeholder="e.g. 2nd year" /></div></div>
    <div class="field-row"><div class="field"><label>Student ID</label><input name="studentId" placeholder="Roll / registration no." /></div><div class="field"><label>College email</label><input name="email" type="email" required placeholder="you@college.edu" /></div></div>
    <div class="field"><label>College</label><select name="collegeCode" required><option value="">Choose your college…</option>${(await getColleges()).map(c => `<option value="${c.code}">${esc(c.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Password</label><input name="password" type="password" minlength="6" required placeholder="At least 6 characters" /></div>
    <div class="btn-row"><button class="btn" type="submit">Create account</button><button class="btn secondary" type="button" onclick="location.hash='#/login/student'">Already have an account?</button></div>
  </form></div>`);
  document.getElementById("student-signup-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try { const result = await studentSignup(Object.fromEntries(new FormData(e.target).entries())); session.token = result.token; session.user = { role: "student", student: result.student }; toast("Account created"); location.hash = `#/student/${result.student.id}`; }
    catch (err) { toast(err.message); btn.disabled = false; }
  });
}

async function renderStudentLogin() {
  shell(`<button class="back-link" onclick="location.hash='#/'">← Back</button><div class="card auth-card"><div class="auth-icon">STUDENT</div><h2>Student sign in</h2><p class="hint auth-intro">Sign in to report issues and see their progress.</p><form id="student-login-form"><div class="field"><label>College email</label><input name="email" type="email" required placeholder="you@college.edu" /></div><div class="field"><label>Password</label><input name="password" type="password" required placeholder="Your password" /></div><div class="btn-row"><button class="btn" type="submit">Sign in</button><button class="btn secondary" type="button" onclick="location.hash='#/signup/student'">Create account</button></div></form></div>`);
  document.getElementById("student-login-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try { const result = await studentLogin(Object.fromEntries(new FormData(e.target).entries())); session.token = result.token; session.user = { role: "student", student: result.student }; toast("Signed in"); location.hash = `#/student/${result.student.id}`; }
    catch (err) { toast(err.message); btn.disabled = false; }
  });
}

async function renderCollegeLogin() {
  shell(`<button class="back-link" onclick="location.hash='#/'">← Back</button><div class="card auth-card"><div class="auth-icon">AUTHORITY</div><h2>College authority login</h2><p class="hint auth-intro">This area is restricted to authorized college staff. Students cannot enter the authority dashboard.</p><form id="college-login-form"><div class="field"><label>Authority username</label><input name="username" required placeholder="admin_gec01" /></div><div class="field"><label>Password</label><input name="password" type="password" required placeholder="Authority password" /></div><div class="btn-row"><button class="btn" type="submit">Secure login</button><button class="btn secondary" type="button" onclick="location.hash='#/register/college'">Register a new college</button></div></form><div class="security-note">🔒 Access is verified by the server before any college report data can be changed.</div></div>`);
  document.getElementById("college-login-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try { const result = await collegeLogin(Object.fromEntries(new FormData(e.target).entries())); session.token = result.token; session.user = { role: "college", college: result.college }; toast("Authority authenticated"); location.hash = `#/college/${result.college.code}`; }
    catch (err) { toast(err.message); btn.disabled = false; }
  });
}

async function renderCollegeRegister() {
  shell(`<button class="back-link" onclick="location.hash='#/login/college'">← Back</button><div class="card auth-card"><div class="auth-icon">NEW COLLEGE</div><h2>Register a new college</h2><p class="hint auth-intro">This creates a brand-new college workspace and its first authority login. To stop anyone from creating a fake college, this step needs a developer authorization password that is issued directly by the CampUs+ web developer — no college is ever given this password.</p><form id="college-register-form">
    <div class="field"><label>College name</label><input name="name" required placeholder="e.g. St. Joseph Engineering College" /></div>
    <div class="field-row"><div class="field"><label>College code</label><input name="code" required maxlength="12" style="text-transform:uppercase" placeholder="e.g. SJEC04" /></div><div class="field"><label>Established (since)</label><input name="since" placeholder="e.g. 2002" /></div></div>
    <div class="field"><label>Details</label><input name="details" placeholder="Short description" /></div>
    <div class="field-row"><div class="field"><label>Admin username</label><input name="adminUsername" placeholder="Leave blank to auto-generate" /></div><div class="field"><label>Admin password</label><input name="adminPassword" type="password" minlength="6" required placeholder="At least 6 characters" /></div></div>
    <div class="field"><label>Developer authorization password</label><input name="developerPassword" type="password" required autocomplete="off" placeholder="Given only by the web developer" /></div>
    <div class="btn-row"><button class="btn" type="submit">Create college</button></div>
  </form><div class="security-note">🔒 Every college-creation attempt is checked against a developer-only password, so nobody can register a fake college identity.</div></div>`);
  document.getElementById("college-register-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (data.code) data.code = data.code.trim().toUpperCase();
    try { const result = await createCollege(data); toast(`${result.college.name} created — sign in with "${result.adminUsername}"`); location.hash = "#/login/college"; }
    catch (err) { toast(err.message); btn.disabled = false; }
  });
}

async function renderStaffLogin(expectedRole) {
  const roleLabel = expectedRole ? ROLE_LABEL[expectedRole] : null;
  shell(`<button class="back-link" onclick="location.hash='#/'">← Back</button><div class="card auth-card"><div class="auth-icon">STAFF</div><h2>${roleLabel ? `Sign in as ${esc(roleLabel)}` : "College staff sign in"}</h2><p class="hint auth-intro">${roleLabel ? `Only accounts set up as ${esc(roleLabel)} can enter here.` : "For HOD, Secretary, Class Advisor and Student Rep accounts."} Your college authority creates this login for you — you'll set your own password the first time you sign in.</p><form id="staff-login-form"><div class="field"><label>Staff username</label><input name="username" required placeholder="Your staff username" /></div><div class="field"><label>Password</label><input name="password" type="password" required placeholder="The password your college gave you" /></div><div class="btn-row"><button class="btn" type="submit">Sign in</button></div></form></div>`);
  document.getElementById("staff-login-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const result = await staffLogin(Object.fromEntries(new FormData(e.target).entries()));
      if (expectedRole && result.staff.role !== expectedRole) { toast(`That account is set up as ${ROLE_LABEL[result.staff.role]}, not ${roleLabel}.`); btn.disabled = false; return; }
      session.token = result.token; session.user = { role: "staff", staff: { ...result.staff, mustChangePassword: result.mustChangePassword } };
      if (result.mustChangePassword) { toast("Set your own password to continue"); location.hash = "#/staff/set-password"; }
      else { toast("Signed in"); location.hash = "#/staff"; }
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
}

function statusBoardHTML(problems) {
  const statuses = ["reported","acknowledged","in_progress","on_hold","completed"];
  const counts = Object.fromEntries(statuses.map(s => [s, problems.filter(p=>p.status===s).length]));
  return `<div class="board board-five">${statuses.map(status=>`<div class="board-col"><h3>${STATUS_LABEL[status]} <span class="count-pill">${counts[status]}</span></h3>${problems.filter(p=>p.status===status).map(p=>boardCard(p)).join("")||`<div class="empty-state">Nothing here</div>`}</div>`).join("")}</div>`;
}
function wireBoardActions(refreshFn) {
  document.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openProgressEditor(btn.dataset.id, refreshFn)));
  document.querySelectorAll("[data-escalate]").forEach(btn => btn.addEventListener("click", () => doEscalate(btn.dataset.id, refreshFn)));
}

async function renderStaffSetPassword() {
  if (!session.user || session.user.role !== "staff") { location.hash = "#/login/staff"; return; }
  shell(`<div class="card auth-card"><div class="auth-icon">STAFF</div><h2>Set your own password</h2><p class="hint auth-intro">This is a one-time step. Choose a password only you know — your college authority won't see it, and you'll use it every time you sign in from now on.</p><form id="set-password-form"><div class="field"><label>New password</label><input name="newPassword" type="password" minlength="6" required placeholder="At least 6 characters" /></div><div class="field"><label>Confirm new password</label><input name="confirmPassword" type="password" minlength="6" required placeholder="Repeat your new password" /></div><div class="btn-row"><button class="btn" type="submit">Save password</button></div></form></div>`);
  document.getElementById("set-password-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const d = Object.fromEntries(new FormData(e.target).entries());
    if (d.newPassword !== d.confirmPassword) { toast("Passwords don't match"); btn.disabled = false; return; }
    try {
      const result = await setStaffPassword(d.newPassword);
      session.user = { role: "staff", staff: { ...result.staff, mustChangePassword: false } };
      toast("Password set — welcome in"); location.hash = "#/staff";
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
}

async function renderStaffDashboard() {
  if (!session.user || session.user.role !== "staff") { location.hash = "#/login/staff"; return; }
  if (session.user.staff.mustChangePassword) { location.hash = "#/staff/set-password"; return; }
  const staffUser = session.user.staff;
  shell(`<div class="card"><p>Loading your queue…</p></div>`);
  try {
    const problems = await getProblems({ collegeCode: staffUser.collegeCode }); window.__problemsCache = problems;
    shell(`<div class="college-header"><div><h2>${esc(ROLE_LABEL[staffUser.role] || "Staff")} queue</h2><p>${esc(staffUser.name)} · ${esc(staffUser.collegeCode)} · issues routed to your level</p></div><div class="authority-badge">🔒 ${esc(ROLE_LABEL[staffUser.role] || "Staff")}</div></div>
      ${problems.length ? statusBoardHTML(problems) : `<div class="empty-state">Nothing is currently assigned to you.</div>`}`);
    wireBoardActions(() => renderStaffDashboard());
  } catch (err) { shell(`<div class="card"><p>${esc(err.message)}</p></div>`); }
}

async function doEscalate(id, onDone) {
  try { await escalateProblem(id); toast("Sent to the next higher authority"); onDone(); }
  catch (err) { toast(err.message); }
}

async function renderStudentDashboard(studentId, tab = "problems") {
  if (!session.user || session.user.role !== "student" || session.user.student.id !== studentId) { location.hash = "#/login/student"; return; }
  shell(`<div class="card"><p>Loading your dashboard…</p></div>`);
  try {
    const student = await getStudent(studentId); const allProblems = await getProblems({ studentId });
    const groups = { problems: allProblems.filter(p => ["reported","acknowledged","on_hold"].includes(p.status)), progress: allProblems.filter(p => p.status === "in_progress"), solved: allProblems.filter(p => p.status === "completed") };
    const tabs = { problems: "Open reports", progress: "In progress", solved: "Solved" };
    shell(`<button class="back-link" onclick="location.hash='#/'">← Home</button><div class="college-header"><div><h2>${esc(student.name)}</h2><p>${esc(student.course || "")}${student.course && student.yearOfStudy ? " · " : ""}${esc(student.yearOfStudy || "")} · ${esc(student.collegeCode)}</p></div><button class="btn" onclick="location.hash='#/student/${studentId}/report'">Report a problem</button></div><div class="tabs">${Object.keys(tabs).map(k => `<button class="tab ${k===tab?'active':''}" onclick="location.hash='#/student/${studentId}/${k}'">${tabs[k]} (${groups[k].length})</button>`).join("")}</div><div class="problem-list">${groups[tab].length ? groups[tab].map(problemCard).join("") : `<div class="empty-state">${tab==='solved'?'No solved reports yet.':tab==='progress'?'Nothing is currently being worked on.':'No open reports. Spot something? Report it.'}</div>`}</div>`);
  } catch (err) { shell(`<div class="card"><p>${esc(err.message)}</p><button class="btn" onclick="location.hash='#/login/student'">Sign in again</button></div>`); }
}

function aiBadge(p) {
  const level = p.priority || p.severity;
  return `<span class="ai-badge level-${level || 3}">${esc(LEVEL_LABEL[level] || "AI reviewed")}</span>`;
}
function analysisLine(p) {
  return `<div class="analysis-grid"><span><b>Category</b>${esc(CATEGORY_LABEL[p.category] || p.category || "Other")}</span><span><b>Safety</b>${esc(LEVEL_LABEL[p.safetyScore] || "—")}</span><span><b>Hygiene</b>${esc(LEVEL_LABEL[p.hygieneScore] || "—")}</span><span><b>Cleanliness</b>${esc(LEVEL_LABEL[p.cleanlinessScore] || "—")}</span></div>`;
}
function problemCard(p) {
  return `<div class="problem-card">${p.photoUrl ? `<img class="problem-thumb" src="${p.photoUrl}" alt="" />` : `<div class="problem-thumb"></div>`}<div class="problem-body"><div class="problem-top"><p class="problem-desc">${esc(p.description)}</p>${aiBadge(p)}</div>${analysisLine(p)}<div class="problem-meta"><span>${esc(p.location || "Location not given")}</span><span>Status: ${esc(STATUS_LABEL[p.status] || p.status)}</span><span>Reported ${fmtDate(p.createdAt)}</span>${p.duplicateOf ? `<span>Duplicate group: ${esc(p.duplicateGroupId)}</span>` : ""}</div>${p.progressPercent !== undefined ? `<div class="progress-track"><div class="progress-fill" style="width:${Math.max(0,Math.min(100,p.progressPercent||0))}%"></div></div><div class="hint"><strong>${p.progressPercent||0}%</strong> complete${p.approxCompletionDate ? ` · expected ${fmtDate(p.approxCompletionDate)}` : ""}</div>` : ""}${p.progressNote ? `<div class="progress-note"><strong>College update:</strong> ${esc(p.progressNote)}</div>` : ""}</div></div>`;
}

async function renderReportProblem(studentId) {
  if (!session.user || session.user.role !== "student" || session.user.student.id !== studentId) { location.hash = "#/login/student"; return; }
  const student = await getStudent(studentId).catch(() => null); if (!student) return;
  shell(`<button class="back-link" onclick="location.hash='#/student/${studentId}'">← Back to dashboard</button><div class="card" style="max-width:520px;margin:0 auto;"><h2>Report a problem</h2><p class="hint" style="margin:6px 0 18px;">Describe what's wrong — a photo helps it get triaged faster.</p><form id="report-form"><div class="field"><label>Photo</label><div class="photo-input"><input type="file" name="photo" id="photo-input" accept="image/*" capture="environment" /><div class="hint">Camera or gallery</div><img id="photo-preview" class="photo-preview" style="display:none" /></div></div><div class="field"><label>Description</label><textarea name="description" required placeholder="e.g. Cracked ceiling panel near room 204"></textarea></div><div class="field"><label>Location</label><input name="location" placeholder="Building, floor, room / landmark" /><button type="button" id="use-location" class="hint location-btn">Use my current location</button></div><div class="btn-row"><button class="btn" type="submit">Submit report</button></div></form></div>`);
  document.getElementById("photo-input").addEventListener("change", e => { const f=e.target.files[0], img=document.getElementById("photo-preview"); if(f){img.src=URL.createObjectURL(f);img.style.display="block";}else img.style.display="none"; });
  document.getElementById("use-location").addEventListener("click", () => { if(!navigator.geolocation) return toast("Geolocation is not available"); navigator.geolocation.getCurrentPosition(pos => document.querySelector('input[name="location"]').value=`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,()=>toast("Couldn't get your location")); });
  document.getElementById("report-form").addEventListener("submit", async e => { e.preventDefault(); const btn=e.target.querySelector('button[type="submit"]'); btn.disabled=true; const fd=new FormData(e.target); fd.set("studentId",studentId); fd.set("collegeCode",student.collegeCode); try{await createProblem(fd);toast("Reported — thank you");location.hash=`#/student/${studentId}`;}catch(err){toast(err.message);btn.disabled=false;} });
}

async function renderCollegeDashboard(code) {
  if (!session.user || session.user.role !== "college" || session.user.college.code !== code) { location.hash = "#/login/college"; return; }
  shell(`<div class="card"><p>Loading authority dashboard…</p></div>`);
  try {
    const college = await getCollege(code); const problems = await getProblems({ collegeCode: code }); const aiConfig = await getAIConfig(); const staffList = await getStaffList(code); window.__problemsCache = problems;
    const statuses = ["reported","acknowledged","in_progress","on_hold","completed"];
    const counts = Object.fromEntries(statuses.map(s => [s, problems.filter(p=>p.status===s).length]));
    const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_LABEL).map(c => [c, problems.filter(p=>p.category===c).length]));
    const duplicateGroups = Object.values(problems.reduce((acc,p)=>{const g=p.duplicateGroupId||p.id;(acc[g]??=[]).push(p);return acc;},{})).filter(g=>g.length>1);
    shell(`<button class="back-link" onclick="location.hash='#/'">← Home</button>
      <div class="college-header"><div><h2>${esc(college.name)}</h2><p>${esc(college.details||"")} · authority mode</p></div><div class="header-actions"><div class="authority-badge">🔒 AUTHORIZED</div><button class="btn secondary" id="ai-settings">${aiConfig.configured ? "AI configured" : "Add AI API key"}</button></div></div>
      <div class="ai-overview"><div><strong>AI triage</strong><span>${aiConfig.configured ? `Active · ${esc(aiConfig.model)}` : "Not configured — keyword fallback is active"}</span></div><div><strong>${duplicateGroups.length}</strong><span>duplicate groups</span></div>${Object.entries(categoryCounts).map(([c,n])=>`<div><strong>${n}</strong><span>${CATEGORY_LABEL[c]}</span></div>`).join("")}</div>
      <div class="stats-row">${statuses.map(s=>`<div class="stat"><strong>${counts[s]}</strong><span>${STATUS_LABEL[s]}</span></div>`).join("")}</div>
      <div class="card roles-card"><div class="college-header" style="margin-bottom:14px;"><div><p class="hint" style="margin:0;">Every report starts with the Student Rep. Whoever is holding it can send it up to the next level when they can't resolve it — up to the HOD.</p></div><button class="btn" id="add-staff-btn">+ Add staff</button></div>
      <div class="role-tiles">${ESCALATION_CHAIN.map(role => { const members = staffList.filter(s=>s.role===role); return `<div class="role-tile" data-role-tile="${role}"><h3>${ROLE_LABEL[role]}</h3><span class="role-tile-count">${members.length} account${members.length===1?"":"s"}</span><div class="role-tile-names">${members.length ? members.map(s=>esc(s.name)).join(", ") : "None added yet"}</div><span class="role-tile-cta">Sign in as ${ROLE_LABEL[role]} →</span></div>`; }).join("")}</div>
      ${staffList.length ? `<div class="remove-staff-row"><label>Remove a staff account</label><div class="btn-row"><select id="remove-staff-select">${staffList.map(s=>`<option value="${s.id}">${esc(s.name)} — ${ROLE_LABEL[s.role]} (${esc(s.username)})</option>`).join("")}</select><button class="btn secondary" id="remove-staff-btn">Remove</button></div></div>` : ""}
      </div>`);
    document.getElementById("ai-settings").onclick = () => openAISettings(code, aiConfig);
    document.getElementById("add-staff-btn").onclick = () => openAddStaff(code);
    document.querySelectorAll("[data-role-tile]").forEach(tile => tile.addEventListener("click", () => location.hash = `#/login/staff/${tile.dataset.roleTile}`));
    const removeBtn = document.getElementById("remove-staff-btn");
    if (removeBtn) removeBtn.addEventListener("click", async () => {
      const id = document.getElementById("remove-staff-select").value; if (!id) return;
      if (!confirm("Remove this staff account? They will no longer be able to sign in.")) return;
      try { await deleteStaff(code, id); toast("Staff removed"); renderCollegeDashboard(code); } catch (e) { toast(e.message); }
    });
  } catch (err) { shell(`<div class="card"><p>${esc(err.message)}</p></div>`); }
}

function openAddStaff(code) {
  const modal=document.createElement("div"); modal.className="modal-backdrop";
  modal.innerHTML=`<div class="modal"><button class="modal-close" id="close-staff">×</button><h2>Add staff account</h2><p class="hint">Create a login for a member of the hierarchy. They'll only see reports routed to their level.</p><form id="add-staff-form"><div class="field"><label>Name</label><input name="name" required placeholder="Full name" /></div><div class="field"><label>Role</label><select name="role">${ESCALATION_CHAIN.map(r=>`<option value="${r}">${ROLE_LABEL[r]}</option>`).join("")}</select></div><div class="field"><label>Username</label><input name="username" required placeholder="e.g. hod_sjec04" /></div><div class="field"><label>Password</label><input name="password" type="password" minlength="6" required placeholder="At least 6 characters" /></div><div class="btn-row"><button class="btn" type="submit">Add staff</button></div></form></div>`;
  document.body.appendChild(modal);
  document.getElementById("close-staff").onclick=()=>modal.remove();
  document.getElementById("add-staff-form").onsubmit=async e=>{e.preventDefault();try{await createStaff(code, Object.fromEntries(new FormData(e.target).entries()));modal.remove();toast("Staff added — they'll set their own password on first login");renderCollegeDashboard(code);}catch(err){toast(err.message);}};
}

function openAISettings(code, current) {
  const modal=document.createElement("div"); modal.className="modal-backdrop";
  modal.innerHTML=`<div class="modal"><button class="modal-close" id="close-ai">×</button><h2>AI image analysis</h2><p class="hint">Paste the OpenAI API key here. It is kept in server memory for this college and is not saved to db.json.</p><form id="ai-key-form"><div class="field"><label>OpenAI API key</label><input name="apiKey" type="password" autocomplete="off" placeholder="sk-..." /></div><div class="security-note">AI checks category, severity, priority, hygiene, safety, cleanliness and duplicate reports.</div><div class="btn-row"><button class="btn" type="submit">Save key</button><button class="btn secondary" type="button" id="clear-ai">Clear key</button></div></form></div>`;
  document.body.appendChild(modal);
  document.getElementById("close-ai").onclick=()=>modal.remove();
  document.getElementById("clear-ai").onclick=async()=>{try{await saveAIConfig("");modal.remove();toast("AI key cleared");renderCollegeDashboard(code);}catch(e){toast(e.message);}};
  document.getElementById("ai-key-form").onsubmit=async e=>{e.preventDefault();const key=e.target.apiKey.value.trim();if(!key)return toast("Paste your API key first");try{await saveAIConfig(key);modal.remove();toast("AI is configured");renderCollegeDashboard(code);}catch(err){toast(err.message);}};
}

function roleBadge(p) {
  if (!p.assignedRole) return "";
  const atTop = p.assignedRole === "hod";
  return `<span class="role-badge role-${p.assignedRole}">${esc(ROLE_LABEL[p.assignedRole] || p.assignedRole)}${atTop ? "" : " ›"}</span>`;
}
function boardCard(p) {
  const canEscalate = p.assignedRole && p.assignedRole !== "hod";
  return `<div class="problem-card board-card"><div class="problem-top" style="width:100%"><p class="problem-desc">${esc(p.description)}</p>${aiBadge(p)}</div>${roleBadge(p)}${p.photoUrl?`<img class="problem-thumb" style="width:100%;height:120px;margin:6px 0" src="${p.photoUrl}" alt=""/>`:""}${analysisLine(p)}<div class="problem-meta"><span>${esc(p.location||"No location")}</span><span>Reported ${fmtDate(p.createdAt)}</span>${p.duplicateOf?`<span>Duplicate of ${esc(p.duplicateOf)}</span>`:""}</div><div class="progress-track"><div class="progress-fill" style="width:${p.progressPercent||0}%"></div></div><div class="hint">${p.progressPercent||0}% complete${p.approxCompletionDate ? ` · expected ${fmtDate(p.approxCompletionDate)}` : ""}</div>${p.ai?.summary?`<div class="progress-note"><strong>AI:</strong> ${esc(p.ai.summary)}</div>`:""}${p.progressNote?`<div class="progress-note">${esc(p.progressNote)}</div>`:""}<div class="btn-row" style="margin-top:10px;gap:8px;"><button class="btn secondary edit-progress" data-edit data-id="${p.id}" style="flex:1;font-size:12px;padding:8px 12px;">Update progress</button>${canEscalate ? `<button class="btn secondary" data-escalate data-id="${p.id}" style="flex:1;font-size:12px;padding:8px 12px;" title="Send to ${esc(ROLE_LABEL[nextRoleUpClient(p.assignedRole)])}">Send to higher authority</button>` : ""}</div></div>`;
}
function nextRoleUpClient(role) { const i = ESCALATION_CHAIN.indexOf(role); return i === -1 || i === ESCALATION_CHAIN.length - 1 ? null : ESCALATION_CHAIN[i + 1]; }

function openProgressEditor(id, refreshFn) {
  const p = window.__problemsCache?.find(x=>x.id===id);
  if (!p) return;
  showEditor(p, refreshFn);
}
function showEditor(p, refreshFn) {
  const modal=document.createElement("div"); modal.className="modal-backdrop"; modal.innerHTML=`<div class="modal"><button class="modal-close" id="close-modal">×</button><h2>Update issue progress</h2><p class="hint">Set the current status, completion percentage, note and expected date.</p><form id="progress-form"><div class="field"><label>Status</label><select name="status">${["reported","acknowledged","in_progress","on_hold","completed"].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${STATUS_LABEL[s]}</option>`).join("")}</select></div><div class="field"><label>Progress: <span id="progress-value">${p.progressPercent||0}%</span></label><input name="progressPercent" id="progress-range" type="range" min="0" max="100" value="${p.progressPercent||0}" /></div><div class="field"><label>College update / progress note</label><textarea name="progressNote" placeholder="e.g. Materials ordered; repair team scheduled for Friday.">${esc(p.progressNote||"")}</textarea></div><div class="field"><label>Expected completion date</label><input name="approxCompletionDate" type="date" value="${p.approxCompletionDate||""}" /></div><div class="btn-row"><button class="btn" type="submit">Save update</button><button class="btn secondary" type="button" id="cancel-modal">Cancel</button></div></form></div>`;
  document.body.appendChild(modal); document.getElementById("close-modal").onclick=()=>modal.remove(); document.getElementById("cancel-modal").onclick=()=>modal.remove(); document.getElementById("progress-range").oninput=e=>document.getElementById("progress-value").textContent=`${e.target.value}%`;
  document.getElementById("progress-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());d.progressPercent=Number(d.progressPercent);if(d.status==="completed")d.progressPercent=100;try{await updateProblem(p.id,d);modal.remove();toast("Progress updated");refreshFn();}catch(err){toast(err.message);}};
}

const routes = [
  { pattern: /^#\/$/, handler: renderLanding },
  { pattern: /^#\/signup\/student$/, handler: renderStudentSignup },
  { pattern: /^#\/login\/student$/, handler: renderStudentLogin },
  { pattern: /^#\/login\/college$/, handler: renderCollegeLogin },
  { pattern: /^#\/register\/college$/, handler: renderCollegeRegister },
  { pattern: /^#\/login\/staff$/, handler: () => renderStaffLogin() },
  { pattern: /^#\/login\/staff\/(hod|secretary|class_advisor|student_rep)$/, handler: m => renderStaffLogin(m[1]) },
  { pattern: /^#\/staff\/set-password$/, handler: renderStaffSetPassword },
  { pattern: /^#\/staff$/, handler: renderStaffDashboard },
  { pattern: /^#\/student\/([^/]+)\/report$/, handler: m => renderReportProblem(m[1]) },
  { pattern: /^#\/student\/([^/]+)\/(problems|progress|solved)$/, handler: m => renderStudentDashboard(m[1],m[2]) },
  { pattern: /^#\/student\/([^/]+)$/, handler: m => renderStudentDashboard(m[1]) },
  { pattern: /^#\/college\/([^/]+)$/, handler: m => renderCollegeDashboard(m[1]) }
];
function router(){const hash=location.hash||"#/";for(const r of routes){const m=hash.match(r.pattern);if(m){r.handler(m);return;}}renderLanding();}
window.addEventListener("hashchange",router); window.addEventListener("DOMContentLoaded",router);
