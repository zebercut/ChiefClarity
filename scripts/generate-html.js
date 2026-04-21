/**
 * One-off script: generates focus_brief.html from focus_brief.json
 * Usage: node scripts/generate-html.js <data-folder-path>
 */

const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const dataDir = process.argv[2] || process.env.DATA_FOLDER_PATH;
if (!dataDir) {
  console.error("Usage: node scripts/generate-html.js <data-folder-path>");
  console.error("  Or set DATA_FOLDER_PATH in .env");
  process.exit(1);
}
const jsonPath = path.join(dataDir, "focus_brief.json");
const htmlPath = path.join(dataDir, "focus_brief.html");

if (!fs.existsSync(jsonPath)) {
  console.error("No focus_brief.json found at", jsonPath);
  process.exit(1);
}

const brief = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Merge routine + exceptions, recalculate free blocks
function mergeSingleDay(day, wr, we) {
  const base = day.isWeekend ? we : wr;
  const removals = new Set(day.removals || []);
  let events = base.filter((e) => !removals.has(e.id)).map((e) => ({ ...e }));
  for (const ov of day.overrides || []) {
    const t = events.find((e) => e.id === ov.id);
    if (t) Object.assign(t, ov);
  }
  events = [...events, ...(day.additions || [])];
  events.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return { date: day.date, dayLabel: day.dayLabel, events, freeBlocks: calcFreeBlocks(events) };
}

// Always returns 7 days — fills gaps with routine-only days
function mergeCalendar(brief) {
  if (brief.calendar && brief.calendar.length > 0 && !brief.days) return brief.calendar;
  const wr = brief.routineTemplate || [];
  const we = brief.weekendRoutineTemplate || [];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Merge existing days
  const dayMap = new Map();
  for (const day of (brief.days || [])) {
    dayMap.set(day.date, mergeSingleDay(day, wr, we));
  }
  // Also check _weekSnapshot
  if (brief._weekSnapshot?.days) {
    for (const day of brief._weekSnapshot.days) {
      if (!dayMap.has(day.date)) {
        dayMap.set(day.date, mergeSingleDay(day, wr, we));
      }
    }
  }

  // Build 7 days from today
  const today = brief.dateRange?.start || new Date().toISOString().slice(0, 10);
  const result = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const existing = dayMap.get(dateStr);
    if (existing) {
      result.push(existing);
    } else {
      const routine = (isWeekend ? we : wr).map((e) => ({ ...e }));
      routine.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[dow];
      result.push({ date: dateStr, dayLabel: label, events: routine, freeBlocks: calcFreeBlocks(routine) });
    }
  }
  return result;
}

function calcFreeBlocks(events) {
  const occupied = [];
  for (const ev of events) {
    if (!ev.time || !ev.duration || ev.duration <= 0) continue;
    const [h, m] = ev.time.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;
    const start = h * 60 + m;
    occupied.push({ start, end: start + ev.duration });
  }
  if (occupied.length === 0) return [];
  occupied.sort((a, b) => a.start - b.start);
  // Merge overlapping
  const merged = [occupied[0]];
  for (let i = 1; i < occupied.length; i++) {
    const last = merged[merged.length - 1];
    if (occupied[i].start <= last.end) {
      last.end = Math.max(last.end, occupied[i].end);
    } else {
      merged.push({ ...occupied[i] });
    }
  }
  // Find gaps >= 30 min
  const blocks = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i].end;
    const gapEnd = merged[i + 1].start;
    if (gapEnd - gapStart >= 30) {
      blocks.push({
        start: `${String(Math.floor(gapStart / 60)).padStart(2, "0")}:${String(gapStart % 60).padStart(2, "0")}`,
        end: `${String(Math.floor(gapEnd / 60)).padStart(2, "0")}:${String(gapEnd % 60).padStart(2, "0")}`,
      });
    }
  }
  return blocks;
}

const VARIANT_LABELS = { day: "Today", tomorrow: "Tomorrow", week: "This Week" };
const variant = VARIANT_LABELS[brief.variant] || brief.variant;
const dateRange = brief.dateRange.start === brief.dateRange.end
  ? brief.dateRange.start : `${brief.dateRange.start} — ${brief.dateRange.end}`;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true, jsx: "react" } });
const { formatLocalDateTime } = require("../src/utils/dates");
const generatedAt = formatLocalDateTime(brief.generatedAt) || "Unknown";
const calendar = mergeCalendar(brief);

const catColors = {
  work: "#6366f1", family: "#f59e0b", health: "#22c55e",
  admin: "#a1a1aa", social: "#ec4899", routine: "#71717a",
  learning: "#06b6d4", other: "#8b5cf6",
};

