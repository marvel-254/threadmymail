#!/usr/bin/env python3
"""Generate a visually rich animated intro video for ThreadMyMail.

720x1280 portrait, 10 seconds, 30 fps.
Features:
  - Aurora-style flowing colour waves
  - Rotating geometric constellation (hexagons, triangles)
  - Expanding pulse rings
  - Floating glowing particles with trails
  - Sweeping light streaks
  - Multi-scene text with zoom / slide / fade animations
  - Smooth easing throughout
"""

import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(42)  # reproducible

W, H = 720, 1280
FPS = 30
DURATION = 10
TOTAL = FPS * DURATION

# ── Easing ──────────────────────────────────────────────────────

def ease_out_cubic(t):
    return 1 - (1 - t) ** 3

def ease_in_out(t):
    return t * t * (3 - 2 * t)

def ease_out_elastic(t):
    if t <= 0: return 0
    if t >= 1: return 1
    return math.pow(2, -10 * t) * math.sin((t - 0.075) * (2 * math.pi) / 0.3) + 1

# ── Colour helpers ──────────────────────────────────────────────

def lerp(a, b, t):
    return a + (b - a) * max(0, min(1, t))

def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

# ── Aurora background ──────────────────────────────────────────

def aurora_bg(w, h, t):
    """Multi-layered flowing gradient with wave distortion."""
    arr = np.zeros((h, w, 3), dtype=np.float32)

    # Base gradient shifts over time
    phase = t * 0.4
    for y in range(h):
        yf = y / h
        # Three colour channels with sine wave offsets
        r = 15 + 25 * math.sin(yf * 3.0 + phase) ** 2
        g = 10 + 45 * math.sin(yf * 2.5 + phase * 1.3 + 1.0) ** 2
        b = 40 + 60 * math.sin(yf * 2.0 + phase * 0.7 + 2.0) ** 2

        # Horizontal wave
        for x in range(w):
            xf = x / w
            wave = math.sin(xf * 4 + yf * 3 + t * 1.2) * 0.15
            arr[y, x] = [
                max(0, min(255, r + wave * 30 + 10 * math.sin(xf * 6 + t))),
                max(0, min(255, g + wave * 20)),
                max(0, min(255, b + wave * 40 + 15 * math.sin(xf * 5 + t * 0.8))),
            ]
    return arr.astype(np.uint8)


# ── Particles ──────────────────────────────────────────────────

class GlowParticle:
    def __init__(self):
        self.x = random.uniform(0, W)
        self.y = random.uniform(0, H)
        self.r = random.uniform(2, 8)
        self.vx = random.uniform(-0.5, 0.5)
        self.vy = random.uniform(-1.0, -0.1)
        self.base_alpha = random.uniform(0.15, 0.45)
        self.phase = random.uniform(0, math.tau)
        self.color_shift = random.uniform(0, 1)

    def draw(self, draw_ctx, t):
        pulse = 0.5 + 0.5 * math.sin(t * 3 + self.phase)
        alpha = int(self.base_alpha * pulse * 255)
        x = (self.x + self.vx * t * FPS) % W
        y = (self.y + self.vy * t * FPS) % H
        r = self.r * (0.6 + 0.8 * pulse)

        # Colour varies per particle
        if self.color_shift < 0.33:
            col = (180, 200, 255, alpha)
        elif self.color_shift < 0.66:
            col = (200, 180, 255, alpha)
        else:
            col = (160, 220, 255, alpha)

        # Outer glow
        glow_r = r * 2.5
        glow_alpha = max(1, alpha // 4)
        draw_ctx.ellipse([x - glow_r, y - glow_r, x + glow_r, y + glow_r],
                         fill=(*col[:3], glow_alpha))
        # Core
        draw_ctx.ellipse([x - r, y - r, x + r, y + r], fill=col)

PARTICLES = [GlowParticle() for _ in range(80)]

# ── Geometric constellation ────────────────────────────────────

def draw_polygon(draw_ctx, cx, cy, radius, sides, rotation, color):
    """Draw a regular polygon outline."""
    points = []
    for i in range(sides):
        angle = rotation + (math.tau / sides) * i
        px = cx + radius * math.cos(angle)
        py = cy + radius * math.sin(angle)
        points.append((px, py))
    points.append(points[0])  # close
    draw_ctx.line(points, fill=color, width=2)


def draw_constellation(draw_ctx, t):
    """Rotating geometric shapes around centre."""
    cx, cy = W // 2, H // 2 - 60

    # Entrance: scale up in first 2 seconds
    if t < 2:
        scale = ease_out_cubic(t / 2)
    else:
        scale = 1.0

    # Breathing
    breath = 1.0 + 0.05 * math.sin(t * 1.5)
    s = scale * breath

    rot = t * 0.3  # slow rotation

    # Hexagon
    hex_alpha = int(min(255, 60 + 20 * math.sin(t * 2)))
    draw_polygon(draw_ctx, cx, cy, 140 * s, 6, rot,
                 (180, 200, 255, hex_alpha))

    # Inner triangle (counter-rotate)
    tri_alpha = int(min(255, 50 + 25 * math.sin(t * 2.5 + 1)))
    draw_polygon(draw_ctx, cx, cy, 90 * s, 3, -rot * 1.5 + 0.5,
                 (200, 170, 255, tri_alpha))

    # Outer octagon
    oct_alpha = int(min(255, 35 + 15 * math.sin(t * 1.8 + 2)))
    draw_polygon(draw_ctx, cx, cy, 200 * s, 8, rot * 0.5 + 1,
                 (160, 190, 255, oct_alpha))

    # Dot vertices on hexagon
    for i in range(6):
        angle = rot + (math.tau / 6) * i
        px = cx + 140 * s * math.cos(angle)
        py = cy + 140 * s * math.sin(angle)
        dot_r = 3 * s
        draw_ctx.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r],
                         fill=(220, 230, 255, hex_alpha))

    # Connecting lines between hexagon vertices and triangle vertices
    if t > 1.5:
        line_alpha = int(min(255, 30 * ease_out_cubic(min(1, (t - 1.5) / 1.5))))
        for i in range(3):
            h_angle = rot + (math.tau / 6) * (i * 2)
            t_angle = -rot * 1.5 + 0.5 + (math.tau / 3) * i
            hx = cx + 140 * s * math.cos(h_angle)
            hy = cy + 140 * s * math.sin(h_angle)
            tx = cx + 90 * s * math.cos(t_angle)
            ty = cy + 90 * s * math.sin(t_angle)
            draw_ctx.line([(hx, hy), (tx, ty)], fill=(180, 200, 255, line_alpha), width=1)


