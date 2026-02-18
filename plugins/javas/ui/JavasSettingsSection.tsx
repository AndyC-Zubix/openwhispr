// This file is a reference implementation for the Javas settings UI.
// In the current plugin architecture, settings are rendered via the generic
// PluginSettingsPanel in SettingsPage.tsx, which communicates with the plugin
// via IPC (plugin:javas:get-settings, plugin:javas:update-settings).
//
// To use this as a standalone component, it would need to be bundled
// separately and loaded dynamically into the renderer process.
// For now, the generic plugin settings panel handles all communication.

export const JAVAS_SETTINGS_SCHEMA = {
  sections: [
    {
      title: "Voice Agent",
      fields: [
        { key: "enabled", type: "toggle", label: "Enable Javas", description: "Start listening for wake word" },
      ],
    },
    {
      title: "Picovoice Setup",
      showWhen: { key: "enabled", value: true },
      fields: [
        {
          key: "picovoiceAccessKey",
          type: "password",
          label: "Picovoice Access Key",
          description: "Get a free key at picovoice.ai/console",
          placeholder: "Enter your Picovoice Access Key",
        },
      ],
    },
    {
      title: "Wake Word Settings",
      showWhen: { key: "enabled", value: true },
      fields: [
        { key: "wakeSensitivity", type: "slider", label: "Sensitivity", min: 0.1, max: 0.9, step: 0.1 },
        { key: "silenceTimeout", type: "slider", label: "Silence Timeout (seconds)", min: 0.5, max: 5.0, step: 0.5 },
      ],
    },
    {
      title: "AI Provider",
      showWhen: { key: "enabled", value: true },
      fields: [
        {
          key: "reasoningProvider",
          type: "select",
          label: "Provider",
          options: [
            { value: "local", label: "Local LLM (Free)" },
            { value: "claude-max", label: "Claude Max Proxy (Free w/ subscription)" },
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
            { value: "gemini", label: "Google Gemini" },
            { value: "groq", label: "Groq" },
            { value: "custom", label: "Custom Endpoint" },
          ],
        },
        { key: "reasoningModel", type: "text", label: "Model", placeholder: "e.g., gpt-4o-mini, claude-sonnet-4-5" },
      ],
    },
    {
      title: "Text-to-Speech",
      showWhen: { key: "enabled", value: true },
      fields: [
        { key: "ttsEnabled", type: "toggle", label: "Enable spoken responses" },
        {
          key: "ttsProvider",
          type: "select",
          label: "TTS Provider",
          options: [
            { value: "web-speech", label: "Web Speech (Built-in, Free)" },
            { value: "openai-tts", label: "OpenAI TTS" },
          ],
        },
        {
          key: "ttsVoice",
          type: "select",
          label: "Voice",
          showWhen: { key: "ttsProvider", value: "openai-tts" },
          options: [
            { value: "alloy", label: "Alloy" },
            { value: "echo", label: "Echo" },
            { value: "fable", label: "Fable" },
            { value: "onyx", label: "Onyx" },
            { value: "nova", label: "Nova" },
            { value: "shimmer", label: "Shimmer" },
          ],
        },
      ],
    },
    {
      title: "Advanced",
      showWhen: { key: "enabled", value: true },
      fields: [
        { key: "customSystemPrompt", type: "textarea", label: "Custom System Prompt", placeholder: "Override the default agent prompt..." },
      ],
    },
  ],
};

export default JAVAS_SETTINGS_SCHEMA;
