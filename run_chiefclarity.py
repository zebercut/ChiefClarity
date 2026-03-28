#!/usr/bin/env python3
"""
Chief Clarity - Agent-Driven Architecture
Version: 3.0.0 (Agent-Driven)

This is a THIN EXECUTION LAYER. All logic lives in agent markdown files.
Agents decide what to read, what to write, and what to do next.
"""

import os
import sys
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import anthropic
from data_manager import DataManager

# Base directory
BASE_DIR = Path(__file__).parent / "data"
AGENTS_DIR = Path(__file__).parent / "agents"

CC_VERBOSE = os.environ.get("CC_VERBOSE", "").strip().lower() in {"1", "true", "yes", "y", "on"}

def console_debug(message: str) -> None:
    if CC_VERBOSE:
        print(message)

def console_info(message: str) -> None:
    print(message)

def human_stage_for_agent(agent_name: str, mode: str) -> str:
    if agent_name == "cc_chiefclarity_agent":
        return "Understanding your request…"
    if agent_name == "cc_intake_agent":
        return "Processing your input…"
    if agent_name == "cc_planning_agent":
        return "Analyzing your data…"
    if agent_name == "cc_companion_agent":
        return "Checking your state…"
    if agent_name == "cc_feedback_agent":
        return "Processing feedback…"
    if agent_name == "cc_writer_agent":
        if mode in ["answer_input_questions", "answer_one_question"]:
            return "Writing answer…"
        return "Writing your plan…"
    return "Working…"

# Initialize data manager
data_manager = DataManager(BASE_DIR)

PLACEHOLDER_API_KEYS = {
    "",
    "API-ANTHROPIC_API_KEY",
    "YOUR_VALID_API_KEY_HERE",
}


def is_api_key_format_valid(api_key: str) -> bool:
    """Basic local validation for Anthropic API key shape."""
    return api_key.startswith("sk-ant-") and len(api_key) > 20


def validate_api_key_with_anthropic(api_key: str) -> tuple[bool, str]:
    """Validate API key by making a lightweight authenticated Anthropic request."""
    if api_key in PLACEHOLDER_API_KEYS:
        return False, "placeholder key"

    if not is_api_key_format_valid(api_key):
        return False, "invalid key format"

    try:
        test_client = anthropic.Anthropic(api_key=api_key)
        test_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        return True, "ok"
    except Exception as e:
        return False, str(e)


def load_api_key_from_config(config_path: Path) -> str:
    """Load API key from config.json, returning empty string if unavailable."""
    if not config_path.exists():
        return ""

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)
        return str(config_data.get("ANTHROPIC_API_KEY", "")).strip()
    except Exception as e:
        print(f"Warning: Could not read config.json: {e}")
        return ""


def save_api_key_to_config(config_path: Path, api_key: str) -> None:
    """Persist API key to config.json."""
    config_data = {"ANTHROPIC_API_KEY": api_key}
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2)
        f.write("\n")


def ensure_api_key() -> str:
    """Resolve API key from config/env, with interactive first-run setup fallback."""
    config_path = Path(__file__).parent / "config.json"

    config_api_key = load_api_key_from_config(config_path)
    config_valid, config_reason = validate_api_key_with_anthropic(config_api_key)
    if config_valid:
        return config_api_key
    if config_api_key:
        print(f"Config API key rejected: {config_reason}")

    env_api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    env_valid, env_reason = validate_api_key_with_anthropic(env_api_key)
    if env_valid:
        save_api_key_to_config(config_path, env_api_key)
        print("✓ Saved API key from environment to config.json")
        return env_api_key
    if env_api_key:
        print(f"Environment API key rejected: {env_reason}")

    print("\nAnthropic API key setup")
    print("No valid API key found in config.json or environment.")
    print("Get your key from: https://console.anthropic.com")

    while True:
        user_api_key = input("Enter ANTHROPIC_API_KEY: ").strip()
        if not user_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required to run Chief Clarity")

        is_valid, reason = validate_api_key_with_anthropic(user_api_key)
        if is_valid:
            save_api_key_to_config(config_path, user_api_key)
            print("✓ Saved API key to config.json")
            return user_api_key

        print(f"✗ API key invalid: {reason}")
        print("Please try again.")


# Initialize Anthropic client
api_key = ensure_api_key()
client = anthropic.Anthropic(api_key=api_key)

def read_file(filename):
    """Read file from data directory"""
    filepath = BASE_DIR / filename
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None

def write_file(filename, content):
    """Write content to a file in the data directory"""
    # Put debug files in logs/ subdirectory
    if filename.startswith("_debug_"):
        logs_dir = BASE_DIR / "logs"
        logs_dir.mkdir(exist_ok=True)
        filepath = logs_dir / filename
    else:
        filepath = BASE_DIR / filename
    
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

def _get_logs_dir() -> Path:
    logs_dir = BASE_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)
    return logs_dir

def _read_run_manifest_safely() -> dict:
    try:
        manifest_content = read_file("run_manifest.json")
        if not manifest_content:
            return {}
        return json.loads(manifest_content)
    except Exception:
        return {}

def _get_mode_for_budgeting() -> str:
    manifest = _read_run_manifest_safely()
    mode = str(manifest.get("mode", "")).strip()
    return mode or "unknown"

def _budget_key(mode: str, agent_name: str) -> str:
    return f"{mode}:{agent_name}"

def _load_budget_recommendations() -> dict:
    path = _get_logs_dir() / "token_budget_recommendations.json"
    if not path.exists():
        return {"version": 1, "updated_at": None, "by_mode_agent": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"version": 1, "updated_at": None, "by_mode_agent": {}}
        if "by_mode_agent" not in data or not isinstance(data.get("by_mode_agent"), dict):
            data["by_mode_agent"] = {}
        return data
    except Exception:
        return {"version": 1, "updated_at": None, "by_mode_agent": {}}

def _save_budget_recommendations(data: dict) -> None:
    path = _get_logs_dir() / "token_budget_recommendations.json"
    data["version"] = 1
    data["updated_at"] = datetime.now().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))