let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Focus Brief — ${esc(variant)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #e4e4e7; max-width: 680px; margin: 0 auto; padding: 20px 16px 40px; line-height: 1.6; }
  h1 { font-size: 22px; color: #fafafa; margin-bottom: 4px; }
  .meta { color: #71717a; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 16px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #27272a; }
  h3 { font-size: 15px; color: #fafafa; margin: 16px 0 8px; }
  .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .summary { font-size: 15px; line-height: 1.7; color: #d4d4d8; }
  .day-note { font-size: 13px; color: #71717a; font-style: italic; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; color: #a1a1aa; font-size: 12px; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #3f3f46; }
  td { padding: 8px; border-bottom: 1px solid #27272a; font-size: 14px; }
  .event-time { font-weight: 600; white-space: nowrap; width: 55px; }
  .event-title { }
  .event-notes { font-size: 12px; color: #71717a; }
  .cat { font-size: 10px; font-weight: 600; text-transform: uppercase; }
  .flex-icon { font-size: 13px; }
  .free { color: #71717a; font-style: italic; font-size: 13px; padding: 4px 0; }
  .priority-card { display: flex; gap: 12px; align-items: flex-start; }
  .rank { background: #6366f1; color: #fff; width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .priority-content { flex: 1; }
  .priority-title { font-size: 15px; font-weight: 600; color: #fafafa; }
  .priority-why { font-size: 13px; color: #a1a1aa; margin: 4px 0 8px; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
  .pill-high { background: #ef44441a; color: #ef4444; }
  .pill-medium { background: #f59e0b1a; color: #f59e0b; }
  .pill-low { background: #22c55e1a; color: #22c55e; }
  .pill-meta { background: #27272a; color: #a1a1aa; }
  .pill-okr { background: #6366f11a; color: #6366f1; }
  .risk-card { border-left: 3px solid; }
  .risk-high { border-left-color: #ef4444; }
  .risk-medium { border-left-color: #f59e0b; }
  .risk-low { border-left-color: #22c55e; }
  .risk-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .risk-type { font-size: 12px; font-weight: 600; text-transform: uppercase; }
  .risk-severity { font-size: 11px; font-weight: 700; }
  .risk-title { font-size: 14px; font-weight: 600; color: #fafafa; margin-bottom: 4px; }
  .risk-detail { font-size: 13px; color: #a1a1aa; }
  .progress-track { height: 8px; background: #27272a; border-radius: 4px; margin: 6px 0 4px; overflow: hidden; }
  .progress-fill { height: 8px; background: #6366f1; border-radius: 4px; }
  .okr-header { display: flex; justify-content: space-between; align-items: center; }
  .okr-obj { font-size: 15px; font-weight: 600; color: #fafafa; }
  .trend-up { color: #22c55e; } .trend-down { color: #ef4444; } .trend-flat { color: #71717a; }
  .okr-pct { font-size: 12px; color: #71717a; }
  .kr-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
  .kr-title { color: #a1a1aa; } .kr-val { color: #71717a; font-weight: 600; }
  .footer { text-align: center; color: #3f3f46; font-size: 11px; margin-top: 32px; }
</style>
</head>
<body>
<h1>Focus Brief — ${esc(variant)}</h1>
<div class="meta">${esc(dateRange)} · ${esc(generatedAt)}</div>
<div class="card"><div class="summary">${esc(brief.executiveSummary)}</div></div>
`;

// Calendar
if (calendar.length > 0) {
  html += `<h2>Calendar</h2>\n`;
  for (const slot of calendar) {
    html += `<h3>${esc(slot.dayLabel)}, ${esc(slot.date)}</h3>\n`;
    // Find day note
    const dayData = (brief.days || []).find((d) => d.date === slot.date);
    if (dayData?.dayNote) {
      html += `<div class="day-note">${esc(dayData.dayNote)}</div>\n`;
    }
    if (slot.events.length > 0) {
      html += `<table><tr><th>Time</th><th>Event</th><th>Cat</th><th></th><th>Dur</th></tr>\n`;
      for (const ev of slot.events) {
        const flexIcon = ev.flexibility === "fixed" ? "🔒" : ev.flexibility === "preferred" ? "⭐" : "🔄";
        const cc = catColors[ev.category] || "#a1a1aa";
        html += `<tr>
          <td class="event-time" style="color:${cc}">${esc(ev.time)}</td>
          <td class="event-title">${esc(ev.title)}${ev.notes ? `<div class="event-notes">${esc(ev.notes)}</div>` : ""}</td>
          <td><span class="cat" style="color:${cc}">${esc(ev.category)}</span></td>
          <td class="flex-icon">${flexIcon}</td>
          <td>${esc(ev.duration)}m</td>
        </tr>\n`;
      }
      html += `</table>\n`;
    }
    if (slot.freeBlocks.length > 0) {
      for (const b of slot.freeBlocks) {
        html += `<div class="free">🟢 Free: ${esc(b.start)} — ${esc(b.end)}</div>\n`;
      }
    }
  }
}

// Priorities
if (brief.priorities?.length > 0) {
  html += `<h2>Top Priorities</h2>\n`;
  for (const p of brief.priorities) {
    html += `<div class="card"><div class="priority-card">
      <div class="rank">${esc(p.rank)}</div>
      <div class="priority-content">
        <div class="priority-title">${esc(p.title)}</div>
        <div class="priority-why">${esc(p.why)}</div>
        <div class="pills">
          ${p.due ? `<span class="pill pill-meta">Due ${esc(p.due)}</span>` : ""}
          <span class="pill pill-${esc(p.priority)}">${esc(p.priority).toUpperCase()}</span>
          ${p.okrLink ? `<span class="pill pill-okr">${esc(p.okrLink)}</span>` : ""}
        </div>
      </div>
    </div></div>\n`;
  }
}

// Risks
if (brief.risks?.length > 0) {
  html += `<h2>Risks &amp; Blockers</h2>\n`;
  for (const r of brief.risks) {
    const sc = r.severity === "high" ? "#ef4444" : r.severity === "medium" ? "#f59e0b" : "#22c55e";
    const icon = r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "🟢";
    html += `<div class="card risk-card risk-${esc(r.severity)}">
      <div class="risk-header">
        <span class="risk-type" style="color:${sc}">${icon} ${esc(r.type)}</span>
        <span class="risk-severity" style="color:${sc}">${esc(r.severity).toUpperCase()}</span>
      </div>
      <div class="risk-title">${esc(r.title)}</div>
      <div class="risk-detail">${esc(r.detail)}</div>
    </div>\n`;
  }
}

// OKR
if (brief.okrSnapshot?.length > 0) {
  html += `<h2>OKR Progress</h2>\n`;
  for (const okr of brief.okrSnapshot) {
    const ti = okr.trend === "up" ? "↑" : okr.trend === "down" ? "↓" : "→";
    const tc = `trend-${okr.trend}`;
    html += `<div class="card">
      <div class="okr-header">
        <span class="okr-obj">${esc(okr.objective)}</span>
        <span class="${tc}">${ti} ${esc(okr.trend)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.min(okr.progress, 100)}%"></div></div>
      <div class="okr-pct">${esc(okr.progress)}%</div>\n`;
    for (const kr of okr.keyResults || []) {
      html += `<div class="kr-row"><span class="kr-title">${esc(kr.title)}</span><span class="kr-val">${esc(kr.current ?? "—")}/${esc(kr.target)}</span></div>\n`;
    }
    html += `</div>\n`;
  }
}

// Companion
if (brief.companion?.motivationNote) {
  const c = brief.companion;
  const ec = c.energyRead === "high" ? "#22c55e" : c.energyRead === "low" ? "#ef4444" : "#f59e0b";
  html += `<h2>\u{1F49C} Your Companion</h2>\n`;
  html += `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${ec}"></span>
        <strong>${esc(c.mood)}</strong>
      </div>
      <span style="color:${ec};font-size:11px;font-weight:700">${esc(c.energyRead || "").toUpperCase()} ENERGY</span>
    </div>
    <p style="line-height:1.7">${esc(c.motivationNote)}</p>`;
  if (c.focusMantra) {
    html += `<div style="margin-top:12px;padding:12px;border-radius:10px;background:#6366f115;border:1px solid #6366f130;text-align:center">
      <strong style="color:#6366f1">\u2728 ${esc(c.focusMantra)}</strong>
    </div>`;
  }
  html += `</div>\n`;

  if (c.wins?.length > 0) {
    html += `<div class="card"><strong>\u{1F3C6} Recent Wins</strong><br>\n`;
    for (const w of c.wins) html += `<span style="color:#22c55e">\u2713</span> ${esc(w)}<br>\n`;
    html += `</div>\n`;
  }

  if (c.patternsToWatch?.length > 0) {
    html += `<div class="card"><strong>\u{1F50D} Patterns to Watch</strong>\n`;
    for (const pw of c.patternsToWatch) {
      const rc = pw.risk === "high" ? "#ef4444" : pw.risk === "medium" ? "#f59e0b" : "#22c55e";
      html += `<div style="display:flex;gap:8px;margin-top:8px;align-items:flex-start">
        <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${rc};margin-top:6px;flex-shrink:0"></span>
        <div><strong>${esc(pw.pattern)}</strong><br><span style="color:#a1a1aa">${esc(pw.suggestion)}</span></div>
      </div>\n`;
    }
    html += `</div>\n`;
  }

  if (c.copingSuggestion) {
    html += `<div class="card"><strong>\u{1F4A1} Strategy</strong><br>${esc(c.copingSuggestion)}</div>\n`;
  }
}

html += `<div class="footer">Generated by Chief Clarity \u00b7 ${esc(generatedAt)}</div>\n</body></html>`;

fs.writeFileSync(htmlPath, html, "utf8");
console.log("Written:", htmlPath);
console.log(`  ${calendar.length} days, ${brief.priorities?.length || 0} priorities, ${brief.risks?.length || 0} risks, ${brief.okrSnapshot?.length || 0} OKRs`);
