import { app, BrowserWindow, ipc, Theme } from '@mobrowser/api';
import { Person } from './gen/greet';
import { SelectDirectoryRequest, SetThemeRequest } from './gen/app';
import { GreetService, AppService } from './gen/ipc_service';
import { installApplicationMenu } from "./app-menu";

// Create a new window.
const win = new BrowserWindow()
installApplicationMenu(win)
win.browser.loadUrl(app.url)
win.setSize({ width: 800, height: 650 })
win.setWindowTitleVisible(false)
win.setWindowTitlebarVisible(false)
win.centerWindow()
win.show()

// Handle the IPC calls from the renderer process.
ipc.registerService(GreetService({
  async SayHello(person: Person) {
    return { value: `Hello, ${person.name}!` };
  },
}))

ipc.registerService(AppService({
  async SetTheme(request: SetThemeRequest) {
    app.setTheme(request.theme as Theme);
    return {};
  },
  async MinimizeWindow(_request) {
    win.minimize()
    return {}
  },
  async ToggleMaximizeWindow(_request) {
    if (win.isMaximized) {
      win.restore()
    } else {
      win.maximize()
    }
    return { isMaximized: win.isMaximized }
  },
  async CloseWindow(_request) {
    win.close()
    return {}
  },
  async GetWindowState(_request) {
    return { isMaximized: win.isMaximized }
  },
  async SelectDirectory(request: SelectDirectoryRequest) {
    try {
      const result = await app.showOpenDialog({
        parentWindow: win,
        title: request.title || "选择目录",
        ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
        selectionPolicy: "directories",
        features: {
          allowMultiple: false,
          canCreateDirectories: true,
        },
      })
      return {
        canceled: result.canceled,
        path: result.paths[0] ?? "",
        errorMessage: "",
      }
    } catch (error) {
      return {
        canceled: true,
        path: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
}))
