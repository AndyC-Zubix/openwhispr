const https = require("https");
const log = require("./javasLogger");

class JavasTtsManager {
  constructor(sendToRenderer) {
    this.sendToRenderer = sendToRenderer;
  }

  async speak(text, config) {
    if (!text) return;

    const provider = config.ttsProvider || "web-speech";
    log.info("TTS speak via", provider, ":", text.slice(0, 100));

    if (provider === "openai-tts") {
      await this.speakOpenAI(text, config);
    } else {
      this.speakWebSpeech(text);
    }
  }

  speakWebSpeech(text) {
    log.info("Sending to renderer for Web Speech API");
    this.sendToRenderer("plugin:javas:speak-web-speech", { text });
  }

  async speakOpenAI(text, config) {
    const apiKey = config.openaiApiKey;
    if (!apiKey) {
      // Fallback to web speech if no API key
      this.speakWebSpeech(text);
      return;
    }

    const voice = config.ttsVoice || "alloy";

    try {
      const audioBuffer = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          model: "tts-1",
          input: text,
          voice,
          response_format: "mp3",
        });

        const req = https.request(
          {
            hostname: "api.openai.com",
            path: "/v1/audio/speech",
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
            },
          },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              if (res.statusCode >= 400) {
                reject(new Error(`OpenAI TTS error: ${res.statusCode}`));
              } else {
                resolve(Buffer.concat(chunks));
              }
            });
          }
        );

        req.on("error", reject);
        req.write(postData);
        req.end();
      });

      // Send audio buffer to renderer for playback
      this.sendToRenderer("plugin:javas:play-audio", {
        buffer: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
      });
    } catch (err) {
      log.error("OpenAI TTS error:", err.message, "- falling back to Web Speech");
      // Fallback to web speech
      this.speakWebSpeech(text);
    }
  }
}

module.exports = JavasTtsManager;