def _default_token_bounds(agent_name: str) -> tuple[int, int, int]:
    """Return (default, floor, cap) for a given agent."""
    if agent_name == "cc_planning_agent":
        return 16000, 6000, 32000
    if agent_name == "cc_writer_agent":
        # focus.md alone is ~14KB + input.txt + topics = easily 20KB+ output
        return 16000, 8000, 24000
    if agent_name == "cc_intake_agent":
        # Produces calendar.json + tasks.json + structured_input.md + intake_data.json
        # + content_index.json + archives = large combined output
        return 16000, 8000, 32000
    if agent_name == "cc_chiefclarity_agent":
        return 4000, 1500, 8000
    return 8000, 2000, 16000

def choose_max_tokens(agent_name: str) -> int:
    """Choose max_tokens dynamically based on learned recommendations.

    Uses (mode, agent_name) recommendations with strict caps/floors.
    """
    mode = _get_mode_for_budgeting()
    default_tokens, floor_tokens, cap_tokens = _default_token_bounds(agent_name)
    recs = _load_budget_recommendations()
    by_mode_agent = recs.get("by_mode_agent", {})
    key = _budget_key(mode, agent_name)
    entry = by_mode_agent.get(key, {}) if isinstance(by_mode_agent, dict) else {}
    recommended = entry.get("recommended_max_tokens")
    if isinstance(recommended, int):
        return _clamp(recommended, floor_tokens, cap_tokens)
    return _clamp(default_tokens, floor_tokens, cap_tokens)

def log_agent_telemetry(
    *,
    run_id: str,
    mode: str,
    agent_name: str,
    max_tokens_requested: int,
    response_chars: int,
    parse_ok: bool,
    duration_ms: int,
    error_type: str | None,
) -> None:
    """Append a non-sensitive telemetry record for adaptive token budgeting."""
    record = {
        "ts": datetime.now().isoformat(),
        "run_id": run_id,
        "mode": mode,
        "agent": agent_name,
        "max_tokens_requested": int(max_tokens_requested),
        "response_chars": int(response_chars),
        "parse_ok": bool(parse_ok),
        "duration_ms": int(duration_ms),
        "error_type": error_type,
    }
    path = _get_logs_dir() / "telemetry_agent_runs.jsonl"
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

def update_budget_recommendations_from_telemetry(record: dict) -> None:
    """Update rolling recommendations using a single telemetry record.

    Heuristic learning rules:
    - If parse fails, increase budget +25% (up to cap)
    - If parse ok and response is small, slowly decrease -10% (down to floor)
    """
    try:
        mode = str(record.get("mode", "unknown"))
        agent = str(record.get("agent", ""))
        if not agent:
            return
        key = _budget_key(mode, agent)
        parse_ok = bool(record.get("parse_ok", False))
        response_chars = int(record.get("response_chars", 0))
        max_tokens_requested = int(record.get("max_tokens_requested", 0))
    except Exception:
        return

    default_tokens, floor_tokens, cap_tokens = _default_token_bounds(agent)
    recs = _load_budget_recommendations()
    by_mode_agent = recs.get("by_mode_agent", {})
    if not isinstance(by_mode_agent, dict):
        by_mode_agent = {}
        recs["by_mode_agent"] = by_mode_agent

    entry = by_mode_agent.get(key)
    if not isinstance(entry, dict):
        entry = {
            "recommended_max_tokens": _clamp(default_tokens, floor_tokens, cap_tokens),
            "sample_count": 0,
            "parse_fail_count": 0,
            "p95_response_chars": 0,
        }
        by_mode_agent[key] = entry

    # Update counters
    entry["sample_count"] = int(entry.get("sample_count", 0)) + 1
    if not parse_ok:
        entry["parse_fail_count"] = int(entry.get("parse_fail_count", 0)) + 1

    # Update a conservative "high watermark" proxy (not true p95, but stable and cheap)
    entry["p95_response_chars"] = max(int(entry.get("p95_response_chars", 0)), response_chars)

    current_rec = entry.get("recommended_max_tokens")
    if not isinstance(current_rec, int):
        current_rec = _clamp(default_tokens, floor_tokens, cap_tokens)

    # Learning step
    if not parse_ok:
        new_rec = int(max(current_rec, max_tokens_requested) * 1.25)
    else:
        # If outputs are consistently small, allow gentle decrease.
        # Threshold is heuristic: roughly < 3k chars means we likely over-allocated.
        if response_chars > 0 and response_chars < 3000:
            new_rec = int(current_rec * 0.9)
        else:
            new_rec = current_rec

    entry["recommended_max_tokens"] = _clamp(new_rec, floor_tokens, cap_tokens)

    # Derived metric
    fail = int(entry.get("parse_fail_count", 0))
    total = int(entry.get("sample_count", 1))
    entry["parse_fail_rate"] = round(fail / total, 4)

    _save_budget_recommendations(recs)

def list_available_files():
    """List all files in data directory"""
    if not BASE_DIR.exists():
        return []
    return [f.name for f in BASE_DIR.iterdir() if f.is_file()]

def call_claude(system_prompt, user_prompt, max_tokens=32000):
    """Call Claude API with high token limit and streaming enabled"""
    # Use streaming to handle long-running operations
    full_response = ""
    
    with client.messages.stream(
        model="claude-sonnet-4-5-20250929",
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}]
    ) as stream:
        for text in stream.text_stream:
            full_response += text
    
    return full_response

def _repair_json_strings(text: str) -> str:
    """Fix literal control characters inside JSON strings.

    LLMs sometimes emit raw newlines/tabs inside a string value, making it
    invalid JSON. This scanner fixes them without touching content outside strings.
    """
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            result.append(ch)
            escape_next = False
            continue
        if ch == '\\' and in_string:
            result.append(ch)
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            continue
        if in_string:
            if ch == '\n':
                result.append('\\n')
            elif ch == '\r':
                result.append('\\r')
            elif ch == '\t':
                result.append('\\t')
            else:
                result.append(ch)
        else:
            result.append(ch)
    return ''.join(result)


