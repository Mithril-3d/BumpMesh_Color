import http.server
import os
import socketserver
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox
import webbrowser

PORT = 8000
HOST = "localhost"
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

THEMES = {
    "dark": {
        "bg": "#18181b",
        "card_bg": "#27272a",
        "border": "#3f3f46",
        "text": "#f4f4f5",
        "sub_text": "#a1a1aa",
        "url": "#60a5fa",
        "btn_primary_bg": "#2563eb",
        "btn_primary_hover": "#1d4ed8",
        "btn_stop_bg": "#dc2626",
        "btn_stop_hover": "#b91c1c",
        "btn_start_bg": "#16a34a",
        "btn_start_hover": "#15803d",
        "btn_sub_bg": "#3f3f46",
        "btn_sub_hover": "#52525b",
        "disabled_bg": "#27272a",
        "disabled_fg": "#71717a",
        "switch_btn_bg": "#3f3f46",
        "switch_btn_fg": "#f4f4f5",
    },
    "light": {
        "bg": "#f4f4f5",
        "card_bg": "#ffffff",
        "border": "#d4d4d8",
        "text": "#18181b",
        "sub_text": "#71717a",
        "url": "#2563eb",
        "btn_primary_bg": "#2563eb",
        "btn_primary_hover": "#1d4ed8",
        "btn_stop_bg": "#dc2626",
        "btn_stop_hover": "#b91c1c",
        "btn_start_bg": "#16a34a",
        "btn_start_hover": "#15803d",
        "btn_sub_bg": "#e4e4e7",
        "btn_sub_hover": "#d4d4d8",
        "disabled_bg": "#e4e4e7",
        "disabled_fg": "#a1a1aa",
        "switch_btn_bg": "#e4e4e7",
        "switch_btn_fg": "#18181b",
    },
}


class DualStackServer(socketserver.TCPServer):
    allow_reuse_address = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        pass


class ServerManager:
    def __init__(self, port=PORT):
        self.port = port
        self.httpd = None
        self.thread = None
        self.is_running = False

    def find_available_port(self, start_port=8000):
        import socket
        port = start_port
        while port < 65535:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex((HOST, port)) != 0:
                    return port
                port += 1
        return start_port

    def start(self):
        if self.is_running:
            return True, f"http://{HOST}:{self.port}"

        try:
            self.port = self.find_available_port(self.port)
            self.httpd = DualStackServer((HOST, self.port), Handler)
            self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
            self.thread.start()
            self.is_running = True
            return True, f"http://{HOST}:{self.port}"
        except Exception as e:
            self.is_running = False
            return False, str(e)

    def stop(self):
        if not self.is_running:
            return
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        self.is_running = False

    def restart(self):
        self.stop()
        time.sleep(0.5)
        return self.start()


class FlatThemeButton(tk.Frame):
    """OS依存のAquaテーマ上書きを完全に回避する純色フラットボタン"""
    def __init__(self, parent, text, command, bg_color="#2563eb", hover_color="#1d4ed8", fg_color="#ffffff", font=("Helvetica", 11, "bold")):
        super().__init__(parent, bg=bg_color, cursor="hand2")
        self.command = command
        self.normal_bg = bg_color
        self.hover_bg = hover_color
        self.fg_color = fg_color
        self.is_disabled = False

        self.label = tk.Label(
            self,
            text=text,
            fg=fg_color,
            bg=bg_color,
            font=font,
            cursor="hand2",
            padx=12,
            pady=7
        )
        self.label.pack(fill=tk.BOTH, expand=True)

        for widget in (self, self.label):
            widget.bind("<Button-1>", self._on_click)
            widget.bind("<Enter>", self._on_enter)
            widget.bind("<Leave>", self._on_leave)

    def _on_click(self, event):
        if not self.is_disabled and self.command:
            self.command()

    def _on_enter(self, event):
        if not self.is_disabled:
            self.configure(bg=self.hover_bg)
            self.label.configure(bg=self.hover_bg)

    def _on_leave(self, event):
        if not self.is_disabled:
            self.configure(bg=self.normal_bg)
            self.label.configure(bg=self.normal_bg)

    def set_text(self, text):
        self.label.configure(text=text)

    def set_colors(self, bg_color, hover_color, fg_color=None):
        self.normal_bg = bg_color
        self.hover_bg = hover_color
        if fg_color:
            self.fg_color = fg_color
        if not self.is_disabled:
            self.configure(bg=bg_color)
            self.label.configure(bg=bg_color, fg=self.fg_color)

    def set_state(self, enabled=True, disabled_bg="#27272a", disabled_fg="#71717a"):
        self.is_disabled = not enabled
        if self.is_disabled:
            self.configure(bg=disabled_bg, cursor="arrow")
            self.label.configure(bg=disabled_bg, fg=disabled_fg, cursor="arrow")
        else:
            self.configure(bg=self.normal_bg, cursor="hand2")
            self.label.configure(bg=self.normal_bg, fg=self.fg_color, cursor="hand2")