# ── Pulse rings ────────────────────────────────────────────────

def draw_pulse_rings(draw_ctx, t):
    """Expanding concentric rings from centre."""
    cx, cy = W // 2, H // 2 - 60
    for i in range(5):
        offset = i * 1.8
        local_t = (t + offset) % 5.0
        if local_t < 0:
            continue
        progress = local_t / 5.0
        radius = 50 + progress * 350
        alpha = int(60 * (1 - progress) ** 2)
        if alpha < 2:
            continue
        draw_ctx.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            outline=(200, 210, 255, alpha), width=1
        )


# ── Light streaks ──────────────────────────────────────────────

def draw_light_streaks(draw_ctx, t):
    """Diagonal sweeping light beams."""
    for i in range(3):
        phase = i * 3.3 + 0.5
        sweep_t = ((t + phase) % 6.0) / 6.0
        if sweep_t > 1:
            continue
        x_start = -200 + sweep_t * (W + 400)
        alpha = int(25 * math.sin(sweep_t * math.pi))
        if alpha < 2:
            continue
        width = 60 + 40 * math.sin(sweep_t * math.pi)
        # Draw angled band
        pts = [
            (x_start, 0),
            (x_start + width, 0),
            (x_start + width - 200, H),
            (x_start - 200, H),
        ]
        draw_ctx.polygon(pts, fill=(255, 255, 255, alpha))


# ── Scenes ─────────────────────────────────────────────────────

SCENES = [
    # (start, end, lines, font_size, y_offset, anim_type)
    (0.5,  4.0, ["ThreadMyMail"],                        88,  -40,  "zoom"),
    (3.0,  6.5, ["Your email,", "intelligently threaded"], 50, -40,  "slide_up"),
    (5.5,  8.5, ["AI-powered.", "Private.", "Yours."],   54,  -40,  "stagger"),
    (7.5, 10.0, ["Get Started"],                         52,  -40,  "pulse"),
]


