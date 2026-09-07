/* CampUs+ — single-page app, no build step, no framework. */

const root = document.getElementById("app");
const toastEl = document.getElementById("toast");

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const PRIORITY_LABEL = { A: "High priority", B: "Mid priority", C: "Low priority" };

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

const getColleges = () => api("/api/colleges");
const getCollege = (code) => api(`/api/colleges/${code}`);
const createStudent = (data) => api("/api/students", { method: "POST", body: JSON.stringify(data) });
const getStudent = (id) => api(`/api/students/${id}`);
const getProblems = (params) => api(`/api/problems?${new URLSearchParams(params)}`);
const createProblem = (formData) => api("/api/problems", { method: "POST", body: formData });
const updateProblem = (id, data) => api(`/api/problems/${id}`, { method: "PATCH", body: JSON.stringify(data) });

// ---------- shell ----------
function shell(innerHtml, { showBrand = true } = {}) {
  root.innerHTML = `
    <div class="topbar">
      <div class="brand" onclick="location.hash='#/'">CampUs<span class="plus">+</span></div>
      <div class="topbar-actions">
        <span>report it. track it. fix it.</span>
      </div>
    </div>
    <div class="content">${innerHtml}</div>
  `;
}

// ---------- routes ----------
async function renderLanding() {
  const lastStudentId = localStorage.getItem("campusplus_student_id");
  shell(`
    <div class="landing-hero">
      <h1>CampUs+</h1>
      <p>Report a broken railing, a leaking ceiling, an exposed wire — get it seen, prioritized, and fixed.</p>
    </div>
    <div class="role-grid">
      <div class="role-card">
        <h3>Student profile</h3>
        <p>Set up your profile, report issues around campus, and follow their progress to resolution.</p>
        ${lastStudentId
          ? `<button class="btn" onclick="location.hash='#/student/${lastStudentId}'">Continue to my dashboard</button>
             <button class="btn secondary" style="margin-left:10px" onclick="location.hash='#/student/new'">Use a different profile</button>`
          : `<button class="btn" onclick="location.hash='#/student/new'">Create student profile</button>`}
      </div>
      <div class="role-card">
        <h3>School, college, university profile</h3>
        <p>View reported issues for your institution, sorted by priority, and manage them through to completion.</p>
        <button class="btn" onclick="location.hash='#/college'">Open college dashboard</button>
      </div>
    </div>
  `);
}

async function renderStudentNew() {
  shell(`<div class="card"><p>Loading colleges…</p></div>`);
  const colleges = await getColleges();
  shell(`
    <button class="back-link" onclick="location.hash='#/'">← Back</button>
    <div class="card" style="max-width:520px;margin:0 auto;">
      <h2 style="margin-bottom:18px;">Student profile</h2>
      <form id="student-form">
        <div class="field">
          <label>Name</label>
          <input name="name" required placeholder="Full name" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>Course</label>
            <input name="course" placeholder="e.g. B.Tech Computer Science" />
          </div>
          <div class="field">
            <label>Year of study</label>
            <input name="yearOfStudy" placeholder="e.g. 2nd year" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Student ID</label>
            <input name="studentId" placeholder="Roll / registration no." />
          </div>
          <div class="field">
            <label>Email</label>
            <input name="email" type="email" placeholder="you@college.edu" />
          </div>
        </div>
        <div class="field">
          <label>Select your college</label>
          <select name="collegeCode" required>
            <option value="">Choose a college…</option>
            ${colleges.map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="btn-row">
          <button class="btn" type="submit">Save profile</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("student-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    try {
      const student = await createStudent(data);
      localStorage.setItem("campusplus_student_id", student.id);
      toast("Profile saved");
      location.hash = `#/student/${student.id}`;
    } catch (err) {
      toast(err.message);
    }
  });
}

