const path = require("path");
const fs = require("fs");
const JavasManager = require("./src/javasManager");
const JavasConfig = require("./src/javasConfig");
const JavasReasoningBridge = require("./src/javasReasoningBridge");
const JavasTtsManager = require("./src/javasTtsManager");
const { executeAction } = require("./src/javasActionExecutor");
const claudeMaxProxy = require("./src/claudeMaxProxy");
const log = require("./src/javasLogger");

let javasManager = null;
let config = null;
let reasoningBridge = null;
let ttsManager = null;
let api = null;

function activate(pluginApi) {
  api = pluginApi;
  log.init(pluginApi.pluginDataPath);
  config = new JavasConfig(pluginApi.pluginDataPath);
  javasManager = new JavasManager();
  reasoningBridge = new JavasReasoningBridge(config, pluginApi.managers);
  ttsManager = new JavasTtsManager(pluginApi.sendToRenderer);
  log.info("Initializing with provider:", config.get("reasoningProvider"), "model:", config.get("reasoningModel"));

  // Wire up manager events
  javasManager.on("wake-word-detected", () => {
    pluginApi.sendToRenderer("plugin:javas:wake-detected", {});
  });

  javasManager.on("state-changed", (state) => {
    pluginApi.sendToRenderer("plugin:javas:state-changed", { state });
  });

  javasManager.on("error", (err) => {
    log.error("Manager error:", err.message);
    pluginApi.sendToRenderer("plugin:javas:error", { error: err.message });
  });

  javasManager.on("command-audio-captured", async (audioBuffer) => {
    try {
      // Transcribe the captured command audio
      const transcript = await transcribeAudio(audioBuffer, pluginApi);
      if (!transcript || !transcript.trim()) {
        javasManager.resumeListening();
        return;
      }

      log.info("Command transcribed:", transcript);
      pluginApi.sendToRenderer("plugin:javas:command-transcribed", { text: transcript });

      // Send to LLM for processing
      log.info("Sending to LLM...");
      const response = await reasoningBridge.processCommand(transcript);
      log.info("LLM response:", JSON.stringify(response));

      // Execute the action
      const result = await executeAction(response.action, response.params);
      log.info("Action result:", JSON.stringify(result));

      pluginApi.sendToRenderer("plugin:javas:response-ready", {
        action: response.action,
        speak: response.speak,
        explanation: response.explanation,
        result,
      });

      // Speak the response if TTS is enabled
      if (config.get("ttsEnabled") && response.speak) {
        await ttsManager.speak(response.speak, config.getAll());
      }
    } catch (err) {
      log.error("Command processing error:", err.message);
      pluginApi.sendToRenderer("plugin:javas:error", { error: err.message });
    } finally {
      // Resume listening regardless of success/failure
      javasManager.resumeListening();
    }
  });

  // Register IPC handlers
  registerIpcHandlers(pluginApi.ipcMain);

  // Auto-start if enabled
  if (config.get("enabled")) {
    log.info("Auto-starting (enabled in settings)...");
    const settings = config.getAll();
    javasManager.start(settings).catch((err) => {
      log.error("Auto-start failed:", err.message);
    });
  } else {
    log.info("Javas disabled in settings, not auto-starting");
  }

  log.info("Plugin activated successfully");
}

function deactivate() {
  if (javasManager) {
    javasManager.stop().catch(() => {});
  }
  claudeMaxProxy.stop();
  log.info("Plugin deactivated");
}

function getSettingsPanel() {
  return path.join(__dirname, "ui", "JavasSettingsSection");
}

