"""Generate Booklog's app icons as PNGs using only the Python standard library.
Run:  python3 tools/make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(__file__), '..', 'icons')
BG = (196, 85, 58)          # terracotta
SPINES = [(246, 241, 231), (224, 165, 38), (47, 111, 98)]  # cream, gold, green
SS = 3  # supersampling for smooth edges


def write_png(path, w, h, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shapes(size, corner, scale):
    """Return list of (test_fn, color) in paint order. Coordinates in 0..1 space."""
    s = scale
    off = (1 - s) / 2
    def T(v):
        return off + v * s
    out = []
    if corner is not None:
        out.append((lambda x, y: in_round_rect(x, y, 0, 0, 1, 1, corner), BG))
    else:
        out.append((lambda x, y: True, BG))
    # three books on a shelf
    books = [  # x0, x1, top, color
        (0.22, 0.36, 0.24, SPINES[0]),
        (0.38, 0.52, 0.30, SPINES[1]),
    ]
    for x0, x1, top, col in books:
        out.append((lambda x, y, a=T(x0), b=T(x1), t=T(top): in_round_rect(x, y, a, t, b, T(0.76), 0.02 * s), col))
    # leaning book (rotated rect)
    import math
    ang = math.radians(-16)
    cx, cy = T(0.66), T(0.52)
    hw, hh = 0.07 * s, 0.25 * s
    def lean(x, y):
        dx, dy = x - cx, y - cy
        rx = dx * math.cos(ang) + dy * math.sin(ang)
        ry = -dx * math.sin(ang) + dy * math.cos(ang)
        return abs(rx) <= hw and abs(ry) <= hh and y <= T(0.76)
    out.append((lean, SPINES[2]))
    # spine bands
    for x0, x1, top, _ in books:
        out.append((lambda x, y, a=T(x0), b=T(x1), t=T(top): a <= x <= b and t + 0.08 * s <= y <= t + 0.11 * s, (0, 0, 0, 40)))
    # shelf
    out.append((lambda x, y: in_round_rect(x, y, T(0.16), T(0.76), T(0.84), T(0.81), 0.02 * s), (246, 241, 231)))
    return out


def render(size, corner=0.22, scale=1.0, transparent_outside=True):
    sh = shapes(size, corner, scale)
    px = [0] * (size * size * 4)
    n = SS * SS
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    fx = (x + (sx + .5) / SS) / size
                    fy = (y + (sy + .5) / SS) / size
                    r = g = b = a = 0.0
                    for test, col in sh:
                        if test(fx, fy):
                            ca = (col[3] / 255) if len(col) == 4 else 1.0
                            r = r * (1 - ca) + col[0] * ca
                            g = g * (1 - ca) + col[1] * ca
                            b = b * (1 - ca) + col[2] * ca
                            a = a * (1 - ca) + 255 * ca
                    acc[0] += r; acc[1] += g; acc[2] += b; acc[3] += a
            i = (y * size + x) * 4
            alpha = acc[3] / n
            if alpha > 0:
                px[i:i + 4] = [min(255, int(acc[0] / n * 255 / alpha)), min(255, int(acc[1] / n * 255 / alpha)), min(255, int(acc[2] / n * 255 / alpha)), int(alpha)]
    return px


def main():
    os.makedirs(ROOT, exist_ok=True)
    # Rounded icon for browsers / Android "any"
    for sz in (192, 512):
        write_png(os.path.join(ROOT, f'icon-{sz}.png'), sz, sz, render(sz, corner=0.22))
    # Full-bleed for iOS (iOS rounds the corners itself) and Android maskable (content within safe zone)
    write_png(os.path.join(ROOT, 'apple-touch-icon.png'), 180, 180, render(180, corner=None, scale=0.92))
    write_png(os.path.join(ROOT, 'icon-maskable-512.png'), 512, 512, render(512, corner=None, scale=0.78))
    print('icons written to', os.path.abspath(ROOT))


if __name__ == '__main__':
    main()
