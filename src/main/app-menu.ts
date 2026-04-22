import { app, BrowserWindow, Menu, MenuItem, MenuItemWithRole } from "@mobrowser/api"

function setLocationHash(win: BrowserWindow, hash: string) {
  const normalized = hash.startsWith("#") ? hash : `#${hash}`
  try {
    const next = new URL(app.url)
    next.hash = normalized
    win.browser.loadUrl(next.toString())
  } catch {
    const base = app.url.split("#")[0] ?? app.url
    win.browser.loadUrl(`${base}${normalized}`)
  }
}

export function installApplicationMenu(win: BrowserWindow): void {
  app.setMenu(
    new Menu({
      items: [
        new Menu({
          label: "文件",
          items: [
            new MenuItem({
              id: "welcome",
              label: "欢迎使用",
              action: () => setLocationHash(win, "#/"),
            }),
            "separator",
            new MenuItemWithRole({ role: "quit" }),
          ],
        }),
        new Menu({
          label: "编辑",
          items: [
            new MenuItemWithRole({ role: "undo" }),
            new MenuItemWithRole({ role: "redo" }),
            "separator",
            new MenuItemWithRole({ role: "cut" }),
            new MenuItemWithRole({ role: "copy" }),
            new MenuItemWithRole({ role: "paste" }),
            "separator",
            new MenuItemWithRole({ role: "selectAll" }),
          ],
        }),
        new Menu({
          label: "帮助",
          items: [
            new MenuItem({
              id: "about",
              label: "关于 EasyAnnotate",
              action: () => {
                void app.showMessageDialog({
                  parentWindow: win,
                  type: "info",
                  title: "关于 EasyAnnotate",
                  message: "EasyAnnotate — 桌面标注工具",
                  informativeText: "基于 MōBrowser、Vite、React 19 与 shadcn/ui。",
                  buttons: [{ label: "确定", type: "primary" }],
                })
              },
            }),
          ],
        }),
      ],
    }),
  )
}
