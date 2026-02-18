const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow } = require("electron");

const plugins = new Map();

function getPluginsDir() {
  // In development: project root/plugins
  // In production: resources/plugins (unpacked from asar)
  const isDev = process.env.NODE_ENV === "development" || process.defaultApp;
  if (isDev) {
    return path.join(__dirname, "..", "..", "plugins");
  }
  return path.join(process.resourcesPath, "plugins");
}

function loadAll(api) {
  const pluginsDir = getPluginsDir();

  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    return;
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(pluginsDir, entry.name);
    const indexPath = path.join(pluginDir, "index.js");

    if (!fs.existsSync(indexPath)) continue;

    try {
      const plugin = require(indexPath);

      if (!plugin.name || typeof plugin.activate !== "function") {
        console.warn(`[PluginLoader] Skipping ${entry.name}: missing name or activate()`);
        continue;
      }

      const pluginDataPath = path.join(app.getPath("userData"), "plugins", plugin.name);
      fs.mkdirSync(pluginDataPath, { recursive: true });

      const pluginApi = {
        ...api,
        pluginDataPath,
        pluginDir,
      };

      plugin.activate(pluginApi);
      plugins.set(plugin.name, { plugin, pluginDir, pluginDataPath });

      console.log(`[PluginLoader] Loaded plugin: ${plugin.displayName || plugin.name}`);
    } catch (err) {
      console.error(`[PluginLoader] Failed to load plugin ${entry.name}:`, err.message);
    }
  }

  // Register IPC handler for renderer to query loaded plugins
  ipcMain.handle("get-plugin-list", () => {
    return Array.from(plugins.entries()).map(([name, { plugin, pluginDir }]) => ({
      name,
      displayName: plugin.displayName || name,
      icon: plugin.icon || null,
      hasSettings: typeof plugin.getSettingsPanel === "function",
      settingsPanel: plugin.getSettingsPanel ? plugin.getSettingsPanel() : null,
      pluginDir,
    }));
  });
}

function unloadAll() {
  for (const [name, { plugin }] of plugins) {
    try {
      if (typeof plugin.deactivate === "function") {
        plugin.deactivate();
      }
      console.log(`[PluginLoader] Unloaded plugin: ${name}`);
    } catch (err) {
      console.error(`[PluginLoader] Error unloading ${name}:`, err.message);
    }
  }
  plugins.clear();
}

function getPlugin(name) {
  const entry = plugins.get(name);
  return entry ? entry.plugin : null;
}

module.exports = { loadAll, unloadAll, getPlugin, getPluginsDir };