async function renderStudentDashboard(studentId, tab = "problems") {
  shell(`<div class="card"><p>Loading your dashboard…</p></div>`);
  let student, allProblems;
  try {
    student = await getStudent(studentId);
    allProblems = await getProblems({ studentId });
  } catch (err) {
    shell(`<div class="card"><p>${esc(err.message)}</p><button class="btn" onclick="location.hash='#/student/new'">Create a profile</button></div>`);
    return;
  }

  const reported = allProblems.filter((p) => p.status === "reported");
  const inProgress = allProblems.filter((p) => p.status === "in_progress");
  const completed = allProblems.filter((p) => p.status === "completed");

  const tabData = {
    problems: { label: "Problems", items: reported, empty: "No open reports yet. Spot something? Report it." },
    progress: { label: "Progress", items: inProgress, empty: "Nothing currently being worked on." },
    solved: { label: "Solved", items: completed, empty: "Nothing marked complete yet." }
  };

  shell(`
    <button class="back-link" onclick="location.hash='#/'">← Back</button>
    <div class="college-header">
      <div>
        <h2>${esc(student.name)}</h2>
        <p>${esc(student.course || "")}${student.course && student.yearOfStudy ? " · " : ""}${esc(student.yearOfStudy || "")}</p>
      </div>
      <button class="btn" onclick="location.hash='#/student/${studentId}/report'">Report a problem</button>
    </div>
    <div class="tabs">
      ${Object.entries(tabData).map(([key, t]) =>
        `<button class="tab ${key === tab ? "active" : ""}" onclick="location.hash='#/student/${studentId}/${key}'">${t.label} (${t.items.length})</button>`
      ).join("")}
    </div>
    <div id="tab-body"></div>
  `);

  const body = document.getElementById("tab-body");
  const { items, empty } = tabData[tab];
  if (!items.length) {
    body.innerHTML = `<div class="empty-state">${empty}</div>`;
    return;
  }
  body.innerHTML = `<div class="problem-list">${items.map(problemCard).join("")}</div>`;
}

function problemCard(p) {
  return `
    <div class="problem-card">
      ${p.photoUrl ? `<img class="problem-thumb" src="${p.photoUrl}" alt="" />` : `<div class="problem-thumb"></div>`}
      <div class="problem-body">
        <div class="problem-top">
          <p class="problem-desc">${esc(p.description)}</p>
          <div class="priority ${p.priority}" title="${PRIORITY_LABEL[p.priority]}">${p.priority}</div>
        </div>
        <div class="problem-meta">
          <span>${esc(p.location || "Location not given")}</span>
          <span>Reported ${fmtDate(p.createdAt)}</span>
          ${p.status === "completed" ? `<span>Completed ${fmtDate(p.completionDate)}</span>` : ""}
        </div>
        ${p.status === "in_progress" ? `
          <div class="progress-track"><div class="progress-fill" style="width:${p.progressPercent || 0}%"></div></div>
          <div class="hint">${p.progressPercent || 0}% complete${p.approxCompletionDate ? " · approx. finish " + fmtDate(p.approxCompletionDate) : ""}</div>
        ` : ""}
      </div>
    </div>
  `;
}

async function renderReportProblem(studentId) {
  const student = await getStudent(studentId).catch(() => null);
  if (!student) {
    location.hash = "#/student/new";
    return;
  }
  shell(`
    <button class="back-link" onclick="location.hash='#/student/${studentId}'">← Back to dashboard</button>
    <div class="card" style="max-width:520px;margin:0 auto;">
      <h2 style="margin-bottom:6px;">Report a problem</h2>
      <p class="hint" style="margin-bottom:18px;">Describe what's wrong — a photo helps it get triaged faster.</p>
      <form id="report-form">
        <div class="field">
          <label>Photo</label>
          <div class="photo-input">
            <input type="file" name="photo" id="photo-input" accept="image/*" capture="environment" />
            <div class="hint">Camera or gallery — take a photo of the issue</div>
            <img id="photo-preview" class="photo-preview" style="display:none" />
          </div>
        </div>
        <div class="field">
          <label>Description</label>
          <textarea name="description" required placeholder="e.g. Cracked ceiling panel above the corridor near room 204, plaster flaking off"></textarea>
        </div>
        <div class="field">
          <label>Location</label>
          <input name="location" placeholder="Building, floor, room / nearest landmark" />
          <button type="button" id="use-location" class="hint" style="background:none;border:none;color:var(--navy);text-decoration:underline;padding:4px 0;">Use my current location</button>
        </div>
        <div class="btn-row">
          <button class="btn" type="submit">Submit report</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("photo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById("photo-preview");
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  });

  document.getElementById("use-location").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Geolocation not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.querySelector('input[name="location"]').value =
          `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      },
      () => toast("Couldn't get your location")
    );
  });

  document.getElementById("report-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    const fd = new FormData(e.target);
    fd.set("studentId", studentId);
    fd.set("collegeCode", student.collegeCode);
    try {
      await createProblem(fd);
      toast("Reported — thank you");
      location.hash = `#/student/${studentId}`;
    } catch (err) {
      toast(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit report";
    }
  });
}

