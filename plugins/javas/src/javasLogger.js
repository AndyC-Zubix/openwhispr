const fs = require("fs");
const path = require("path");

let logFile = null;
let logStream = null;

function init(dataPath) {
  logFile = path.join(dataPath, "javas.log");
  // Truncate log on startup to prevent unbounded growth
  try {
    fs.writeFileSync(logFile, `[${ts()}] === Javas Plugin Started ===\n`);
  } catch {
    // ignore
  }
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function write(level, ...args) {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  const line = `[${ts()}] [${level}] ${msg}`;
  console.log(`[Javas] ${msg}`);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + "\n");
    } catch {
      // ignore
    }
  }
}

module.exports = {
  init,
  info: (...args) => write("INFO", ...args),
  warn: (...args) => write("WARN", ...args),
  error: (...args) => write("ERROR", ...args),
  debug: (...args) => write("DEBUG", ...args),
  getLogPath: () => logFile,
};
