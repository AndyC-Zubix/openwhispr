const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  enabled: false,
  picovoiceAccessKey: "",
  wakeSensitivity: 0.5,
  silenceTimeout: 1.5,
  reasoningProvider: "ollama",
  reasoningModel: "qwen2.5:3b",
  customEndpointUrl: "",
  ollamaUrl: "http://localhost:11434",
  claudeMaxProxyPort: 3456,
  ttsEnabled: true,
  ttsProvider: "web-speech",
  ttsVoice: "alloy",
  customSystemPrompt: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  geminiApiKey: "",
  groqApiKey: "",
};

class JavasConfig {
  constructor(dataPath) {
    this.filePath = path.join(dataPath, "settings.json");
    this.settings = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const saved = JSON.parse(raw);
        this.settings = { ...DEFAULTS, ...saved };
      }
    } catch {
      this.settings = { ...DEFAULTS };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf8");
    } catch (err) {
      // Use console directly since logger might not be initialized during config construction
      console.error("[Javas] Failed to save settings:", err.message);
    }
  }

  get(key) {
    return this.settings[key] ?? DEFAULTS[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this._save();
  }

  getAll() {
    return { ...this.settings };
  }

  update(partial) {
    Object.assign(this.settings, partial);
    this._save();
  }

  getApiKey(provider) {
    const keyMap = {
      openai: "openaiApiKey",
      anthropic: "anthropicApiKey",
      gemini: "geminiApiKey",
      groq: "groqApiKey",
    };
    return this.settings[keyMap[provider]] || "";
  }

  setApiKey(provider, key) {
    const keyMap = {
      openai: "openaiApiKey",
      anthropic: "anthropicApiKey",
      gemini: "geminiApiKey",
      groq: "groqApiKey",
    };
    if (keyMap[provider]) {
      this.settings[keyMap[provider]] = key;
      this._save();
    }
  }
}

module.exports = JavasConfig;