def _md_to_html(md: str) -> str:
    """Convert focus.md markdown to styled HTML. Zero external dependencies."""

    html_lines: list[str] = []
    lines = md.split("\n")
    in_table = False
    in_list: str | None = None  # "ul" or "ol" or None
    i = 0

    def inline(text: str) -> str:
        """Process inline markdown: bold, italic, links, code, emoji."""
        # Links [text](url)
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        # Bold+italic ***text***
        text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', text)
        # Bold **text**
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        # Italic *text*
        text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
        # Inline code `text`
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        return text

    def close_list():
        nonlocal in_list
        if in_list:
            html_lines.append(f"</{in_list}>")
            in_list = None

    def close_table():
        nonlocal in_table
        if in_table:
            html_lines.append("</tbody></table></div>")
            in_table = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Blank line
        if not stripped:
            # Don't close an ordered list if the next non-blank line continues it
            if in_list == "ol":
                # Peek ahead for continuation
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines) and re.match(r'^\s*\d+\.\s+', lines[j]):
                    i += 1
                    continue
            close_list()
            close_table()
            i += 1
            continue

        # Horizontal rule
        if stripped == "---":
            close_list()
            close_table()
            html_lines.append("<hr>")
            i += 1
            continue

        # Headers
        hm = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if hm:
            close_list()
            close_table()
            level = len(hm.group(1))
            text = inline(hm.group(2))
            slug = re.sub(r'[^a-z0-9]+', '-', hm.group(2).lower()).strip('-')
            html_lines.append(f'<h{level} id="{slug}">{text}</h{level}>')
            i += 1
            continue

        # Table row
        if stripped.startswith("|"):
            cols = [c.strip() for c in stripped.strip("|").split("|")]
            if not in_table:
                # Check if next line is separator
                if i + 1 < len(lines) and re.match(r'^\s*\|[\s\-:|]+\|', lines[i + 1]):
                    close_list()
                    in_table = True
                    html_lines.append('<div class="table-wrap"><table><thead><tr>')
                    for col in cols:
                        html_lines.append(f"<th>{inline(col)}</th>")
                    html_lines.append("</tr></thead><tbody>")
                    i += 2  # skip header + separator
                    continue
            # Body row
            html_lines.append("<tr>")
            for col in cols:
                html_lines.append(f"<td>{inline(col)}</td>")
            html_lines.append("</tr>")
            i += 1
            continue

        # Unordered list item (indented = sub-bullet)
        lm = re.match(r'^(\s*)[-*]\s+(.*)', line)
        if lm:
            close_table()
            indent = len(lm.group(1))
            if indent >= 2 and in_list == "ol":
                # Sub-bullet under an ordered list item — keep it inside <li>
                html_lines.append(f"<br>&nbsp;&nbsp;— {inline(lm.group(2))}")
            else:
                if in_list != "ul":
                    close_list()
                    in_list = "ul"
                    html_lines.append("<ul>")
                html_lines.append(f"<li>{inline(lm.group(2))}</li>")
            i += 1
            continue

        # Ordered list item
        om = re.match(r'^(\s*)\d+\.\s+(.*)', line)
        if om:
            close_table()
            if in_list != "ol":
                close_list()
                in_list = "ol"
                html_lines.append("<ol>")
            html_lines.append(f"<li>{inline(om.group(2))}")
            # Peek ahead for indented sub-bullets — keep them in this <li>
            j = i + 1
            while j < len(lines):
                sub = re.match(r'^(\s{2,})[-*]\s+(.*)', lines[j])
                if sub:
                    html_lines.append(f"<br>&nbsp;&nbsp;— {inline(sub.group(2))}")
                    j += 1
                else:
                    break
            html_lines.append("</li>")
            i = j
            continue

        # Paragraph
        close_list()
        close_table()
        html_lines.append(f"<p>{inline(stripped)}</p>")
        i += 1

    close_list()
    close_table()
    return "\n".join(html_lines)


