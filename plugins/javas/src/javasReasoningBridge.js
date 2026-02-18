const https = require("https");
const http = require("http");
const { getSystemPrompt, buildUserPrompt } = require("./javasPrompts");
const log = require("./javasLogger");

class JavasReasoningBridge {
  constructor(config, managers) {
    this.config = config;
    this.managers = managers;
  }

  async processCommand(transcript) {
    const settings = this.config.getAll();
    const provider = settings.reasoningProvider || "local";
    const model = settings.reasoningModel || "";
    log.info("Processing command via provider:", provider, "model:", model || "(default)");
    const systemPrompt = getSystemPrompt(settings.customSystemPrompt);
    const userPrompt = buildUserPrompt(transcript, process.platform);
    log.debug("User prompt:", userPrompt.slice(0, 200));

    let responseText;

    switch (provider) {
      case "ollama":
        responseText = await this.processOllama(systemPrompt, userPrompt, model, settings);
        break;
      case "local":
        responseText = await this.processLocal(systemPrompt, userPrompt, model, settings);
        break;
      case "claude-max":
        responseText = await this.processClaudeMax(systemPrompt, userPrompt, model, settings);
        break;
      case "openai":
        responseText = await this.processOpenAI(systemPrompt, userPrompt, model, settings);
        break;
      case "anthropic":
        responseText = await this.processAnthropic(systemPrompt, userPrompt, model, settings);
        break;
      case "gemini":
        responseText = await this.processGemini(systemPrompt, userPrompt, model, settings);
        break;
      case "groq":
        responseText = await this.processGroq(systemPrompt, userPrompt, model, settings);
        break;
      case "custom":
        responseText = await this.processCustom(systemPrompt, userPrompt, model, settings);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    log.info("Raw LLM response length:", responseText?.length || 0);
    log.debug("Raw LLM response:", responseText?.slice(0, 500));
    return this.parseResponse(responseText);
  }

  parseResponse(text) {
    try {
      // Strip markdown code fences if present
      let clean = text.trim();
      if (clean.startsWith("```")) {
        clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      const parsed = JSON.parse(clean);
      const result = {
        action: parsed.action || "respond_only",
        params: parsed.params || {},
        speak: parsed.speak || "",
        explanation: parsed.explanation || "",
      };
      log.info("Parsed response -> action:", result.action, "speak:", result.speak);
      return result;
    } catch (e) {
      log.warn("JSON parse failed:", e.message, "- treating as spoken reply");
      log.debug("Failed to parse text:", text?.slice(0, 300));
      // If JSON parsing fails, treat the whole response as a spoken reply
      return {
        action: "respond_only",
        params: {},
        speak: text.trim().slice(0, 200),
        explanation: "Could not parse structured response",
      };
    }
  }

  // --- Provider implementations ---

  async processOllama(systemPrompt, userPrompt, model, settings) {
    const baseUrl = settings.ollamaUrl || "http://localhost:11434";
    const modelId = model || "qwen2.5:3b";
    log.info("Ollama request -> url:", baseUrl, "model:", modelId);

    return this._chatCompletionsRequest(
      baseUrl,
      "",
      modelId,
      systemPrompt,
      userPrompt,
      true // isHttp
    );
  }

  async processLocal(systemPrompt, userPrompt, model, _settings) {
    try {
      const LocalReasoningService = require("../../../src/services/localReasoningBridge").default;
      const result = await LocalReasoningService.processText(
        `${systemPrompt}\n\n${userPrompt}`,
        model,
        { temperature: 0.3, maxTokens: 1024 }
      );
      return result;
    } catch (err) {
      throw new Error(`Local LLM error: ${err.message}`);
    }
  }

  async processClaudeMax(systemPrompt, userPrompt, model, settings) {
    const port = settings.claudeMaxProxyPort || 3456;
    const modelId = model || "claude-sonnet-4-5-20250514";

    return this._chatCompletionsRequest(
      `http://localhost:${port}`,
      "",
      modelId,
      systemPrompt,
      userPrompt,
      true // isHttp (not https)
    );
  }

  async processOpenAI(systemPrompt, userPrompt, model, settings) {
    const apiKey = settings.openaiApiKey;
    if (!apiKey) throw new Error("OpenAI API key not configured for Javas");

    return this._chatCompletionsRequest(
      "https://api.openai.com",
      apiKey,
      model || "gpt-4o-mini",
      systemPrompt,
      userPrompt
    );
  }

  async processAnthropic(systemPrompt, userPrompt, model, settings) {
    const apiKey = settings.anthropicApiKey;
    if (!apiKey) throw new Error("Anthropic API key not configured for Javas");

    const modelId = model || "claude-sonnet-4-5-20250514";

    const postData = JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              if (data.error) reject(new Error(data.error.message));
              else resolve(data.content?.[0]?.text || "");
            } catch (e) {
              reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  async processGemini(systemPrompt, userPrompt, model, settings) {
    const apiKey = settings.geminiApiKey;
    if (!apiKey) throw new Error("Gemini API key not configured for Javas");

    const modelId = model || "gemini-2.5-flash-lite";

    const postData = JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "generativelanguage.googleapis.com",
          path: `/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              if (data.error) reject(new Error(data.error.message));
              else resolve(data.candidates?.[0]?.content?.parts?.[0]?.text || "");
            } catch (e) {
              reject(new Error(`Failed to parse Gemini response: ${e.message}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  async processGroq(systemPrompt, userPrompt, model, settings) {
    const apiKey = settings.groqApiKey;
    if (!apiKey) throw new Error("Groq API key not configured for Javas");

    return this._chatCompletionsRequest(
      "https://api.groq.com",
      apiKey,
      model || "llama-3.3-70b-versatile",
      systemPrompt,
      userPrompt
    );
  }

  async processCustom(systemPrompt, userPrompt, model, settings) {
    const url = settings.customEndpointUrl;
    if (!url) throw new Error("Custom endpoint URL not configured for Javas");

    return this._chatCompletionsRequest(
      url,
      settings.openaiApiKey || "",
      model || "default",
      systemPrompt,
      userPrompt,
      url.startsWith("http://")
    );
  }

  // Shared OpenAI-compatible chat completions helper
  _chatCompletionsRequest(baseUrl, apiKey, model, systemPrompt, userPrompt, isHttp = false) {
    const startTime = Date.now();
    const postData = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const parsed = new URL(`${baseUrl}/v1/chat/completions`);
    const transport = isHttp ? http : https;
    log.debug("HTTP request ->", parsed.href, "(model:", model, ")");

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttp ? 80 : 443),
          path: parsed.pathname,
          method: "POST",
          headers,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            const elapsed = Date.now() - startTime;
            log.info("HTTP response received in", elapsed, "ms (status:", res.statusCode, "body:", body.length, "bytes)");
            try {
              const data = JSON.parse(body);
              if (data.error) {
                log.error("API error:", JSON.stringify(data.error));
                reject(new Error(data.error.message || JSON.stringify(data.error)));
              } else {
                const content = data.choices?.[0]?.message?.content || "";
                log.debug("API response content:", content.slice(0, 300));
                resolve(content);
              }
            } catch (e) {
              log.error("Failed to parse response body:", body.slice(0, 500));
              reject(new Error(`Failed to parse response: ${e.message}`));
            }
          });
        }
      );
      req.on("error", (err) => {
        log.error("HTTP request error:", err.message);
        reject(err);
      });
      req.setTimeout(30000, () => {
        log.error("HTTP request timeout after 30s");
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.write(postData);
      req.end();
    });
  }
}

module.exports = JavasReasoningBridge;
