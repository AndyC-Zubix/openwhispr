const { execFile, spawn } = require("child_process");
const http = require("http");

let proxyProcess = null;

function checkInstalled() {
  return new Promise((resolve) => {
    execFile("npm", ["list", "-g", "claude-max-api-proxy", "--depth=0"], (error, stdout) => {
      resolve(!error && stdout.includes("claude-max-api-proxy"));
    });
  });
}

function install() {
  return new Promise((resolve, reject) => {
    execFile("npm", ["install", "-g", "claude-max-api-proxy"], { timeout: 120000 }, (error) => {
      if (error) {
        reject(new Error(`Failed to install claude-max-api-proxy: ${error.message}`));
      } else {
        resolve(true);
      }
    });
  });
}

function start(port = 3456) {
  return new Promise((resolve, reject) => {
    if (proxyProcess) {
      resolve(true);
      return;
    }

    try {
      proxyProcess = spawn("claude-max-api-proxy", ["--port", String(port)], {
        stdio: "pipe",
        detached: false,
      });

      proxyProcess.on("error", (err) => {
        console.error("[Javas] Claude Max proxy error:", err.message);
        proxyProcess = null;
      });

      proxyProcess.on("exit", (code) => {
        console.log(`[Javas] Claude Max proxy exited with code ${code}`);
        proxyProcess = null;
      });

      // Give it a moment to start, then check health
      setTimeout(() => {
        isRunning(port).then((running) => {
          if (running) {
            resolve(true);
          } else {
            reject(new Error("Proxy started but health check failed"));
          }
        });
      }, 2000);
    } catch (err) {
      reject(err);
    }
  });
}

function stop() {
  if (proxyProcess) {
    try {
      proxyProcess.kill();
    } catch {
      // Already dead
    }
    proxyProcess = null;
  }
}

function isRunning(port = 3456) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/v1/models`, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

module.exports = { checkInstalled, install, start, stop, isRunning };
