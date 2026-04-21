import { writeTextFile } from "../utils/filesystem";
import { mergeWeekCalendar } from "./agendaMerger";
import { formatLocalDateTime } from "../utils/dates";
import type { FocusBrief } from "../types";

const VARIANT_LABELS = { day: "Today", tomorrow: "Tomorrow", week: "This Week" };

/** Escape HTML entities to prevent XSS from LLM output */
function esc(str: string | number | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders focus_brief.json into a styled focus_brief.html.
 * Readable on any device via Google Drive, browser, or file manager.
 */
export async function renderBriefToHtml(brief: FocusBrief, timezone?: string): Promise<void> {
  if (!brief.id) return;

  const variant = VARIANT_LABELS[brief.variant] || brief.variant;
  const dateRange = brief.dateRange.start === brief.dateRange.end
    ? brief.dateRange.start
    : `${brief.dateRange.start} — ${brief.dateRange.end}`;
  const generatedAt = formatLocalDateTime(brief.generatedAt) || "Unknown";

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Focus Brief — ${variant}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #09090b; color: #e4e4e7;
    max-width: 680px; margin: 0 auto; padding: 20px 16px 40px;
    line-height: 1.6;
  }
  h1 { font-size: 22px; color: #fafafa; margin-bottom: 4px; }
  .meta { color: #71717a; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 16px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1px;
       margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #27272a; }
  h3 { font-size: 15px; color: #fafafa; margin: 16px 0 8px; }
  .card {
    background: #18181b; border: 1px solid #27272a; border-radius: 12px;
    padding: 16px; margin-bottom: 12px;
  }
  .summary { font-size: 15px; line-height: 1.7; color: #d4d4d8; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; color: #a1a1aa; font-size: 12px; font-weight: 600;
       padding: 6px 8px; border-bottom: 1px solid #3f3f46; }
  td { padding: 8px; border-bottom: 1px solid #27272a; font-size: 14px; }
  .event-time { color: #6366f1; font-weight: 600; white-space: nowrap; width: 60px; }
  .free { color: #71717a; font-style: italic; font-size: 13px; padding: 4px 0; }
  .priority-card { display: flex; gap: 12px; align-items: flex-start; }
  .rank { background: #6366f1; color: #fff; width: 28px; height: 28px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center; font-weight: 700;
          font-size: 13px; flex-shrink: 0; }
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
  .activity-fill { background: #3b82f6; }
  .outcome-fill { background: #22c55e; }
  .dual-progress { margin: 6px 0; }
  .progress-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .progress-row .progress-track { flex: 1; margin: 0; }
  .progress-label { font-size: 11px; color: #a1a1aa; min-width: 52px; }
  .okr-header { display: flex; justify-content: space-between; align-items: center; }
  .okr-obj { font-size: 15px; font-weight: 600; color: #fafafa; }
  .trend-up { color: #22c55e; }
  .trend-down { color: #ef4444; }
  .trend-flat { color: #71717a; }
  .okr-pct { font-size: 12px; color: #71717a; }
  .kr-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
  .kr-title { color: #a1a1aa; }
  .kr-val { color: #71717a; font-weight: 600; }
  .footer { text-align: center; color: #3f3f46; font-size: 11px; margin-top: 32px; }
  .day-strip { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 12px; padding: 4px 0; }
  .day-chip { text-align: center; padding: 6px 14px; border-radius: 10px; border: 1px solid #27272a;
              background: #18181b; min-width: 52px; }
  .day-chip-label { font-size: 11px; color: #71717a; font-weight: 600; }
  .day-chip-date { font-size: 16px; color: #fafafa; font-weight: 700; }
</style>
</head>
<body>
<h1>Focus Brief — ${esc(variant)}</h1>
<div class="meta">${esc(dateRange)} · ${esc(generatedAt)}</div>
`;

  // Executive Summary
  html += `<div class="card"><div class="summary">${esc(brief.executiveSummary)}</div></div>\n`;

  // Calendar — merge routine + exceptions into full slots
  const briefToday = brief.dateRange?.start || new Date().toLocaleDateString("en-CA", { timeZone: timezone || undefined });
  const calendar = mergeWeekCalendar(brief, briefToday);
  if (calendar.length > 0) {
    html += `<h2>Calendar</h2>\n`;

    if (calendar.length > 1) {
      html += `<div class="day-strip">`;
      for (const slot of calendar) {
        html += `<div class="day-chip">
          <div class="day-chip-label">${esc(slot.dayLabel.slice(0, 3))}</div>
          <div class="day-chip-date">${esc(slot.date.slice(8))}</div>
        </div>`;
      }
      html += `</div>\n`;
    }

    for (const slot of calendar) {
      const isToday = slot.date === briefToday;
      const dayHeading = isToday
        ? `Today — ${esc(slot.dayLabel)}, ${esc(slot.date)}`
        : `${esc(slot.dayLabel)}, ${esc(slot.date)}`;
      html += `<h3>${dayHeading}</h3>\n`;
      if (slot.events.length > 0) {
        html += `<table><tr><th>Time</th><th>Event</th><th>Cat</th><th>Flex</th><th>Dur</th></tr>\n`;
        for (const ev of slot.events as any[]) {
          const flexIcon = ev.flexibility === "fixed" ? "\u{1F512}" : ev.flexibility === "preferred" ? "\u2b50" : "\u{1F504}";
          const catColors: Record<string, string> = {
            work: "#6366f1", family: "#f59e0b", health: "#22c55e",
            admin: "#a1a1aa", social: "#ec4899", routine: "#71717a",
            learning: "#06b6d4", other: "#8b5cf6",
          };
          const catColor = catColors[ev.category] || "#a1a1aa";
          const isDone = (ev as any)._completed;
          const isCancelled = (ev as any)._cancelled;
          const rowStyle = isDone ? ' style="opacity:0.4;text-decoration:line-through"' : isCancelled ? ' style="opacity:0.3;text-decoration:line-through"' : '';
          const statusBadge = isDone ? ' <span style="color:#22c55e;font-size:10px">\u2713</span>' : isCancelled ? ' <span style="color:#ef4444;font-size:10px">\u2717</span>' : '';
          html += `<tr${rowStyle}><td class="event-time">${esc(ev.time)}</td><td>${esc(ev.title)}${statusBadge}</td><td><span style="color:${catColor};font-size:11px;font-weight:600">${esc(ev.category)}</span></td><td>${flexIcon}</td><td>${esc(ev.duration)}m</td></tr>\n`;
        }
        html += `</table>\n`;
      } else {
        html += `<p class="free">No events scheduled</p>\n`;
      }
      if (slot.freeBlocks.length > 0) {
        for (const block of slot.freeBlocks) {
          html += `<p class="free">Free: ${esc(block.start)} — ${esc(block.end)}</p>\n`;
        }
      }
    }
  }

  // Priorities
  if (brief.priorities.length > 0) {
    html += `<h2>Top Priorities</h2>\n`;
    for (const p of brief.priorities) {
      const safePrio = ["high", "medium", "low"].includes(p.priority) ? p.priority : "low";
      const prioClass = `pill-${safePrio}`;
      html += `<div class="card"><div class="priority-card">
        <div class="rank">${esc(p.rank)}</div>
        <div class="priority-content">
          <div class="priority-title">${esc(p.title)}</div>
          <div class="priority-why">${esc(p.why)}</div>
          <div class="pills">
            ${p.due ? `<span class="pill pill-meta">Due ${esc(p.due)}</span>` : ""}
            <span class="pill ${prioClass}">${esc(p.priority).toUpperCase()}</span>
            ${p.okrLink ? `<span class="pill pill-okr">${esc(p.okrLink)}</span>` : ""}
          </div>
        </div>
      </div></div>\n`;
    }
  }

  // Topic Digest
  if (brief.topicDigest && brief.topicDigest.length > 0) {
    html += `<h2>Topics</h2>\n`;
    for (const td of brief.topicDigest) {
      html += `<div class="card">
        <strong style="font-size:15px;color:#fafafa">${esc(td.name)}</strong>\n`;
      if (td.items.length > 0) {
        html += `<ul style="margin:8px 0 0;padding-left:18px;color:#d4d4d8;font-size:13px">\n`;
        for (const item of td.items) {
          html += `  <li style="margin-bottom:4px">${esc(item)}</li>\n`;
        }
        html += `</ul>\n`;
      }
      if (td.okrConnection) {
        html += `<div style="margin-top:8px"><span class="pill pill-okr">${esc(td.okrConnection)}</span></div>\n`;
      }
      if (td.newInsights) {
        html += `<p style="margin-top:8px;font-size:13px;color:#a1a1aa;font-style:italic">${esc(td.newInsights)}</p>\n`;
      }
      html += `</div>\n`;
    }
  }

  // Risks
  if (brief.risks.length > 0) {
    html += `<h2>Risks & Blockers</h2>\n`;
    for (const r of brief.risks) {
      const sevColor = r.severity === "high" ? "#ef4444" : r.severity === "medium" ? "#f59e0b" : "#22c55e";
      const icon = r.severity === "high" ? "\u{1F534}" : r.severity === "medium" ? "\u{1F7E1}" : "\u{1F7E2}";
      html += `<div class="card risk-card risk-${["high","medium","low"].includes(r.severity) ? r.severity : "low"}">
        <div class="risk-header">
          <span class="risk-type" style="color: ${sevColor}">${icon} ${esc(r.type)}</span>
          <span class="risk-severity" style="color: ${sevColor}">${esc(r.severity).toUpperCase()}</span>
        </div>
        <div class="risk-title">${esc(r.title)}</div>
        <div class="risk-detail">${esc(r.detail)}</div>
      </div>\n`;
    }
  }

  // OKR
  if (brief.okrSnapshot.length > 0) {
    html += `<h2>OKR Progress</h2>\n`;
    for (const okr of brief.okrSnapshot) {
      const trendIcon = okr.trend === "up" ? "\u2191" : okr.trend === "down" ? "\u2193" : "\u2192";
      const trendClass = `trend-${["up","flat","down"].includes(okr.trend) ? okr.trend : "flat"}`;
      html += `<div class="card">
        <div class="okr-header">
          <span class="okr-obj">${esc(okr.objective)}</span>
          <span class="${trendClass}">${trendIcon} ${esc(okr.trend)}</span>
        </div>
        <div class="dual-progress">
          <div class="progress-row">
            <span class="progress-label">Activity</span>
            <div class="progress-track"><div class="progress-fill activity-fill" style="width:${Math.min(okr.activityProgress, 100)}%"></div></div>
            <span class="okr-pct">${okr.activityProgress}%</span>
          </div>
          <div class="progress-row">
            <span class="progress-label">Outcome</span>
            <div class="progress-track"><div class="progress-fill outcome-fill" style="width:${Math.min(okr.outcomeProgress, 100)}%"></div></div>
            <span class="okr-pct">${okr.outcomeProgress}%</span>
          </div>
        </div>\n`;
      for (const kr of okr.keyResults) {
        const actLabel = kr.activityProgress > 0 ? `A:${kr.activityProgress}%` : "\u2014";
        const outLabel = `O:${kr.outcomeProgress}%`;
        const isMilestone = kr.targetUnit === "%" || kr.targetUnit === "milestone" || !kr.targetUnit;
        const valLabel = isMilestone
          ? (kr.currentNote ? esc(kr.currentNote) : "")
          : (kr.currentValue !== null ? `${kr.currentValue}/${kr.targetValue} ${esc(kr.targetUnit)}` : `\u2014/${kr.targetValue} ${esc(kr.targetUnit)}`);
        const detail = valLabel ? ` (${valLabel})` : "";
        html += `<div class="kr-row"><span class="kr-title">${esc(kr.title)}</span><span class="kr-val">${actLabel} ${outLabel}${detail}</span></div>\n`;
      }
      html += `</div>\n`;
    }
  }

  // Companion
  if (brief.companion?.motivationNote) {
    const c = brief.companion;
    const energyColor = c.energyRead === "high" ? "#22c55e" : c.energyRead === "low" ? "#ef4444" : "#f59e0b";
    html += `<h2>\u{1F49C} Your Companion</h2>\n`;
    html += `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${energyColor}"></span>
          <strong>${esc(c.mood)}</strong>
        </div>
        <span style="color:${energyColor};font-size:11px;font-weight:700">${esc(c.energyRead).toUpperCase()} ENERGY</span>
      </div>
      <p style="line-height:1.7">${esc(c.motivationNote)}</p>`;
    if (c.focusMantra) {
      html += `<div style="margin-top:12px;padding:12px;border-radius:10px;background:#6366f115;border:1px solid #6366f130;text-align:center">
        <strong style="color:#6366f1">\u2728 ${esc(c.focusMantra)}</strong>
      </div>`;
    }
    html += `</div>\n`;

    if (c.wins && c.wins.length > 0) {
      html += `<div class="card"><strong>\u{1F3C6} Recent Wins</strong><br>\n`;
      for (const w of c.wins) {
        html += `<span style="color:#22c55e">\u2713</span> ${esc(w)}<br>\n`;
      }
      html += `</div>\n`;
    }

    if (c.patternsToWatch && c.patternsToWatch.length > 0) {
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

  // Footer
  html += `<div class="footer">Generated by Chief Clarity \u00b7 ${esc(generatedAt)}</div>\n`;
  html += `</body></html>`;

  await writeTextFile("focus_brief.html", html);
}
