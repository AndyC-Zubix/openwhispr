const { execFile } = require("child_process");
const { shell } = require("electron");
const path = require("path");
const os = require("os");
const log = require("./javasLogger");

// Dangerous executables that should never be run
const BLOCKED_COMMANDS = new Set([
  "rm", "rmdir", "del", "format", "mkfs", "fdisk",
  "dd", "shred", "wipefs", "diskpart",
  "shutdown", "reboot", "halt", "poweroff",
  "reg", "regedit", "taskkill",
]);

// Only allow paths within user's home directory for file operations
function isPathSafe(filePath) {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  return resolved.startsWith(home);
}

function isCommandSafe(command) {
  const basename = path.basename(command).toLowerCase().replace(/\.exe$/, "");
  return !BLOCKED_COMMANDS.has(basename);
}

function executeAction(action, params) {
  log.info("Executing action:", action, "params:", JSON.stringify(params));
  return new Promise((resolve) => {
    switch (action) {
      case "shell_command":
        return resolve(executeShellCommand(params));
      case "open_url":
        return resolve(executeOpenUrl(params));
      case "search_web":
        return resolve(executeSearchWeb(params));
      case "respond_only":
        log.info("Action: respond_only (no-op)");
        return resolve({ success: true, output: "" });
      default:
        log.warn("Unknown action:", action);
        return resolve({ success: false, error: `Unknown action: ${action}` });
    }
  });
}

function executeShellCommand(params) {
  return new Promise((resolve) => {
    const { command, args = [] } = params || {};

    if (!command) {
      return resolve({ success: false, error: "No command specified" });
    }

    if (!isCommandSafe(command)) {
      log.warn("Blocked dangerous command:", command);
      return resolve({ success: false, error: `Blocked dangerous command: ${command}` });
    }
    log.info("Shell command:", command, "args:", JSON.stringify(args));

    // Validate any file path arguments
    for (const arg of args) {
      if (arg && (arg.includes("/") || arg.includes("\\")) && !isPathSafe(arg)) {
        return resolve({ success: false, error: `Path outside home directory: ${arg}` });
      }
    }

    execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        log.info("Direct execFile failed:", error.message, "- trying platform launcher");
        // If execFile fails, try platform-specific app launch
        if (process.platform === "win32") {
          // On Windows, try "start" via cmd for app names
          execFile("cmd", ["/c", "start", "", command, ...args], { timeout: 10000 }, (err2) => {
            if (err2) {
              log.error("Windows start failed:", err2.message);
              resolve({ success: false, error: err2.message });
            } else {
              log.info("Windows start succeeded:", command);
              resolve({ success: true, output: `Launched ${command}` });
            }
          });
        } else if (process.platform === "darwin") {
          // On macOS, try "open -a" for app names
          execFile("open", ["-a", command, ...args], { timeout: 10000 }, (err2) => {
            if (err2) {
              log.error("macOS open failed:", err2.message);
              resolve({ success: false, error: err2.message });
            } else {
              log.info("macOS open succeeded:", command);
              resolve({ success: true, output: `Launched ${command}` });
            }
          });
        } else {
          log.error("Shell command failed:", error.message);
          resolve({ success: false, error: error.message });
        }
      } else {
        log.info("Shell command succeeded, stdout:", (stdout || "").slice(0, 200));
        resolve({ success: true, output: stdout || stderr || `Executed ${command}` });
      }
    });
  });
}

async function executeOpenUrl(params) {
  const { url } = params || {};
  if (!url) return { success: false, error: "No URL specified" };

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { success: false, error: `Unsafe protocol: ${parsed.protocol}` };
    }
    await shell.openExternal(url);
    return { success: true, output: `Opened ${url}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function executeSearchWeb(params) {
  const { query } = params || {};
  if (!query) return { success: false, error: "No search query specified" };

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  try {
    await shell.openExternal(url);
    return { success: true, output: `Searched for: ${query}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { executeAction };
