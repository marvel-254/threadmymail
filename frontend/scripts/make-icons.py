#!/usr/bin/env python3
"""
Rasterise the Millo mark into the PWA icon set.

Pure stdlib: no new npm dependency, no headless browser, and analytic
anti-aliasing rather than supersampling.

Coverage comes from the signed distance field directly:
    coverage = clamp(0.5 - d, 0, 1)
One sample per pixel, exact to within a pixel, and ~16x cheaper than
rendering 4x4 and box-filtering.

The mark is traced from the 32-unit viewBox in components/MilloMark.jsx. The
alpha of the envelope body is raised well above the 0.22 used in-app: on a
transparent UI the mark has other pixels behind it to read against, but on a
16px favicon it is the only thing there is.
"""

import struct
import zlib

# ── Silk palette, from styles/silk.css ─────────────────────────────────────
SURFACE_LO = (0x06, 0x0E, 0x20)   # --surface-lowest
SURFACE_HI = (0x13, 0x1B, 0x2E)   # #131b2e, second most common in the designs
PIGMENT_LO = (0xC0, 0xC1, 0xFF)   # --primary, lavender
PIGMENT_HI = (0x63, 0x66, 0xF1)   # indigo
FLAP       = (0xE8, 0xEA, 0xFF)   # near-white lavender
PULSE      = (0x7B, 0xD0, 0xFF)   # --tertiary, cyan


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def sdf_round_rect(px, py, cx, cy, hw, hh, r):
    """Signed distance to a rounded rectangle. Negative inside."""
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return (ax * ax + ay * ay) ** 0.5 + min(max(qx, qy), 0.0) - r


def sdf_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else clamp((wx * vx + wy * vy) / L2)
    dx, dy = wx - t * vx, wy - t * vy
    return (dx * dx + dy * dy) ** 0.5


def sdf_polyline(px, py, pts):
    d = float('inf')
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        d = min(d, sdf_segment(px, py, ax, ay, bx, by))
    return d


def over(dst, src, alpha):
    """src-over composite of a straight colour onto dst at `alpha`."""
    inv = 1.0 - alpha
    return (
        src[0] * alpha + dst[0] * inv,
        src[1] * alpha + dst[1] * inv,
        src[2] * alpha + dst[2] * inv,
    )