class LauncherApp:
    def __init__(self, root):
        self.root = root
        self.root.title("BumpMesh Launcher")
        self.root.geometry("480x330")
        self.root.resizable(False, False)

        # macOS で Dark Appearance を強制（Aqua の白浮き・グレー混ざり防止）
        try:
            self.root.tk.call("set", "::tk::mac::useDarkAppearance", "1")
        except Exception:
            pass

        # デフォルトは強制ダークモード（混ざりを完全防止）
        self.current_theme_name = "dark"
        self.t = THEMES[self.current_theme_name]

        self.root.configure(bg=self.t["bg"])
        self.server = ServerManager()

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # 起動時に自動でサーバー起動＆ブラウザ表示
        self.root.after(100, self.auto_start)

    def _build_ui(self):
        self.main_frame = tk.Frame(self.root, bg=self.t["bg"], padx=22, pady=18)
        self.main_frame.pack(fill=tk.BOTH, expand=True)

        # ヘッダーコンテナ（タイトル + テーマ切り替え）
        header_frame = tk.Frame(self.main_frame, bg=self.t["bg"])
        header_frame.pack(fill=tk.X, pady=(0, 2))

        self.title_label = tk.Label(
            header_frame,
            text="BumpMesh Launcher",
            font=("Helvetica", 18, "bold"),
            fg=self.t["text"],
            bg=self.t["bg"]
        )
        self.title_label.pack(side=tk.LEFT)

        # 強制テーマ切替ボタン（ダーク／ライト完全統一）
        self.theme_btn = FlatThemeButton(
            header_frame,
            text="🌙 ダーク固定中",
            command=self.toggle_theme,
            bg_color=self.t["switch_btn_bg"],
            hover_color=self.t["border"],
            fg_color=self.t["switch_btn_fg"],
            font=("Helvetica", 9, "bold")
        )
        self.theme_btn.pack(side=tk.RIGHT)

        self.subtitle = tk.Label(
            self.main_frame,
            text="ローカルサーバー管理 & ブラウザ起動ツール (色混ざり防止・統一テーマ)",
            font=("Helvetica", 10),
            fg=self.t["sub_text"],
            bg=self.t["bg"]
        )
        self.subtitle.pack(anchor="w", pady=(0, 14))

        # ステータスカード
        self.status_card = tk.Frame(
            self.main_frame,
            bg=self.t["card_bg"],
            padx=14,
            pady=12,
            highlightthickness=1,
            highlightbackground=self.t["border"]
        )
        self.status_card.pack(fill=tk.X, pady=(0, 16))

        self.status_row = tk.Frame(self.status_card, bg=self.t["card_bg"])
        self.status_row.pack(fill=tk.X)

        self.indicator_canvas = tk.Canvas(self.status_row, width=14, height=14, bg=self.t["card_bg"], highlightthickness=0)
        self.indicator_canvas.pack(side=tk.LEFT, padx=(0, 8))
        self.indicator_dot = self.indicator_canvas.create_oval(2, 2, 12, 12, fill="#ef4444", outline="")

        self.status_label = tk.Label(
            self.status_row,
            text="サーバー停止中",
            font=("Helvetica", 11, "bold"),
            fg=self.t["text"],
            bg=self.t["card_bg"]
        )
        self.status_label.pack(side=tk.LEFT)

        self.url_label = tk.Label(
            self.status_card,
            text="URL: -",
            font=("Courier", 11),
            fg=self.t["url"],
            bg=self.t["card_bg"],
            cursor="hand2"
        )
        self.url_label.pack(anchor="w", pady=(6, 0))
        self.url_label.bind("<Button-1>", lambda e: self.open_browser())

        # ボタンエリア
        # 1. ブラウザで開く
        self.btn_open = FlatThemeButton(
            self.main_frame,
            text="🌐 ブラウザで BumpMesh を開く",
            command=self.open_browser,
            bg_color=self.t["btn_primary_bg"],
            hover_color=self.t["btn_primary_hover"],
            font=("Helvetica", 11, "bold")
        )
        self.btn_open.pack(fill=tk.X, pady=(0, 10))

        # 2. 停止 / 起動 & 再起動
        self.sub_btn_frame = tk.Frame(self.main_frame, bg=self.t["bg"])
        self.sub_btn_frame.pack(fill=tk.X)

        self.btn_toggle = FlatThemeButton(
            self.sub_btn_frame,
            text="⏹ サーバー停止",
            command=self.toggle_server,
            bg_color=self.t["btn_stop_bg"],
            hover_color=self.t["btn_stop_hover"],
            font=("Helvetica", 10, "bold")
        )
        self.btn_toggle.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 5))

        self.btn_restart = FlatThemeButton(
            self.sub_btn_frame,
            text="🔄 再起動",
            command=self.restart_server,
            bg_color=self.t["btn_sub_bg"],
            hover_color=self.t["btn_sub_hover"],
            font=("Helvetica", 10, "bold")
        )
        self.btn_restart.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(5, 0))

    def toggle_theme(self):
        new_theme = "light" if self.current_theme_name == "dark" else "dark"
        self.current_theme_name = new_theme
        self.t = THEMES[new_theme]

        # macOS appearance 設定更新
        try:
            val = "0" if new_theme == "light" else "1"
            self.root.tk.call("set", "::tk::mac::useDarkAppearance", val)
        except Exception:
            pass

        self._apply_theme()

    def _apply_theme(self):
        t = self.t
        self.root.configure(bg=t["bg"])
        self.main_frame.configure(bg=t["bg"])
        self.title_label.configure(bg=t["bg"], fg=t["text"])
        self.subtitle.configure(bg=t["bg"], fg=t["sub_text"])

        btn_text = "🌙 ダーク固定中" if self.current_theme_name == "dark" else "☀️ ライト固定中"
        self.theme_btn.set_text(btn_text)
        self.theme_btn.set_colors(t["switch_btn_bg"], t["border"], t["switch_btn_fg"])

        self.status_card.configure(bg=t["card_bg"], highlightbackground=t["border"])
        self.status_row.configure(bg=t["card_bg"])
        self.indicator_canvas.configure(bg=t["card_bg"])
        self.status_label.configure(bg=t["card_bg"])
        self.url_label.configure(bg=t["card_bg"], fg=t["url"])

        self.sub_btn_frame.configure(bg=t["bg"])
        self.btn_open.set_colors(t["btn_primary_bg"], t["btn_primary_hover"], "#ffffff")
        self.btn_restart.set_colors(t["btn_sub_bg"], t["btn_sub_hover"], t["text"])

        # サーバー状態に応じた更新
        self._update_status(self.server.is_running, f"http://{HOST}:{self.server.port}" if self.server.is_running else "")

    def auto_start(self):
        ok, res = self.server.start()
        if ok:
            self._update_status(True, res)
            webbrowser.open(res)
        else:
            self._update_status(False)
            messagebox.showerror("起動エラー", f"サーバー起動に失敗しました:\n{res}")

    def _update_status(self, is_running, url=""):
        t = self.t
        if is_running:
            self.indicator_canvas.itemconfig(self.indicator_dot, fill="#22c55e")
            self.status_label.config(text="サーバー稼働中", fg="#22c55e")
            self.url_label.config(text=f"URL: {url}")
            self.btn_toggle.set_text("⏹ サーバー停止")
            self.btn_toggle.set_colors(t["btn_stop_bg"], t["btn_stop_hover"], "#ffffff")
            self.btn_open.set_state(True)
            self.btn_restart.set_state(True, disabled_bg=t["disabled_bg"], disabled_fg=t["disabled_fg"])
        else:
            self.indicator_canvas.itemconfig(self.indicator_dot, fill="#ef4444")
            self.status_label.config(text="サーバー停止中", fg=t["text"])
            self.url_label.config(text="URL: -")
            self.btn_toggle.set_text("▶ サーバー起動")
            self.btn_toggle.set_colors(t["btn_start_bg"], t["btn_start_hover"], "#ffffff")
            self.btn_open.set_state(False, disabled_bg=t["disabled_bg"], disabled_fg=t["disabled_fg"])
            self.btn_restart.set_state(False, disabled_bg=t["disabled_bg"], disabled_fg=t["disabled_fg"])

    def toggle_server(self):
        if self.server.is_running:
            self.server.stop()
            self._update_status(False)
        else:
            ok, res = self.server.start()
            if ok:
                self._update_status(True, res)
            else:
                messagebox.showerror("エラー", f"起動に失敗しました:\n{res}")

    def restart_server(self):
        ok, res = self.server.restart()
        if ok:
            self._update_status(True, res)
        else:
            messagebox.showerror("エラー", f"再起動に失敗しました:\n{res}")

    def open_browser(self):
        if self.server.is_running:
            url = f"http://{HOST}:{self.server.port}"
            webbrowser.open(url)

    def on_close(self):
        self.server.stop()
        self.root.destroy()
        sys.exit(0)


def main():
    root = tk.Tk()
    app = LauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
