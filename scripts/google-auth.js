/**
 * One-time Google Calendar OAuth helper.
 *
 * Usage: node scripts/google-auth.js
 *
 * 1. Opens your browser to the Google consent screen
 * 2. After you grant access, Google redirects to localhost
 * 3. This script catches the code and exchanges it for a refresh token
 * 4. Writes GOOGLE_REFRESH_TOKEN to your .env file
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const PORT = 8976;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

// Build consent URL
const params = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/calendar.readonly",
  access_type: "offline",
  prompt: "consent",
});
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

// Start local server to catch the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Authorization failed</h2><p>${error}</p><p>You can close this tab.</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>No code received</h2><p>Try again.</p>");
    return;
  }

  // Exchange code for tokens
  try {
    const tokenParams = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h2>No refresh token received</h2><pre>${JSON.stringify(data, null, 2)}</pre><p>Try revoking access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> and running this script again.</p>`);
      server.close();
      process.exit(1);
    }

    // Update .env
    let newEnv = envContent;
    if (newEnv.match(/^GOOGLE_REFRESH_TOKEN=.*/m)) {
      newEnv = newEnv.replace(/^GOOGLE_REFRESH_TOKEN=.*/m, `GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
    } else {
      newEnv += `\nGOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`;
    }
    fs.writeFileSync(envPath, newEnv, "utf8");

    // Test the token
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=3&singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}`,
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const calData = await calRes.json();
    const eventCount = calData.items?.length || 0;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <h2 style="color:green">Google Calendar connected!</h2>
      <p>Refresh token saved to .env</p>
      <p>Test: found ${eventCount} upcoming event(s)</p>
      ${calData.items ? calData.items.map(e => `<p>- ${e.summary || "(No title)"} at ${e.start?.dateTime || e.start?.date}</p>`).join("") : ""}
      <p><b>You can close this tab and restart the headless runner.</b></p>
    `);

    console.log("\nRefresh token saved to .env");
    console.log(`Test: found ${eventCount} upcoming event(s)`);
    if (calData.items) {
      calData.items.forEach(e => console.log(`  - ${e.summary} at ${e.start?.dateTime || e.start?.date}`));
    }
    console.log("\nDone! Restart the headless runner or proxy to start syncing.");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
    console.error("Token exchange failed:", err.message);
  }

  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`\nGoogle Calendar OAuth Helper`);
  console.log(`============================\n`);
  console.log(`1. Opening your browser...`);
  console.log(`2. Sign in and grant calendar access`);
  console.log(`3. The token will be saved automatically\n`);
  console.log(`If the browser doesn't open, visit:`);
  console.log(authUrl + "\n");

  // Open browser
  try {
    if (process.platform === "win32") execSync(`start "" "${authUrl}"`);
    else if (process.platform === "darwin") execSync(`open "${authUrl}"`);
    else execSync(`xdg-open "${authUrl}"`);
  } catch {
    // Browser open failed — user can copy the URL
  }
});