def get_font(size):
    paths = [
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default(size)


def draw_scenes(draw_ctx, t):
    """Render text for each scene with unique animation style."""
    for start, end, lines, fsize, y_off, anim in SCENES:
        if t < start or t > end:
            continue
        dur = end - start
        local = (t - start) / dur

        font = get_font(fsize)
        line_h = fsize + 18
        total_h = line_h * len(lines)
        base_y = H // 2 + y_off - total_h // 2

        for li, line in enumerate(lines):
            bbox = draw_ctx.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            cx = (W - tw) / 2

            # Per-line stagger for "stagger" anim
            if anim == "stagger":
                line_delay = li * 0.12
                adj_local = max(0, (local - line_delay) / (1 - line_delay * len(lines) * 0.5))
            else:
                adj_local = local

            # Calculate alpha and position offset
            if adj_local < 0.2:
                fade = ease_out_cubic(adj_local / 0.2)
            elif adj_local > 0.8:
                fade = ease_out_cubic((1 - adj_local) / 0.2)
            else:
                fade = 1.0
            fade = max(0, min(1, fade))
            alpha = int(fade * 255)

            dy = 0
            dx = 0

            if anim == "zoom":
                if adj_local < 0.25:
                    sc = 0.3 + 0.7 * ease_out_elastic(adj_local / 0.25)
                    # Simulate zoom via vertical offset from centre
                    dy = (1 - sc) * 30
                else:
                    # Gentle float
                    dy = -3 * math.sin((adj_local - 0.25) * 4)

            elif anim == "slide_up":
                if adj_local < 0.25:
                    p = ease_out_cubic(adj_local / 0.25)
                    dy = (1 - p) * 80
                else:
                    dy = 2 * math.sin(adj_local * 3)

            elif anim == "stagger":
                if adj_local < 0.3:
                    p = ease_out_cubic(adj_local / 0.3)
                    dx = (1 - p) * -120
                    dy = 0
                else:
                    dy = -2 * math.sin(adj_local * 2 + li)

            elif anim == "pulse":
                # Pulsing glow
                pulse_v = 0.5 + 0.5 * math.sin(adj_local * 8)
                alpha = int(fade * (200 + 55 * pulse_v))
                alpha = min(255, alpha)

            y = base_y + li * line_h + dy
            x = cx + dx

            if alpha < 2:
                continue

            # Glow behind text
            glow_alpha = min(255, int(alpha * 0.3))
            for ox, oy in [(-2, -2), (2, -2), (-2, 2), (2, 2), (0, -3), (0, 3)]:
                draw_ctx.text((x + ox, y + oy), line, font=font,
                              fill=(100, 150, 255, glow_alpha))

            # Shadow
            draw_ctx.text((x + 2, y + 3), line, font=font,
                          fill=(0, 0, 0, int(alpha * 0.5)))

            # Main text
            draw_ctx.text((x, y), line, font=font,
                          fill=(255, 255, 255, alpha))


# ── Bottom progress bar ────────────────────────────────────────

def draw_progress(draw_ctx, t):
    """Thin glowing progress bar at bottom."""
    progress = t / DURATION
    bar_y = H - 40
    bar_h = 3
    # Background track
    draw_ctx.rectangle([60, bar_y, W - 60, bar_y + bar_h],
                       fill=(255, 255, 255, 25))
    # Fill
    fill_w = int((W - 120) * progress)
    if fill_w > 0:
        draw_ctx.rectangle([60, bar_y, 60 + fill_w, bar_y + bar_h],
                           fill=(180, 200, 255, 140))
        # Bright tip
        draw_ctx.ellipse([60 + fill_w - 4, bar_y - 3, 60 + fill_w + 4, bar_y + bar_h + 3],
                         fill=(220, 230, 255, 200))


# ── Email icon animation ──────────────────────────────────────

def draw_email_icon(draw_ctx, t):
    """Simple animated envelope icon above the title."""
    if t > 5:
        return
    cx, cy = W // 2, H // 2 - 220

    if t < 1:
        scale = ease_out_cubic(t)
        alpha = int(255 * ease_out_cubic(t))
    elif t > 4:
        alpha = int(255 * ease_out_cubic((5 - t)))
        scale = 1.0
    else:
        scale = 1.0
        alpha = 255

    if alpha < 2:
        return

    # Float
    cy += 5 * math.sin(t * 2)

    ew, eh = int(70 * scale), int(50 * scale)

    # Envelope body
    draw_ctx.rounded_rectangle(
        [cx - ew, cy - eh, cx + ew, cy + eh],
        radius=8,
        outline=(220, 230, 255, alpha),
        width=2
    )
    # Flap (V shape)
    draw_ctx.line([(cx - ew, cy - eh), (cx, cy + int(5 * scale)), (cx + ew, cy - eh)],
                  fill=(220, 230, 255, alpha), width=2)

    # Sparkle dots around envelope
    for i in range(4):
        angle = t * 2 + (math.tau / 4) * i
        sr = (90 + 10 * math.sin(t * 3 + i)) * scale
        sx = cx + sr * math.cos(angle)
        sy = cy + sr * math.sin(angle)
        dot_a = int(alpha * (0.3 + 0.3 * math.sin(t * 4 + i * 2)))
        dot_r = 3 * scale
        draw_ctx.ellipse([sx - dot_r, sy - dot_r, sx + dot_r, sy + dot_r],
                         fill=(200, 220, 255, max(1, dot_a)))


# ── Main frame renderer ───────────────────────────────────────

def make_frame(t):
    """Render frame at time t. Returns HxWx3 numpy."""
    # 1) Aurora background
    bg = aurora_bg(W, H, t)
    img = Image.fromarray(bg, "RGB").convert("RGBA")

    # Overlay for all alpha-composited elements
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 2) Light streaks (behind everything)
    draw_light_streaks(draw, t)

    # 3) Pulse rings
    draw_pulse_rings(draw, t)

    # 4) Constellation geometry
    draw_constellation(draw, t)

    # 5) Particles
    for p in PARTICLES:
        p.draw(draw, t)

    # 6) Email icon
    draw_email_icon(draw, t)

    # 7) Text scenes
    draw_scenes(draw, t)

    # 8) Progress bar
    draw_progress(draw, t)

    # Composite
    img = Image.alpha_composite(img, overlay)
    return np.array(img.convert("RGB"))


# ── Build ──────────────────────────────────────────────────────

def main():
    from moviepy.video.VideoClip import VideoClip

    clip = VideoClip(make_frame, duration=DURATION)
    clip.write_videofile(
        "intro.mp4",
        fps=FPS,
        codec="libx264",
        audio=False,
        threads=4,
        preset="medium",
        bitrate="4000k",
    )
    print("✅ Video written to intro.mp4")


if __name__ == "__main__":
    main()