async function transcribeAudio(audioBuffer, pluginApi) {
  // Write audio to temp file for whisper transcription
  const os = require("os");
  const tmpFile = path.join(os.tmpdir(), `javas-cmd-${Date.now()}.wav`);

  try {
    fs.writeFileSync(tmpFile, audioBuffer);

    // Try local whisper transcription via the shared manager
    if (pluginApi.managers.whisper) {
      const result = await pluginApi.managers.whisper.transcribe(tmpFile, {
        language: "en",
      });
      return result?.text || result || "";
    }

    return "";
  } catch (err) {
    log.error("Transcription error:", err.message);
    return "";
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function registerIpcHandlers(ipcMain) {
  ipcMain.handle("plugin:javas:start", async () => {
    log.info("IPC: start requested");
    try {
      const settings = config.getAll();
      await javasManager.start(settings);
      log.info("IPC: start succeeded");
      return { success: true };
    } catch (err) {
      log.error("IPC: start failed:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("plugin:javas:stop", async () => {
    log.info("IPC: stop requested");
    try {
      await javasManager.stop();
      log.info("IPC: stop succeeded");
      return { success: true };
    } catch (err) {
      log.error("IPC: stop failed:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("plugin:javas:status", async () => {
    const status = {
      running: javasManager.isRunning(),
      state: javasManager.getState(),
    };
    log.debug("IPC: status query:", JSON.stringify(status));
    return status;
  });

  ipcMain.handle("plugin:javas:get-settings", async () => {
    log.debug("IPC: get-settings requested");
    return config.getAll();
  });

  ipcMain.handle("plugin:javas:update-settings", async (_event, settings) => {
    log.info("IPC: update-settings:", JSON.stringify(settings));
    try {
      const wasEnabled = config.get("enabled");
      config.update(settings);
      const isEnabled = config.get("enabled");

      // Handle enable/disable toggle
      if (!wasEnabled && isEnabled) {
        await javasManager.start(config.getAll());
      } else if (wasEnabled && !isEnabled) {
        await javasManager.stop();
      } else if (isEnabled && javasManager.isRunning()) {
        // Restart with new settings if sensitivity changed
        if (settings.wakeSensitivity !== undefined || settings.picovoiceAccessKey !== undefined) {
          await javasManager.stop();
          await javasManager.start(config.getAll());
        }
      }

      // Handle Claude Max proxy
      if (settings.reasoningProvider === "claude-max") {
        const proxyRunning = await claudeMaxProxy.isRunning(config.get("claudeMaxProxyPort"));
        if (!proxyRunning) {
          const installed = await claudeMaxProxy.checkInstalled();
          if (installed) {
            await claudeMaxProxy.start(config.get("claudeMaxProxyPort"));
          }
        }
      }

      api?.sendToRenderer("plugin:javas:settings-changed", config.getAll());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("plugin:javas:get-api-key", async (_event, provider) => {
    return config.getApiKey(provider);
  });

  ipcMain.handle("plugin:javas:save-api-key", async (_event, provider, key) => {
    config.setApiKey(provider, key);
    return { success: true };
  });

  ipcMain.handle("plugin:javas:speak", async (_event, text) => {
    try {
      await ttsManager.speak(text, config.getAll());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Claude Max proxy management
  ipcMain.handle("plugin:javas:claude-max-check", async () => {
    return {
      installed: await claudeMaxProxy.checkInstalled(),
      running: await claudeMaxProxy.isRunning(config.get("claudeMaxProxyPort")),
    };
  });

  ipcMain.handle("plugin:javas:claude-max-install", async () => {
    try {
      await claudeMaxProxy.install();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("plugin:javas:claude-max-start", async () => {
    try {
      await claudeMaxProxy.start(config.get("claudeMaxProxyPort"));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("plugin:javas:claude-max-stop", async () => {
    claudeMaxProxy.stop();
    return { success: true };
  });

  // Log retrieval for debugging
  ipcMain.handle("plugin:javas:get-log", async () => {
    const logPath = log.getLogPath();
    if (!logPath) return { log: "", path: "" };
    try {
      const fs = require("fs");
      const content = fs.readFileSync(logPath, "utf8");
      // Return last 200 lines
      const lines = content.split("\n");
      return { log: lines.slice(-200).join("\n"), path: logPath };
    } catch {
      return { log: "", path: logPath };
    }
  });
}

module.exports = {
  name: "javas",
  displayName: "Javas Voice Agent",
  icon: "AudioWaveform",
  activate,
  deactivate,
  getSettingsPanel,
};
