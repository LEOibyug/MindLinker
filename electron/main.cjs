const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const runtimeLogRetentionMs = 7 * 24 * 60 * 60 * 1000;

const getRuntimeLogDir = () => path.join(app.getPath("userData"), "runtime-logs");

const getRuntimeLogPath = (date = new Date()) => {
  const day = date.toISOString().slice(0, 10);
  return path.join(getRuntimeLogDir(), `${day}.log`);
};

const pruneRuntimeLogs = async () => {
  try {
    await fs.mkdir(getRuntimeLogDir(), { recursive: true });
    const entries = await fs.readdir(getRuntimeLogDir(), { withFileTypes: true });
    const cutoff = Date.now() - runtimeLogRetentionMs;
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
        .map(async (entry) => {
          const filePath = path.join(getRuntimeLogDir(), entry.name);
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoff) {
            await fs.unlink(filePath);
          }
        })
    );
  } catch (error) {
    console.error("[MindLinker] Failed to prune runtime logs", error);
  }
};

const registerRuntimeLogHandlers = () => {
  ipcMain.handle("runtime-log:append", async (_event, entry) => {
    try {
      await fs.mkdir(getRuntimeLogDir(), { recursive: true });
      await pruneRuntimeLogs();
      const filePath = getRuntimeLogPath();
      await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
      return { ok: true, path: filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("runtime-log:read", async () => {
    try {
      const filePath = getRuntimeLogPath();
      const text = await fs.readFile(filePath, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return "";
        }
        throw error;
      });
      const entries = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { ok: true, path: filePath, entries };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("runtime-log:clear", async () => {
    try {
      await fs.rm(getRuntimeLogDir(), { recursive: true, force: true });
      await fs.mkdir(getRuntimeLogDir(), { recursive: true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "MindLinker",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  win.loadFile(path.join(__dirname, "../dist/index.html"));
};

app.whenReady().then(() => {
  registerRuntimeLogHandlers();
  void pruneRuntimeLogs();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