def render(size, mark_scale, radius_frac=None, background=True):
    """
    size         output edge in px
    mark_scale   the 32-unit viewBox mapped to this fraction of the canvas
    radius_frac  corner radius as a fraction of size; None = full bleed square
    """
    buf = bytearray(size * size * 4)
    s = size / 32.0 * mark_scale
    # Centre the 32-unit mark in the canvas.
    ox = (size - 32.0 * s) / 2.0
    oy = ox

    def P(x, y):
        return (ox + x * s, oy + y * s)

    # Mark geometry in viewBox units.
    body_cx, body_cy = P(16.0, 16.5)
    body_hw, body_hh = 26.0 * s / 2.0, 17.0 * s / 2.0
    body_r = 4.0 * s
    flap = [P(4.5, 10.5), P(16, 18.5), P(27.5, 10.5)]
    flap_hw = 1.15 * s
    pulse = [P(21, 4.5), P(23.5, 4.5), P(24.7, 7.5), P(25.9, 4.5), P(28, 4.5)]
    pulse_hw = 0.95 * s
    # Gradient axis, matching the SVG's x1=0 y1=0 -> x2=1 y2=1 in object bbox.
    gx0, gy0 = P(3, 8)
    gx1, gy1 = P(29, 25)
    gdx, gdy = gx1 - gx0, gy1 - gy0
    gL2 = gdx * gdx + gdy * gdy

    outer_r = size * radius_frac if radius_frac is not None else 0.0
    outer_hw = size / 2.0

    for y in range(size):
        fy = y + 0.5
        row = y * size * 4
        for x in range(size):
            fx = x + 0.5

            # ── background ──
            if background:
                a = 1.0
                if radius_frac is not None:
                    a = clamp(0.5 - sdf_round_rect(fx, fy, size / 2.0, size / 2.0,
                                                    outer_hw, outer_hw, outer_r))
            else:
                a = 0.0

            # Projection onto the SVG's x1=0,y1=0 -> x2=1,y2=1 gradient axis,
            # used for both the background wash and the envelope fill.
            tb = clamp(((fx - gx0) * gdx + (fy - gy0) * gdy) / gL2)
            col = (
                SURFACE_LO[0] + (SURFACE_HI[0] - SURFACE_LO[0]) * tb,
                SURFACE_LO[1] + (SURFACE_HI[1] - SURFACE_LO[1]) * tb,
                SURFACE_LO[2] + (SURFACE_HI[2] - SURFACE_LO[2]) * tb,
            )

            # ── envelope body ──
            c = clamp(0.5 - sdf_round_rect(fx, fy, body_cx, body_cy, body_hw, body_hh, body_r))
            if c > 0:
                body = (
                    PIGMENT_LO[0] + (PIGMENT_HI[0] - PIGMENT_LO[0]) * tb,
                    PIGMENT_LO[1] + (PIGMENT_HI[1] - PIGMENT_LO[1]) * tb,
                    PIGMENT_LO[2] + (PIGMENT_HI[2] - PIGMENT_LO[2]) * tb,
                )
                col = over(col, body, c * 0.92)

            # ── flap ──
            c = clamp(0.5 - (sdf_polyline(fx, fy, flap) - flap_hw))
            if c > 0:
                col = over(col, FLAP, c * 0.95)

            # ── pulse ──
            c = clamp(0.5 - (sdf_polyline(fx, fy, pulse) - pulse_hw))
            if c > 0:
                col = over(col, PULSE, c)

            o = row + x * 4
            buf[o] = int(clamp(col[0], 0, 255))
            buf[o + 1] = int(clamp(col[1], 0, 255))
            buf[o + 2] = int(clamp(col[2], 0, 255))
            buf[o + 3] = int(clamp(a, 0, 1) * 255)

    return buf


def png_bytes(size, rgba, rgb=False):
    ch = 3 if rgb else 4
    raw = bytearray()
    stride = size * ch
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2 if rgb else 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def ico_bytes(entries):
    """entries: list of (size, png_data)."""
    n = len(entries)
    out = bytearray(struct.pack('<HHH', 0, 1, n))
    off = 6 + 16 * n
    body = bytearray()
    for size, data in entries:
        dim = 0 if size >= 256 else size
        out += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), off)
        body += data
        off += len(data)
    return bytes(out + body)


# ── Emit ───────────────────────────────────────────────────────────────────
#
# Mark scale per purpose:
#   any        0.72  fills the tile; the browser may round or mask it freely
#   maskable   0.52  the launcher crops to a circle of 80% diameter, so the
#                    mark has to fit inside that, not inside the square
#   apple      0.66  iOS applies its own squircle, so full bleed is correct
#   favicon    0.80  a tab is ~16px; the mark must be as large as it can be

def main():
    import os
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
    os.makedirs(out, exist_ok=True)
    written = []

    def emit(name, data):
        path = os.path.join(out, name)
        with open(path, 'wb') as fh:
            fh.write(data)
        written.append((name, len(data)))

    for size in (192, 512):
        rgba = render(size, 0.72)
        emit(f'pwa-{size}x{size}.png', png_bytes(size, rgba))
    for size in (192, 512):
        rgba = render(size, 0.52)
        emit(f'pwa-{size}x{size}-maskable.png', png_bytes(size, rgba))

    rgba = render(180, 0.66)
    emit('apple-touch-icon.png', png_bytes(180, rgba))

    # A rounded dark tile, not full bleed: tab strips draw the favicon
    # themselves and an unrounded square reads as a broken image.
    entries = []
    for size in (16, 32, 48):
        rgba = render(size, 0.80, radius_frac=0.22)
        entries.append((size, png_bytes(size, rgba)))
    emit('favicon.ico', ico_bytes(entries))

    for name, n in written:
        print(f'  {name:32} {n:>7} bytes')


if __name__ == '__main__':
    main()