_FOCUS_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus — {date}</title>
<style>
:root {{
  --bg: #0f172a; --surface: #1e293b; --border: #334155;
  --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8;
  --green: #4ade80; --yellow: #facc15; --red: #f87171;
  --radius: 8px;
}}
@media (prefers-color-scheme: light) {{
  :root {{
    --bg: #f8fafc; --surface: #ffffff; --border: #e2e8f0;
    --text: #1e293b; --muted: #64748b; --accent: #0284c7;
    --green: #16a34a; --yellow: #ca8a04; --red: #dc2626;
  }}
}}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg); color: var(--text);
  line-height: 1.6; padding: 1.5rem; max-width: 52rem; margin: 0 auto;
}}
h1 {{ font-size: 1.8rem; margin: 1.5rem 0 0.5rem; color: var(--accent); }}
h2 {{ font-size: 1.35rem; margin: 1.8rem 0 0.5rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border); }}
h3 {{ font-size: 1.1rem; margin: 1.2rem 0 0.4rem; }}
h4 {{ font-size: 1rem; margin: 1rem 0 0.3rem; color: var(--muted); }}
p {{ margin: 0.4rem 0; }}
hr {{ border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }}
a {{ color: var(--accent); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
strong {{ color: var(--text); }}
code {{ background: var(--surface); padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.9em; }}
ul, ol {{ margin: 0.3rem 0 0.3rem 1.5rem; }}
li {{ margin: 0.2rem 0; }}
li li {{ margin: 0; }}
.table-wrap {{ overflow-x: auto; margin: 0.8rem 0; }}
table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
th, td {{ padding: 0.45rem 0.7rem; border: 1px solid var(--border); text-align: left; }}
th {{ background: var(--surface); font-weight: 600; white-space: nowrap; }}
tr:nth-child(even) {{ background: var(--surface); }}
/* Status pills */
.focus-meta {{ color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }}
@media print {{
  body {{ background: #fff; color: #000; max-width: 100%; padding: 0.5cm; }}
  h1 {{ color: #0284c7; }}
  th {{ background: #f1f5f9; }}
}}
@media (max-width: 600px) {{
  body {{ padding: 0.75rem; }}
  table {{ font-size: 0.82rem; }}
  th, td {{ padding: 0.3rem 0.4rem; }}
}}
</style>
</head>
<body>
<p class="focus-meta">Generated {timestamp} &middot; Chief Clarity</p>
{body}
</body>
</html>
"""


def generate_focus_html(data_dir: Path) -> bool:
    """Convert focus.md to focus.html. Returns True on success."""
    focus_md_path = data_dir / "focus.md"
    if not focus_md_path.exists():
        return False
    try:
        md_content = focus_md_path.read_text(encoding="utf-8")
        body_html = _md_to_html(md_content)

        # Extract date from first h2 or use today
        date_match = re.search(r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+'
                               r'(?:January|February|March|April|May|June|July|August|September|'
                               r'October|November|December)\s+\d{1,2}', md_content)
        date_str = date_match.group(0) if date_match else datetime.now().strftime("%B %d, %Y")

        timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")

        html = _FOCUS_HTML_TEMPLATE.format(
            date=date_str,
            timestamp=timestamp,
            body=body_html,
        )
        (data_dir / "focus.html").write_text(html, encoding="utf-8")
        return True
    except Exception as e:
        console_debug(f"  ⚠ HTML generation failed: {e}")
        return False


def extract_first_json_object(text: str) -> str:
    """Extract the first balanced JSON object from text.

    This is more robust than assuming the entire response is pure JSON.
    """
    if not text:
        return ""

    s = text.strip()

    # Remove markdown code block markers if present
    if s.startswith("```"):
        lines = s.split("\n")
        lines = lines[1:]
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip() == "```":
                lines = lines[:i]
                break
        s = "\n".join(lines).strip()

    start = s.find("{")
    if start == -1:
        return s

    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]

    # If we never closed (truncated response), return best effort so json.loads throws a clear error.
    return s[start:]

def execute_agent(agent_name, context):
    """
    Generic agent executor - NO hardcoded logic
    Agent decides everything from its markdown definition
    """
    mode_for_budgeting = _get_mode_for_budgeting()
    if CC_VERBOSE:
        print(f"\n[Agent: {agent_name}]")
    else:
        console_info(human_stage_for_agent(agent_name, mode_for_budgeting))
    
    # Log agent execution start
    data_manager.log_agent_start(agent_name)
    agent_start_time = datetime.now()
    
    # Read agent definition
    agent_path = AGENTS_DIR / f"{agent_name}.md"
    if not agent_path.exists():
        raise FileNotFoundError(f"Agent not found: {agent_name}")
    
    with open(agent_path, 'r', encoding='utf-8') as f:
        agent_definition = f.read()
    
    # Build system prompt
    system_prompt = f"""You are executing as: {agent_name}

AGENT DEFINITION:
{agent_definition}

EXECUTION CONTEXT:
- System time (UTC): {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00 (%A)')}
- Available files in data/: {', '.join(list_available_files())}
- Working directory: data/

DATE AUTHORITY RULE — CRITICAL:
- The system time above is UTC. The user's timezone is NOT UTC.
- ALWAYS read run_manifest.json → current_time_user_tz for the authoritative current date and time in the user's timezone.
- Use run_manifest.json → current_time_user_tz for ALL date calculations: "today", "tomorrow", "yesterday", deadlines, agenda headers.
- NEVER use system UTC time for date calculations or date labels in any output.
- If run_manifest.json is not yet available (chiefclarity first run), read user_profile.md → timezone to interpret the request correctly.
- If the UTC-to-local conversion crosses midnight, adjust the date accordingly.

YOU DECIDE:
1. Which files to read (if any)
2. What to analyze
3. What outputs to create
4. What format to use
5. Which agent to call next (if any)

CRITICAL FOR cc_writer_agent:
- If mode is a planning mode (prepare_today/prepare_tomorrow/prepare_week/full_analysis):
  - You MUST output "focus.md" in the outputs object with complete content
  - You MUST output "input.txt" in the outputs object with cleaned content
- If mode is an answer mode (answer_input_questions/answer_one_question):
  - Do NOT write focus.md or input.txt
  - You MUST output a "console_output" string field in the top-level JSON with the final answer

OUTPUT FORMAT — always use an "outputs" object with exact filename keys:
{{
    "status": "completed",
    "next_agent": "agent_name_or_null",
    "message": "One-sentence summary of what was done",
    "steps": [
        "Step 1: what you did (e.g. Read user_profile.md → Farzin, America/Toronto)",
        "Step 2: what you did (e.g. Detected mode: prepare_today at 7:28 AM morning)",
        "Step 3: what you output (e.g. Wrote run_manifest.json with run_id run_20260327_072845)"
    ],
    "console_output": "answer text (answer modes only — omit otherwise)",
    "outputs": {{
        "some_file.json": {{"key": "value"}},
        "some_file.md": "markdown string content"
    }}
}}

STEPS RULES:
- Always populate "steps" with 3–8 short statements about what happened
- Write for a non-technical person — no file names, no JSON keys, no variable names, no system jargon
- Focus on outcomes and meaning, not on technical actions: "Your 3 goals reviewed" not "Read OKR.md"
- Use the user's name and plain everyday language: "Sorted your inbox notes" not "Classified intake items"
- Emojis are fine when helpful (🔴 urgent, ✓ done, etc.)

CRITICAL JSON RULES:
- "outputs" keys are exact filenames (e.g. "calendar.json", "focus.md", "tasks.json")
- For .json files: output the value as a proper JSON object or array — NOT a string
- For .md/.txt files: output the value as a JSON string
- In string values, ALWAYS escape special characters: newlines as \\n, quotes as \\", backslashes as \\\\
- Keep each output under 10KB; summarize or truncate if needed
- Output ONLY the JSON object — no markdown code blocks, no text before or after
"""
    
    # Collect files that should be available to this agent
    # Include files from previous agent results
    available_files = {}
    for key, value in context.items():
        if isinstance(value, dict) and "files_written" in value:
            for filename in value["files_written"]:
                content = read_file(filename)
                if content:
                    available_files[filename] = content
    
    # Check index for changed files (optimization)
    changed_files = data_manager.get_changed_files()

    # Per-agent baseline context — each agent gets only what it needs.
    # Agents also receive any files written by previous agents automatically (above).
    # NOTE: .json files take priority over .md duplicates (calendar.json > calendar.md, tasks.json > tasks.md).
    _per_agent_files = {
        "cc_chiefclarity_agent": ["user_profile.md", "content_index.json"],
        "cc_intake_agent":       ["user_profile.md", "run_manifest.json", "input.txt",
                                   "calendar.json", "tasks.json", "topic_registry.json",
                                   "structured_input.md"],
        "cc_planning_agent":     ["user_profile.md", "run_manifest.json", "OKR.md",
                                   "structured_input.md", "intake_data.json",
                                   "calendar.json", "tasks.json",
                                   "history_digest.md", "context_digest.md",
                                   "feedback_memory.json", "topic_registry.json"],
        "cc_companion_agent":    ["user_profile.md", "run_manifest.json",
                                   "structured_input.md", "intake_data.json",
                                   "history_digest.md", "context_digest.md"],
        "cc_writer_agent":       ["user_profile.md", "run_manifest.json", "input.txt",
                                   "plan_data.json", "feedback_memory.json",
                                   "topic_registry.json",
                                   "calendar.json", "tasks.json"],
        "cc_feedback_agent":     ["user_profile.md", "run_manifest.json",
                                   "input.txt", "feedback_memory.json", "chat_history.md"],
    }

    # Resolve common_files: per-agent baseline is always included.
    # Orchestrator's files_needed can ADD extra files but never restrict the baseline.
    files_needed = []
    try:
        manifest_content = read_file("run_manifest.json")
        if manifest_content:
            manifest = json.loads(manifest_content)
            files_needed = manifest.get("files_needed", [])
    except Exception:
        pass

    common_files = list(_per_agent_files.get(agent_name,
                           ["user_profile.md", "run_manifest.json"]))
    # Orchestrator can add extra files via manifest, but never narrow the baseline
    for f in files_needed:
        if f not in common_files:
            common_files.append(f)
    for filename in common_files:
        if filename not in available_files:
            # Only read if changed or not in cache
            if filename in changed_files or filename not in context.get("file_cache", {}):
                content = read_file(filename)
                if content:
                    available_files[filename] = content
                    # Update index with file metadata
                    data_manager.index.update_file_metadata(filename, {
                        "size": len(content),
                        "agent_last_read": agent_name
                    })
            else:
                # Use cached content
                available_files[filename] = context["file_cache"][filename]
    
    # Build user prompt with file contents
    user_prompt = f"""CONTEXT FROM PREVIOUS STEPS:
{json.dumps(context, indent=2)}

AVAILABLE FILES (you can reference these):
{json.dumps({k: f"[{len(v)} chars]" for k, v in available_files.items()}, indent=2)}

FILE CONTENTS:
"""
    
    # Add file contents (truncated for token efficiency)
    for filename, content in available_files.items():
        # Truncate very large files
        if len(content) > 10000:
            content = content[:10000] + f"\n... [truncated, {len(content)} total chars]"
        user_prompt += f"\n--- {filename} ---\n{content}\n"
    
    user_prompt += """
Execute your responsibilities as defined in your agent markdown file.
Output JSON with your decisions and outputs.
"""
    
    # Call Claude with dynamic token budgets (learned), clamped to safe bounds
    console_debug(f"  → Calling Claude API...")
    max_tokens = choose_max_tokens(agent_name)
    call_started = datetime.now()
    
    response = call_claude(system_prompt, user_prompt, max_tokens)
    duration_ms = int((datetime.now() - call_started).total_seconds() * 1000)
    
    # Always save raw response for debugging
    write_file(f"_debug_{agent_name}_response.txt", response)
    
    # Parse response
    try:
        json_str = extract_first_json_object(response)
        try:
            result = json.loads(json_str)
        except json.JSONDecodeError:
            # Retry after fixing literal control characters in string values
            result = json.loads(_repair_json_strings(json_str))
        
        # Validate required fields
        if "status" not in result:
            raise ValueError(f"Agent output missing required field: status")
        
        valid_statuses = ["completed", "blocked", "needs_clarification", "error"]
        if result["status"] not in valid_statuses:
            raise ValueError(f"Invalid status: {result['status']}. Must be one of {valid_statuses}")
        
        # Write files from JSON response
        files_written = []

        # Agents must never overwrite chat history. Only main() appends to chat_history.md.
        protected_filenames = {"chat_history.md"}
        
        # Handle both formats:
        # 1. Flat format: {"focus_md": "content"}
        # 2. Nested format: {"outputs": {"focus.md": "content"}}
        
        # Check if agent uses nested "outputs" object (Writer Agent format)
        if "outputs" in result and isinstance(result["outputs"], dict):
            # Nested format - extract from outputs object
            for filename, content in result["outputs"].items():
                if content:
                    if filename in protected_filenames or filename.startswith("chat_history"):
                        console_debug(f"  ! Skipping protected file write: {filename}")
                        continue
                    # Allow agents to output JSON files as proper dicts (no escaping trap)
                    if isinstance(content, dict):
                        content = json.dumps(content, indent=2, ensure_ascii=False)
                    write_file(filename, content)
                    files_written.append(filename)
                    console_debug(f"  ✓ {filename} written")
                    
                    # Update index with file metadata
                    data_manager.index.update_file_metadata(filename, {
                        "size": len(content),
                        "generated_by": agent_name,
                        "schema_version": result.get("schema_version", "unknown")
                    })
        
        # Also check flat format (for backward compatibility)
        file_mappings = {
            "calendar_md": "calendar.md",
            "tasks_md": "tasks.md",
            "structured_input_md": "structured_input.md",
            "plan_data_md": "plan_data.md",
            "focus_md": "focus.md",
            "input_txt": "input.txt",
            "answer_md": "answer.md",
            "intake_data_json": "intake_data.json",
            "run_manifest_json": "run_manifest.json"
        }
        
        for field_name, filename in file_mappings.items():
            if field_name in result and result[field_name] and filename not in files_written:
                content = result[field_name]
                if filename in protected_filenames or filename.startswith("chat_history"):
                    console_debug(f"  ! Skipping protected file write: {filename}")
                    continue
                if isinstance(content, (dict, list)):
                    content = json.dumps(content, indent=2, ensure_ascii=False)
                write_file(filename, content)
                files_written.append(filename)
                console_debug(f"  ✓ {filename} written")

                # Update index with file metadata
                data_manager.index.update_file_metadata(filename, {
                    "size": len(content),
                    "generated_by": agent_name,
                    "schema_version": result.get("schema_version", "unknown")
                })
        
        # Add to result for next agent
        result["files_written"] = files_written
        
        # Log agent completion
        agent_duration = (datetime.now() - agent_start_time).total_seconds()
        tokens_used = len(response) // 4  # Rough estimate
        data_manager.log_agent_end("completed", tokens_used)

        # Telemetry + learning (no user content)
        run_id = str(context.get("run_id", ""))
        log_agent_telemetry(
            run_id=run_id,
            mode=mode_for_budgeting,
            agent_name=agent_name,
            max_tokens_requested=max_tokens,
            response_chars=len(response),
            parse_ok=True,
            duration_ms=duration_ms,
            error_type=None,
        )
        update_budget_recommendations_from_telemetry({
            "mode": mode_for_budgeting,
            "agent": agent_name,
            "max_tokens_requested": max_tokens,
            "response_chars": len(response),
            "parse_ok": True,
        })
        
        # Print status
        console_debug(f"  → Status: {result.get('status', 'unknown')}")
        if result.get("message"):
            console_debug(f"  → {result['message']}")

        # Print progress steps — always show up to 4; CC_VERBOSE shows all
        steps = result.get("steps") or []
        if isinstance(steps, list) and steps:
            visible = steps if CC_VERBOSE else steps[:4]
            for step in visible:
                print(f"  · {step}")
            if not CC_VERBOSE and len(steps) > 4:
                print(f"  · … +{len(steps) - 4} more (set CC_VERBOSE=1 to see all)")

        return result
        
    except json.JSONDecodeError as e:
        console_debug(f"  ✗ JSON parsing error: {e}")
        console_debug(f"  → Raw response saved to _debug_{agent_name}_response.txt")
        write_file(f"_debug_{agent_name}_response.txt", response)
        console_debug(f"  → Response length: {len(response)} chars")
        console_debug(f"  → This may indicate the response was truncated. Check token limit.")
        
        # Log error to database
        data_manager.log_agent_end("error", 0, f"JSON parsing failed: {e}")

        # Telemetry + learning (no user content)
        run_id = str(context.get("run_id", ""))
        log_agent_telemetry(
            run_id=run_id,
            mode=mode_for_budgeting,
            agent_name=agent_name,
            max_tokens_requested=max_tokens,
            response_chars=len(response),
            parse_ok=False,
            duration_ms=duration_ms,
            error_type="json_parse",
        )
        update_budget_recommendations_from_telemetry({
            "mode": mode_for_budgeting,
            "agent": agent_name,
            "max_tokens_requested": max_tokens,
            "response_chars": len(response),
            "parse_ok": False,
        })
        
        return {
            "status": "error",
            "message": f"JSON parsing failed: {e}",
            "next_agent": None
        }

def backup_data_directory():
    """Create backup of data directory before workflow starts"""
    import shutil
    from datetime import datetime
    
    # Backup OUTSIDE data folder to avoid recursion
    backup_dir = BASE_DIR.parent / "data_backup"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"backup_{timestamp}"
    
    if BASE_DIR.exists():
        backup_dir.mkdir(exist_ok=True)
        
        # Exclude temp/debug files from backup
        def ignore_patterns(dir, files):
            return [f for f in files if f.startswith('_debug_') or f.endswith('.tmp')]
        
        shutil.copytree(BASE_DIR, backup_path, ignore=ignore_patterns)
        
        # Keep last 5 backups only
        backups = sorted(backup_dir.glob("backup_*"), key=lambda p: p.name, reverse=True)
        if len(backups) > 5:
            for old_backup in backups[5:]:
                try:
                    shutil.rmtree(old_backup)
                except Exception:
                    pass  # Ignore cleanup errors
        
        return backup_path
    return None

def restore_from_backup(backup_path):
    """Restore data directory from backup on failure"""
    import shutil
    import time
    
    if backup_path and backup_path.exists():
        try:
            if BASE_DIR.exists():
                shutil.rmtree(BASE_DIR)
                time.sleep(0.1)
            shutil.copytree(backup_path, BASE_DIR)
            console_debug(f"  ✓ Restored data from backup: {backup_path.name}")
            
            # Delete the failed backup
            try:
                shutil.rmtree(backup_path)
                console_debug(f"  → Deleted failed run backup: {backup_path.name}")
            except Exception:
                pass  # Ignore deletion errors
            
            return True
        except Exception as e:
            print(f"  ✗ Error restoring backup: {e}")
            return False
    return False

def show_tasks():
    """Display tasks from tasks.json in console format"""
    tasks_path = BASE_DIR / "tasks.json"
    
    if not tasks_path.exists():
        print("\n❌ tasks.json not found. Run a planning workflow first.")
        return
    
    try:
        with open(tasks_path, 'r', encoding='utf-8') as f:
            tasks_data = json.load(f)
        
        tasks = tasks_data.get("tasks", [])
        metadata = tasks_data.get("metadata", {})
        
        print("\n" + "=" * 60)
        print(f"📋 TASKS SUMMARY ({metadata.get('active_tasks', 0)} active)")
        print("=" * 60)
        
        # Group tasks by priority and status
        critical_today = [t for t in tasks if t["priority"] == "critical" and t["status"] != "completed" and t["due_date"].startswith(datetime.now().strftime("%Y-%m-%d"))]
        high_today = [t for t in tasks if t["priority"] == "high" and t["status"] != "completed" and t["due_date"].startswith(datetime.now().strftime("%Y-%m-%d"))]
        overdue = [t for t in tasks if t["status"] == "overdue"]
        at_risk = [t for t in tasks if t["status"] == "at_risk"]
        blocked = [t for t in tasks if t["status"] == "blocked"]
        
        if critical_today:
            print("\n🔴 CRITICAL (Due Today):")
            for task in critical_today:
                time_info = f" | {task['time_allocated_minutes']}min" if task['time_allocated_minutes'] else ""
                print(f"  [{task['id']}] {task['title']} — Due {task['due_date'][11:16]}{time_info}")
        
        if high_today:
            print("\n🟠 HIGH (Due Today):")
            for task in high_today:
                time_info = f" | {task['time_allocated_minutes']}min" if task['time_allocated_minutes'] else ""
                print(f"  [{task['id']}] {task['title']}{time_info}")
        
        if overdue:
            print(f"\n⚠️  OVERDUE ({len(overdue)}):")
            for task in overdue:
                print(f"  [{task['id']}] {task['title']} — Due {task['due_date'][:10]} | {task['priority'].upper()}")
        
        if at_risk:
            print(f"\n⚡ AT RISK ({len(at_risk)}):")
            for task in at_risk:
                print(f"  [{task['id']}] {task['title']} — Due {task['due_date'][:10]}")
        
        if blocked:
            print(f"\n🚫 BLOCKED ({len(blocked)}):")
            for task in blocked:
                blockers = ", ".join(task.get("blocked_by", []))
                print(f"  [{task['id']}] {task['title']} — Blocked by: {blockers}")
        
        print("\n" + "=" * 60)
        print(f"📊 Total: {metadata.get('total_tasks', 0)} | Active: {metadata.get('active_tasks', 0)} | Completed: {metadata.get('completed_tasks', 0)}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Error reading tasks.json: {e}")

def show_calendar():
    """Display calendar events from calendar.json in console format"""
    calendar_path = BASE_DIR / "calendar.json"
    
    if not calendar_path.exists():
        print("\n❌ calendar.json not found. Run a planning workflow first.")
        return
    
    try:
        with open(calendar_path, 'r', encoding='utf-8') as f:
            calendar_data = json.load(f)
        
        events = calendar_data.get("events", [])
        recurring = calendar_data.get("recurring_events", [])
        metadata = calendar_data.get("metadata", {})
        
        print("\n" + "=" * 60)
        print(f"📅 CALENDAR SUMMARY ({metadata.get('active_events', 0)} active)")
        print("=" * 60)
        
        # Group events by date and status
        today_str = datetime.now().strftime("%Y-%m-%d")
        today_events = [e for e in events if e["date"].startswith(today_str)]
        upcoming = [e for e in events if e["date"] > f"{today_str}T23:59:59" and e["status"] not in ["completed", "cancelled"]]
        completed = [e for e in events if e["status"] == "completed"]
        not_confirmed = [e for e in events if e["status"] == "not_confirmed"]
        
        if today_events:
            print(f"\n📆 TODAY ({datetime.now().strftime('%B %d, %Y')}):")
            for event in sorted(today_events, key=lambda x: x["date"]):
                time_str = event["date"][11:16] if event["date"][11:16] != "00:00" else "All day"
                duration = f" ({event['duration_minutes']}min)" if event["duration_minutes"] > 0 else ""
                location = f" @ {event['location']}" if event["location"] else ""
                print(f"  [{event['id']}] {time_str} | {event['title']}{duration}{location}")
        
        if upcoming[:10]:  # Show next 10 upcoming
            print(f"\n📅 UPCOMING (Next 10):")
            for event in sorted(upcoming, key=lambda x: x["date"])[:10]:
                date_str = event["date"][:10]
                time_str = event["date"][11:16] if event["date"][11:16] != "00:00" else "All day"
                duration = f" ({event['duration_minutes']}min)" if event["duration_minutes"] > 0 else ""
                print(f"  [{event['id']}] {date_str} {time_str} | {event['title']}{duration}")
        
        if not_confirmed:
            print(f"\n⚠️  NOT CONFIRMED ({len(not_confirmed)}):")
            for event in not_confirmed:
                date_str = event["date"][:10]
                print(f"  [{event['id']}] {date_str} | {event['title']}")
        
        if recurring:
            print(f"\n🔄 RECURRING PATTERNS ({len(recurring)}):")
            for pattern in recurring:
                if pattern["recurrence"]["frequency"] == "daily":
                    freq = "Daily"
                    time_str = pattern["recurrence"]["time"]
                else:
                    freq = f"Weekly ({pattern['recurrence']['day_of_week']})"
                    time_str = pattern["recurrence"]["time"]
                duration = f" ({pattern['recurrence']['duration_minutes']}min)" if pattern["recurrence"].get("duration_minutes", 0) > 0 else ""
                print(f"  [{pattern['id']}] {freq} {time_str} | {pattern['title']}{duration}")
        
        print("\n" + "=" * 60)
        print(f"📊 Total: {metadata.get('total_events', 0)} | Active: {metadata.get('active_events', 0)} | Completed: {metadata.get('completed_events', 0)}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Error reading calendar.json: {e}")

def needs_backup(mode: str) -> bool:
    """Determine if backup is needed based on workflow mode"""
    # Only backup for planning modes that modify core data
    planning_modes = ["prepare_today", "prepare_tomorrow", "prepare_week", "full_analysis"]
    return mode in planning_modes

def main():
    """Main execution loop - agent-driven workflow with natural language"""
    print("=" * 60)
    print("Chief Clarity - Agent-Driven Architecture v3.0")
    print("=" * 60)
    
    # Get natural language request from user
    print("\nWhat would you like Chief Clarity to do?\n")
    print("Examples:")
    print("  - 'Help me plan tomorrow'")
    print("  - 'Prepare my day'")
    print("  - 'Plan this week'")
    print("  - 'Answer my questions in input.txt'")
    print("  - 'Full analysis of my situation'")
    print("  - 'show tasks' (quick task view)")
    print("  - 'show calendar' (quick calendar view)")
    print("\n" + "=" * 60 + "\n")
    
    user_request = input("Your request: ").strip()
    
    if not user_request or user_request.lower() in ["exit", "quit", "0"]:
        print("Goodbye!")
        return
    
    # Handle special commands
    if user_request.lower() in ["show tasks", "tasks", "list tasks"]:
        show_tasks()
        return
    
    if user_request.lower() in ["show calendar", "calendar", "list calendar"]:
        show_calendar()
        return
    
    print(f"\n{'=' * 60}")
    print(f"Processing: {user_request}")
    print("=" * 60)
    
    # Backup is created only AFTER cc_chiefclarity_agent determines the mode.
    # Planning modes can modify core data; answer modes should be read-only.
    backup_path = None
    
    # Generate run ID
    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    # Initialize data manager for this run
    data_manager.start_run(run_id, "natural_language", user_request)
    
    # Initialize context with natural language request
    # Orchestration agent will interpret and decide what to do
    context = {
        "user_request": user_request,
        "start_time": datetime.now().isoformat(),
        "run_id": run_id,
        "file_cache": {}  # Cache for unchanged files
    }
    
    workflow_success = True
    
    # Start with ChiefClarity agent
    current_agent = "cc_chiefclarity_agent"
    max_iterations = 10  # Safety limit
    iteration = 0
    
    # Agent-driven execution loop
    while current_agent and iteration < max_iterations:
        iteration += 1
        
        # Retry logic for agent execution
        max_retries = 2
        result = None
        
        for attempt in range(max_retries):
            try:
                result = execute_agent(current_agent, context)
                break  # Success, exit retry loop
                
            except json.JSONDecodeError as e:
                print(f"  ⚠ JSON parsing error (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    print(f"  → Retrying...")
                    continue
                else:
                    print(f"  ✗ Failed to parse agent response after {max_retries} attempts")
                    result = {"status": "error", "message": f"JSON parsing failed: {e}", "next_agent": None}
                    workflow_success = False
                    break
                    
            except Exception as e:
                print(f"  ⚠ Error (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    print(f"  → Retrying...")
                    continue
                else:
                    print(f"  ✗ Failed after {max_retries} attempts")
                    result = {"status": "error", "message": str(e), "next_agent": None}
                    workflow_success = False
                    break
        
        if not result:
            print(f"\n✗ No result from {current_agent}")
            workflow_success = False
            break
        
        # Update context with result
        context[f"{current_agent}_result"] = result
        
        # Check status
        if result.get("status") == "blocked":
            print(f"\n✗ Workflow blocked: {result.get('message')}")
            workflow_success = False
            break
        
        if result.get("status") == "needs_clarification":
            print(f"\n⚠ Needs clarification: {result.get('message')}")
            if result.get("clarification_questions"):
                for q in result["clarification_questions"]:
                    print(f"  - {q}")
            workflow_success = False
            break
        
        if result.get("status") == "error":
            print(f"\n✗ Agent error: {result.get('message')}")
            workflow_success = False
            break
        
        # After cc_chiefclarity_agent completes, decide whether to create a backup
        # based on the selected mode in data/run_manifest.json.
        if iteration == 1 and current_agent == "cc_chiefclarity_agent":
            manifest_path = BASE_DIR / "run_manifest.json"
            mode = ""
            if manifest_path.exists():
                try:
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        manifest = json.load(f)
                        mode = manifest.get("mode", "")
                except Exception as e:
                    print(f"  ⚠️  Warning: Could not read run_manifest.json to determine mode: {e}")
            
            if needs_backup(mode):
                if CC_VERBOSE:
                    print("\n  → Creating backup...")
                backup_path = backup_data_directory()
                if backup_path:
                    console_debug(f"  ✓ Backup created: {backup_path.name}")
                else:
                    console_debug("  ⚠️  Backup skipped (read-only operation)")
                    backup_path = None
            else:
                console_debug("\n  → Backup skipped (answer/read-only mode)")

        # Get next agent
        current_agent = result.get("next_agent")
    
    if iteration >= max_iterations:
        print(f"\n⚠ Max iterations ({max_iterations}) reached")
        workflow_success = False
    
    # Finalize data manager
    data_manager.end_run("completed" if workflow_success else "failed")
    
    # Check if this was an answer mode - print to console and append to chat_history.md
    if workflow_success:
        manifest_path = BASE_DIR / "run_manifest.json"
        if manifest_path.exists():
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
                mode = manifest.get("mode", "")
                
                # For answer modes, print answers to console and save to chat history
                if mode in ["answer_input_questions", "answer_one_question"]:
                    writer_result = context.get("cc_writer_agent_result", {})
                    answer_text = writer_result.get("console_output", "")
                    
                    if answer_text:
                        # Print to console
                        print("\n" + "=" * 60)
                        print("📝 ANSWERS")
                        print("=" * 60)
                        print(answer_text)
                        print("=" * 60)
                        
                        # Append to chat_history.md
                        chat_history_path = BASE_DIR / "chat_history.md"
                        timestamp = datetime.now().strftime("%Y-%m-%d %I:%M %p")
                        
                        # Create file with header if it doesn't exist
                        if not chat_history_path.exists():
                            with open(chat_history_path, 'w', encoding='utf-8') as f:
                                f.write("# Chat History\n\n")
                        
                        # Append new Q&A session
                        with open(chat_history_path, 'a', encoding='utf-8') as f:
                            f.write("---\n\n")
                            f.write(f"## {timestamp}\n\n")
                            f.write(answer_text)
                            f.write(f"\n\n**Run ID:** {run_id}\n\n")
                        
                        print(f"\n💾 Answer saved to: data/chat_history.md")
    
    # Report final status
    print("\n" + "=" * 60)
    if workflow_success:
        print("✅ Workflow COMPLETED successfully!")
        print(f"📊 Run ID: {run_id}")
        print(f"📊 Agents executed: {len(data_manager.agents_executed)}")
    else:
        print("❌ Workflow FAILED!")
        print("=" * 60)
        if backup_path:  # Only restore if backup was created
            print("\n⚠️  RESTORING FROM BACKUP...")
            
            # Close database connection before restore to prevent file lock
            data_manager.close()
            
            if restore_from_backup(backup_path):
                print("✓ Data restored to pre-workflow state")
                print("✓ No broken or fragmented data")
            else:
                print("✗ Could not restore backup")
        else:
            print("\n⚠️  No backup available (read-only operation)")
    print("=" * 60)
    if workflow_success:
        # Generate HTML version of focus.md for easy viewing
        if generate_focus_html(BASE_DIR):
            console_debug("  ✓ focus.html generated")

        print("\nGenerated files:")

        # List generated files
        for file in sorted(BASE_DIR.glob("*")):
            if file.is_file():
                print(f"  - data/{file.name}")

        # Check mode to give appropriate message
        manifest_path = BASE_DIR / "run_manifest.json"
        if manifest_path.exists():
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
                mode = manifest.get("mode", "")

                if mode in ["answer_input_questions", "answer_one_question"]:
                    print("\n✓ Answers displayed above and saved to data/chat_history.md")
                else:
                    print("\n✓ Open data/focus.html in your browser for today's plan!")
    else:
        print("\n⚠️  No files were generated due to workflow failure.")
        print("⚠️  Data has been restored to pre-workflow state.")
        print("\nTo debug:")
        print("  1. Check data/logs/_debug_*_response.txt files for agent outputs")
        print("  2. Review error messages above")
        print("  3. Try again with a simpler request")

if __name__ == "__main__":
    main()