async function renderCollegeSelect() {
  shell(`<div class="card"><p>Loading colleges…</p></div>`);
  const colleges = await getColleges();
  shell(`
    <button class="back-link" onclick="location.hash='#/'">← Back</button>
    <div class="card" style="max-width:520px;margin:0 auto;">
      <h2 style="margin-bottom:18px;">Select your college</h2>
      <div class="badge-select">
        ${colleges.map((c) => `
          <button class="college-option" onclick="location.hash='#/college/${c.code}'">
            <span>
              ${esc(c.name)}
              <small>${esc(c.details || "")} · since ${esc(c.since || "—")}</small>
            </span>
            <span>${esc(c.code)} →</span>
          </button>
        `).join("")}
      </div>
    </div>
  `);
}

async function renderCollegeDashboard(code) {
  shell(`<div class="card"><p>Loading dashboard…</p></div>`);
  let college, problems;
  try {
    college = await getCollege(code);
    problems = await getProblems({ collegeCode: code });
  } catch (err) {
    shell(`<div class="card"><p>${esc(err.message)}</p></div>`);
    return;
  }

  const cols = {
    reported: { label: "Reported problems", items: problems.filter((p) => p.status === "reported") },
    in_progress: { label: "Work in progress", items: problems.filter((p) => p.status === "in_progress") },
    completed: { label: "Completed problems", items: problems.filter((p) => p.status === "completed") }
  };

  shell(`
    <button class="back-link" onclick="location.hash='#/college'">← Switch college</button>
    <div class="college-header">
      <div>
        <h2>${esc(college.name)}</h2>
        <p>${esc(college.details || "")} · code ${esc(college.code)} · since ${esc(college.since || "—")}</p>
      </div>
    </div>
    <div class="board">
      ${Object.entries(cols).map(([status, col]) => `
        <div class="board-col">
          <h3>${col.label} <span class="count-pill">${col.items.length}</span></h3>
          ${col.items.length
            ? `<div class="problem-list">${col.items.map((p) => boardCard(p, status)).join("")}</div>`
            : `<div class="empty-state">Nothing here right now</div>`}
        </div>
      `).join("")}
    </div>
  `);

  document.querySelectorAll("[data-advance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { id, next } = btn.dataset;
      try {
        await updateProblem(id, { status: next, progressPercent: next === "in_progress" ? 10 : undefined });
        toast(next === "in_progress" ? "Moved to work in progress" : "Marked complete");
        renderCollegeDashboard(code);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function boardCard(p, status) {
  const nextAction =
    status === "reported"
      ? `<button class="btn secondary" style="margin-top:10px;font-size:12px;padding:7px 12px;" data-advance data-id="${p.id}" data-next="in_progress">Start work</button>`
      : status === "in_progress"
      ? `<button class="btn secondary" style="margin-top:10px;font-size:12px;padding:7px 12px;" data-advance data-id="${p.id}" data-next="completed">Mark complete</button>`
      : "";
  return `
    <div class="problem-card" style="flex-direction:column;">
      <div class="problem-top" style="width:100%;">
        <p class="problem-desc">${esc(p.description)}</p>
        <div class="priority ${p.priority}" title="${PRIORITY_LABEL[p.priority]}">${p.priority}</div>
      </div>
      ${p.photoUrl ? `<img class="problem-thumb" style="width:100%;height:120px;margin:6px 0;" src="${p.photoUrl}" alt="" />` : ""}
      <div class="problem-meta">
        <span>${esc(p.location || "No location given")}</span>
        <span>Reported ${fmtDate(p.createdAt)}</span>
      </div>
      ${nextAction}
    </div>
  `;
}

// ---------- router ----------
const routes = [
  { pattern: /^#\/$/, handler: renderLanding },
  { pattern: /^#\/student\/new$/, handler: renderStudentNew },
  { pattern: /^#\/student\/([^/]+)\/report$/, handler: (m) => renderReportProblem(m[1]) },
  { pattern: /^#\/student\/([^/]+)\/(problems|progress|solved)$/, handler: (m) => renderStudentDashboard(m[1], m[2]) },
  { pattern: /^#\/student\/([^/]+)$/, handler: (m) => renderStudentDashboard(m[1], "problems") },
  { pattern: /^#\/college$/, handler: renderCollegeSelect },
  { pattern: /^#\/college\/([^/]+)$/, handler: (m) => renderCollegeDashboard(m[1]) }
];

function router() {
  const hash = location.hash || "#/";
  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      route.handler(match);
      return;
    }
  }
  renderLanding();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
