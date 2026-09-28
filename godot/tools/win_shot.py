# -*- coding: utf-8 -*-
# Windows 全屏截图（ctypes BitBlt，零依赖）—— 验证游戏窗口实际内容是否居中。
# 用法：python win_shot.py <输出.png>
import ctypes
import ctypes.wintypes as wt
import sys

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

OutPath = sys.argv[1] if len(sys.argv) > 1 else "win_shot.png"

w = user32.GetSystemMetrics(0)
h = user32.GetSystemMetrics(1)
hwnd_desktop = user32.GetDesktopWindow()
hdc = user32.GetWindowDC(hwnd_desktop)
mfc = gdi32.CreateCompatibleDC(hdc)
bitmap = gdi32.CreateCompatibleBitmap(hdc, w, h)
gdi32.SelectObject(mfc, bitmap)
gdi32.BitBlt(mfc, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)  # SRCCOPY

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]

bi = BITMAPINFOHEADER()
bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bi.biWidth = w
bi.biHeight = -h  # top-down
bi.biPlanes = 1
bi.biBitCount = 32
bi.biCompression = 0

buf = ctypes.create_string_buffer(w * h * 4)
gdi32.GetDIBits(mfc, bitmap, 0, h, buf, ctypes.byref(bi), 0)

# 写 PNG（纯手写最小 PNG：zlib + struct，无需 PIL）
import zlib
import struct

raw = b"".join(
    b"\x00" + buf[(y * w + x) * 4: (y * w + x) * 4 + 3]
    for y in range(h)
    for x in range(0, w)  # BGRA→RGB 每行拼（filter 0）
)


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 6))
png += chunk(b"IEND", b"")
with open(OutPath, "wb") as f:
    f.write(png)

gdi32.DeleteObject(bitmap)
gdi32.DeleteDC(mfc)
user32.ReleaseDC(hwnd_desktop, hdc)
print("SAVED %s (%dx%d)" % (OutPath, w, h))
