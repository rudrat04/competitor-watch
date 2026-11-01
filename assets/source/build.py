"""Outflank visual identity, in the f1rstword.com theme. Writes SVGs to assets/.

All text is converted to outlines (HarfBuzz shaping + fontTools glyph paths) so the SVGs
look identical on GitHub, which renders README SVGs as images without web fonts.
"""
import math
import os
import re
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

FONTS = os.path.join(os.path.dirname(__file__), 'fonts')  # see assets/source/README.md
OUT = sys.argv[1]

# ---- theme tokens (from f1rstword.com CSS) ----
CORAL, CORAL_DK = '#FF5233', '#C23A20'
CREAM, CREAM2, PAPER = '#FFF6EE', '#FBEEE0', '#FFFDF9'
INK, INK_SOFT = '#1A1523', '#453B52'
BUTTER, PEACH = '#FFF1B8', '#FFD5A0'
SKY = ['#EAB4A8', '#E7A7BE', '#C6A3D6', '#8FA9DA', '#6C97D2']  # the site's sunset gradient


class Font:
    def __init__(self, file):
        path = os.path.join(FONTS, file)
        data = open(path, 'rb').read()
        self.hb_font = hb.Font(hb.Face(data))
        self.tt = TTFont(path)
        self.upem = self.tt['head'].unitsPerEm
        self.glyphs = self.tt.getGlyphSet()

    def shape(self, s):
        buf = hb.Buffer()
        buf.add_str(s)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {'kern': True, 'liga': True})
        return buf.glyph_infos, buf.glyph_positions

    def width(self, s, size, tracking=0):
        _, pos = self.shape(s)
        return sum(p.x_advance for p in pos) * size / self.upem + tracking * max(len(pos) - 1, 0)

    def text(self, s, size, x, y, fill=INK, anchor='start', tracking=0, extra=''):
        """SVG <g> of glyph outlines. (x, y) is the baseline start (or middle/end per anchor)."""
        w = self.width(s, size, tracking)
        x0 = x - (w / 2 if anchor == 'middle' else w if anchor == 'end' else 0)
        scale = size / self.upem
        infos, pos = self.shape(s)
        pen_x, parts = 0.0, []
        for info, p in zip(infos, pos):
            name = self.tt.getGlyphName(info.codepoint)
            pen = SVGPathPen(self.glyphs)
            self.glyphs[name].draw(pen)
            d = pen.getCommands()
            if d:
                gx = x0 + (pen_x + p.x_offset) * scale
                gy = y - p.y_offset * scale
                parts.append(f'<path transform="translate({gx:.2f} {gy:.2f}) scale({scale:.5f} {-scale:.5f})" d="{d}"/>')
            pen_x += p.x_advance + tracking / scale
        return f'<g fill="{fill}"{extra}>{"".join(parts)}</g>', w


DISPLAY = Font('Fraunces_opsz_wght_144_800.ttf')
ITALIC = Font('Fraunces_ital_opsz_wght_1_144_600.ttf')
SANS = Font('Space_Grotesk_wght_500.ttf')
SANS_B = Font('Space_Grotesk_wght_700.ttf')
HAND = Font('Caveat_wght_700.ttf')


def svg(w, h, body, title, desc):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-labelledby="t d"><title id="t">{title}</title><desc id="d">{desc}</desc>'
            f'{body}</svg>\n')


def defs(uid):
    stops = ''.join(f'<stop offset="{i / (len(SKY) - 1):.2f}" stop-color="{c}"/>' for i, c in enumerate(SKY))
    return (f'<defs>'
            f'<linearGradient id="sky{uid}" x1="0" y1="0" x2="0.35" y2="1">{stops}</linearGradient>'
            f'<linearGradient id="skyd{uid}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{SKY[0]}"/><stop offset="0.6" stop-color="{SKY[2]}"/><stop offset="1" stop-color="{SKY[3]}"/></linearGradient>'
            f'<radialGradient id="glow{uid}"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
            f'<radialGradient id="sun{uid}" cx="0.4" cy="0.35"><stop offset="0" stop-color="{BUTTER}"/><stop offset="0.55" stop-color="{PEACH}"/><stop offset="1" stop-color="{CORAL}"/></radialGradient>'
            f'</defs>')


def card(x, y, w, h, r=18, fill=PAPER, stroke=2.5, shadow=5, rot=0, cx=None, cy=None):
    """The site's signature card: ink border + hard offset ink shadow."""
    t = f' transform="rotate({rot} {cx if cx is not None else x + w / 2} {cy if cy is not None else y + h / 2})"' if rot else ''
    return (f'<g{t}><rect x="{x + shadow}" y="{y + shadow}" width="{w}" height="{h}" rx="{r}" fill="{INK}"/>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{INK}" stroke-width="{stroke}"/></g>')


def sticker(text, x, y, rot, fill=CREAM, size=22, font=SANS_B, color=INK):
    """Pill 'sticker' centred on (x, y), slightly tilted."""
    tw = font.width(text, size)
    w, h = tw + 40, size + 22
    t, _ = font.text(text, size, x, y + size * 0.36, fill=color, anchor='middle')
    return (f'<g transform="rotate({rot} {x} {y})">'
            f'<rect x="{x - w / 2 + 4}" y="{y - h / 2 + 4}" width="{w}" height="{h}" rx="{h / 2}" fill="{INK}"/>'
            f'<rect x="{x - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" rx="{h / 2}" fill="{fill}" stroke="{INK}" stroke-width="2.5"/>'
            f'{t}</g>')


def mark(uid, x=0, y=0, s=1.0):
    """The Outflank mark: sunset badge, a cream 'rival' block, and a coral arrow sweeping around its flank."""
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect x="10" y="10" width="100" height="100" rx="24" fill="{INK}"/>
  <rect x="4" y="4" width="100" height="100" rx="24" fill="url(#skyd{uid})" stroke="{INK}" stroke-width="3.5"/>
  <ellipse cx="34" cy="26" rx="30" ry="14" fill="url(#glow{uid})"/>
  <ellipse cx="82" cy="88" rx="22" ry="10" fill="url(#glow{uid})" opacity="0.7"/>
  <rect x="24" y="44" width="34" height="34" rx="7" fill="{CREAM}" stroke="{INK}" stroke-width="3.5"/>
  <path d="M18 92 C 56 100, 82 88, 82 62 L 82 40" fill="none" stroke="{INK}" stroke-width="15" stroke-linecap="round"/>
  <path d="M18 92 C 56 100, 82 88, 82 62 L 82 40" fill="none" stroke="{CORAL}" stroke-width="8" stroke-linecap="round"/>
  <path d="M68 42 L 82 16 L 96 42 Z" fill="{CORAL}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
</g>'''


def dedupe_glyphs(doc):
    """Store each glyph outline once in <defs> and reference it with <use> (much smaller files)."""
    ids = {}

    def repl(m):
        d = m.group(2)
        gid = ids.setdefault(d, f'g{len(ids)}')
        return f'<use href="#{gid}" transform="{m.group(1)}"/>'

    doc = re.sub(r'<path transform="([^"]+)" d="([^"]+)"/>', repl, doc)
    if not ids:
        return doc
    defs_ = '<defs>' + ''.join(f'<path id="{i}" d="{d}"/>' for d, i in ids.items()) + '</defs>'
    head_end = doc.index('</desc>') + len('</desc>')
    return doc[:head_end] + defs_ + doc[head_end:]


def write(name, content):
    content = dedupe_glyphs(content)
    path = os.path.join(OUT, name)
    open(path, 'w').write(content)
    print(f'{name}: {len(content) // 1024} KB')


# ================= logo (horizontal) =================
def logo():
    word, ww = DISPLAY.text('Outflank', 76, 156, 92, fill=INK)
    swash = f'<path d="M{150 + ww * 0.43} 108 C {150 + ww * 0.6} 100, {150 + ww * 0.85} 99, {150 + ww * 1.0} 104" fill="none" stroke="{CORAL}" stroke-width="6" stroke-linecap="round"/>'
    note, _ = HAND.text('see their move first', 26, 154 + ww * 0.42, 140, fill=CORAL_DK)
    W = int(150 + ww + 40)
    plate = (f'<rect x="10" y="10" width="{W - 14}" height="148" rx="28" fill="{INK}"/>'
             f'<rect x="3" y="3" width="{W - 14}" height="148" rx="28" fill="{CREAM}" stroke="{INK}" stroke-width="3"/>')
    body = defs('L') + plate + mark('L', 14, 18) + word + swash + note
    write('logo.svg', svg(W, 162, body, 'Outflank', 'Outflank logo: a coral arrow sweeping around a rival block on a sunset badge, next to the word Outflank.'))


def icon():
    write('mark.svg', svg(124, 124, defs('M') + mark('M', 2, 2), 'Outflank mark', 'Outflank mark: a coral arrow outflanking a rival block on a sunset badge.'))


# ================= banner =================
def banner():
    W, H = 1280, 440
    uid = 'B'
    parts = [defs(uid)]
    # sky card with ink border + hard shadow
    parts.append(f'<rect x="14" y="14" width="{W - 24}" height="{H - 24}" rx="34" fill="{INK}"/>')
    parts.append(f'<rect x="6" y="6" width="{W - 24}" height="{H - 24}" rx="34" fill="url(#sky{uid})" stroke="{INK}" stroke-width="3.5"/>')
    # clouds + sun
    for cx, cy, rx, ry, o in [(230, 70, 260, 70, 0.9), (1050, 360, 260, 70, 0.6), (760, 60, 180, 40, 0.5)]:
        parts.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#glow{uid})" opacity="{o}"/>')
    parts.append(f'<circle cx="1120" cy="112" r="64" fill="url(#sun{uid})" stroke="{INK}" stroke-width="3.5"/>')
    parts.append(mark(uid, 70, 92, 1.55))
    word, ww = DISPLAY.text('Outflank', 120, 290, 190, fill=INK)
    parts.append(word)
    parts.append(f'<path d="M{290 + ww * 0.45} 210 C {290 + ww * 0.62} 198, {290 + ww * 0.86} 197, {290 + ww * 1.01} 204" fill="none" stroke="{CORAL}" stroke-width="8" stroke-linecap="round"/>')
    l1, _ = SANS.text('Self-hosted competitor intelligence. Weekly digests and', 27, 294, 258, fill=INK)
    l2, _ = SANS.text('always-current battlecards, from your own private GitHub repo.', 27, 294, 294, fill=INK)
    parts += [l1, l2]
    parts.append(sticker('100% self-hosted', 410, 362, -4, fill=CREAM))
    parts.append(sticker('bring your own key', 650, 368, 3, fill=BUTTER))
    parts.append(sticker('git is the database', 900, 360, -2.5, fill=CREAM))
    note, _ = HAND.text('your rivals just moved.', 32, 1236, 222, fill=CORAL_DK, anchor='end')
    parts.append(f'<g transform="rotate(-4 1130 214)">{note}<path d="M1046 232 C 1100 226, 1170 225, 1232 230" fill="none" stroke="{CORAL_DK}" stroke-width="3" stroke-linecap="round"/></g>')
    write('banner.svg', svg(W, H, ''.join(parts), 'Outflank', 'Outflank: self-hosted competitor intelligence. Weekly digests and always-current battlecards, from your own private GitHub repo.'))


# ================= how a run works =================
def how_it_works():
    W, H = 1280, 690
    uid = 'H'
    p = [defs(uid)]
    p.append(f'<rect x="12" y="12" width="{W - 20}" height="{H - 20}" rx="30" fill="{INK}"/>')
    p.append(f'<rect x="4" y="4" width="{W - 20}" height="{H - 20}" rx="30" fill="{CREAM}" stroke="{INK}" stroke-width="3"/>')
    t, _ = DISPLAY.text('How a run works', 44, 60, 86, fill=INK)
    p.append(t)
    sub, _ = SANS.text('Deterministic code does the heavy lifting. The LLM only sees real changes, under a hard cost cap.', 21, 62, 122, fill=INK_SOFT)
    p.append(sub)

    steps = [
        ('Fetch', ['robots.txt first,', 'polite + identified']),
        ('Extract', ['main content or your', 'include selectors']),
        ('Normalize', ['strip timestamps,', 'IDs, tracking params']),
        ('Diff', ['hash, then line diff', 'vs last snapshot']),
        ('Filter', ['keyword triggers,', 'size threshold (free)']),
        ('Triage', ['fast model: noise,', 'minor or material']),
        ('Analyze', ['strong model, only', 'for material changes']),
        ('Ship', ['digest, battlecards,', 'issue / Slack / Discord']),
    ]
    cw, ch, gap = 252, 150, 46
    x0 = (W - (4 * cw + 3 * gap)) / 2
    rows = [212, 432]
    fills = [PAPER, PAPER, PAPER, PAPER, BUTTER, '#FFE3D2', '#FFE3D2', PAPER]
    for i, (name, lines) in enumerate(steps):
        r, c = divmod(i, 4)
        x, y = x0 + c * (cw + gap), rows[r]
        p.append(card(x, y, cw, ch, r=20, fill=fills[i], shadow=5))
        p.append(f'<circle cx="{x + 34}" cy="{y + 36}" r="18" fill="{CORAL}" stroke="{INK}" stroke-width="2.5"/>')
        n, _ = SANS_B.text(str(i + 1), 19, x + 34, y + 43, fill=PAPER, anchor='middle')
        p.append(n)
        h, _ = DISPLAY.text(name, 30, x + 64, y + 47, fill=INK)
        p.append(h)
        for j, line in enumerate(lines):
            l, _ = SANS.text(line, 19, x + 24, y + 92 + j * 26, fill=INK_SOFT)
            p.append(l)
        # arrows
        if c < 3:
            ax = x + cw + 8
            p.append(f'<path d="M{ax} {y + ch / 2} H {ax + gap - 18}" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>'
                     f'<path d="M{ax + gap - 26} {y + ch / 2 - 8} L {ax + gap - 16} {y + ch / 2} L {ax + gap - 26} {y + ch / 2 + 8}" fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>')
    # wrap arrow from step 4 down-left to step 5
    xr = x0 + 3 * (cw + gap) + cw / 2
    xl = x0 + cw / 2
    y1, y2 = rows[0] + ch + 8, rows[1] - 12
    ym = (y1 + y2) / 2 + 2
    p.append(f'<path d="M{xr} {y1} V {ym - 12} Q {xr} {ym} {xr - 12} {ym} H {xl + 12} Q {xl} {ym} {xl} {ym + 12} V {y2}" fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round"/>'
             f'<path d="M{xl - 8} {y2 - 10} L {xl} {y2} L {xl + 8} {y2 - 10}" fill="none" stroke="{INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>')
    # handwritten notes
    n1, _ = HAND.text('free + deterministic', 30, x0 + 4 * cw + 3 * gap, 186, fill=CORAL_DK, anchor='end')
    n2, _ = HAND.text('LLM, capped per run', 30, x0 + 2 * (cw + gap) - 10, 636, fill=CORAL_DK, anchor='middle')
    n3, _ = HAND.text('most weeks: $0', 30, x0 + 4 * cw + 3 * gap, 636, fill=CORAL_DK, anchor='end')
    p += [n1, n2, n3]
    write('how-it-works.svg', svg(W, H, ''.join(p), 'How an Outflank run works',
          'Eight steps: fetch (robots.txt first), extract, normalize, diff, filter with keyword triggers and a size threshold (all free and deterministic), triage with a fast model, analyze material changes with a strong model, then ship the digest, battlecards and notifications.'))


# ================= GitHub flow =================
def github_flow():
    W, H = 1280, 470
    uid = 'G'
    p = [defs(uid)]
    p.append(f'<rect x="12" y="12" width="{W - 20}" height="{H - 20}" rx="30" fill="{INK}"/>')
    p.append(f'<rect x="4" y="4" width="{W - 20}" height="{H - 20}" rx="30" fill="url(#skyd{uid})" stroke="{INK}" stroke-width="3"/>')
    p.append(f'<ellipse cx="300" cy="60" rx="300" ry="60" fill="url(#glow{uid})"/>')
    t, _ = DISPLAY.text('Zero infrastructure. Your repo, your key.', 40, 60, 84, fill=INK)
    p.append(t)
    boxes = [
        ('Template', ['Use this template →', 'private repo, 1 secret']),
        ('Your repo', ['competitors.yaml', 'data/ (git = history)']),
        ('Actions', ['every Monday 03:17', 'runs npx outflank']),
        ('You', ['digest issue, Slack,', 'Discord + battlecards']),
    ]
    cw, ch, gap = 250, 170, 50
    x0 = (W - (4 * cw + 3 * gap)) / 2
    y = 150
    fills = [CREAM, PAPER, BUTTER, '#FFE3D2']
    for i, (name, lines) in enumerate(boxes):
        x = x0 + i * (cw + gap)
        p.append(card(x, y, cw, ch, r=22, fill=fills[i], shadow=6))
        h, _ = DISPLAY.text(name, 32, x + 26, y + 56, fill=INK)
        p.append(h)
        for j, line in enumerate(lines):
            l, _ = SANS.text(line, 20, x + 26, y + 100 + j * 30, fill=INK_SOFT)
            p.append(l)
        if i < 3:
            ax = x + cw + 10
            p.append(f'<path d="M{ax} {y + ch / 2} H {ax + gap - 20}" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>'
                     f'<path d="M{ax + gap - 29} {y + ch / 2 - 9} L {ax + gap - 18} {y + ch / 2} L {ax + gap - 29} {y + ch / 2 + 9}" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>')
    # loop arrow: Actions commits back to repo
    xa = x0 + 2 * (cw + gap) + cw / 2
    xr = x0 + 1 * (cw + gap) + cw / 2
    yb = y + ch + 14
    p.append(f'<path d="M{xa} {yb} C {xa} {yb + 60}, {xr} {yb + 60}, {xr} {yb + 6}" fill="none" stroke="{CORAL_DK}" stroke-width="3.5" stroke-dasharray="2 9" stroke-linecap="round"/>'
             f'<path d="M{xr - 9} {yb + 18} L {xr} {yb + 4} L {xr + 9} {yb + 18}" fill="none" stroke="{CORAL_DK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>')
    note, _ = HAND.text('commits data/ back: git history is the change log', 30, (xa + xr) / 2, yb + 92, fill=CORAL_DK, anchor='middle')
    p.append(note)
    p.append(sticker('no servers', 1110, 92, 4, fill=CREAM, size=20))
    write('github-flow.svg', svg(W, H, ''.join(p), 'How Outflank runs on GitHub',
          'Create a private repo from the template and add one secret; edit competitors.yaml; a GitHub Action runs Outflank every Monday, commits data/ back to the repo, and sends you a digest issue, Slack or Discord message, and updated battlecards.'))



# ================= example cards (README) =================
def check_glyphs(font, text):
    cmap = font.tt.getBestCmap()
    missing = sorted({c for c in text if c not in ' \n' and ord(c) not in cmap})
    if missing:
        raise SystemExit(f'missing glyphs in {font.tt["name"].getDebugName(4)}: {missing!r} in {text!r}')


def smart_quotes(text):
    """Straight quotes to typographic ones: in these fonts a straight " looks like a closing quote."""
    out, open_ = [], True
    for i, ch in enumerate(text):
        if ch == '"':
            out.append('\u201c' if open_ else '\u201d')
            open_ = not open_
        elif ch == "'" and i > 0 and text[i - 1].isalpha():
            out.append('\u2019')
        else:
            out.append(ch)
    return ''.join(out)


class Flow:
    """Very small rich-text layout: **bold** runs, word wrap, bullets."""

    def __init__(self, x, y, width, size=21, line=1.5, color=INK_SOFT, bold_color=INK):
        self.x, self.y, self.w = x, y, width
        self.size, self.lh = size, size * line
        self.color, self.bold_color = color, bold_color
        self.out = []

    def para(self, text, bullet=False, size=None, gap=10, color=None, font=None, bold=None):
        size = size or self.size
        lh = size * self.lh / self.size
        regular, strong = font or SANS, bold or SANS_B
        indent = 26 if bullet else 0
        text = smart_quotes(text)
        words = []  # (font, word)
        for i, chunk in enumerate(text.split('**')):
            f = strong if i % 2 else regular
            for wd in chunk.split():
                check_glyphs(f, wd)
                words.append((f, wd))
        lines, cur, cur_w = [], [], 0.0
        space = regular.width(' ', size)
        for f, wd in words:
            ww = f.width(wd, size)
            if cur and cur_w + space + ww > self.w - indent:
                lines.append(cur)
                cur, cur_w = [], 0.0
            cur.append((f, wd, ww))
            cur_w += (space if len(cur) > 1 else 0) + ww
        if cur:
            lines.append(cur)
        y = self.y + size
        if bullet:
            self.out.append(f'<circle cx="{self.x + 8}" cy="{y - size * 0.32:.1f}" r="5" fill="{CORAL}" stroke="{INK}" stroke-width="1.5"/>')
        for ln in lines:
            cx = self.x + indent
            for f, wd, ww in ln:
                c = (color or (self.bold_color if f is strong else self.color))
                g, _ = f.text(wd, size, cx, y, fill=c)
                self.out.append(g)
                cx += ww + space
            y += lh
        self.y = y - lh + size * 0.45 + gap
        return self

    def heading(self, text, size=30, gap=12, font=None, color=INK):
        f = font or DISPLAY
        check_glyphs(f, text)
        g, _ = f.text(text, size, self.x, self.y + size)
        self.out.append(g.replace(f'fill="{INK}"', f'fill="{color}"', 1))
        self.y += size * 1.25 + gap
        return self

    def svg(self):
        return ''.join(self.out)


def frame(W, H, uid, fill=CREAM):
    return (defs(uid) + f'<rect x="12" y="12" width="{W - 20}" height="{H - 20}" rx="30" fill="{INK}"/>'
            f'<rect x="4" y="4" width="{W - 20}" height="{H - 20}" rx="30" fill="{fill}" stroke="{INK}" stroke-width="3"/>')


def label(text, x, y, rot, fill):
    check_glyphs(SANS_B, text)
    return sticker(text, x, y, rot, fill=fill, size=19)


def example_battlecard():
    W, uid = 1280, 'EB'
    body = []
    body.append(mark(uid, 52, 46, 0.62))
    t, _ = DISPLAY.text('Hyperbound', 46, 140, 100)
    body.append(t)
    t2, _ = SANS.text('Battlecard · built from 2 live pages on 2026-11-01', 20, 142, 132, fill=INK_SOFT)
    body.append(t2)
    colw = 548
    left = Flow(60, 176, colw)
    left.heading('Pricing & packaging', 28)
    left.para('**Model:** "priced per user, with separate licenses available for Practice and Perform". No prices are shown.', bullet=True)
    left.para('**Free plan:** includes the Outbound, Objection Handling and Inbound roleplay packs; not the Competitive Positioning pack, buyer-bot builder, analytics, SSO or integrations.', bullet=True)
    left.para('**Discounts:** volume discounts by team size and extra savings for multi-year agreements.', bullet=True)
    right = Flow(668, 176, colw)
    right.heading("Where they're strong", 28)
    right.para('Indian languages: Hindi, Gujarati, Marathi and Tamil are listed, so vernacular support alone is **not** a differentiator against them.', bullet=True)
    right.heading('Where Rehearsely likely wins', 28)
    right.para('Indian BFSI and pharma depth: their banking page is about financial advisors and AUM growth, with no Indian bank branch, insurance or NBFC scenarios and no pharma content observed.', bullet=True)
    right.para('Data residency: "EU data residency" is listed; India residency was not observed (verify before using).', bullet=True)
    y = max(left.y, right.y) + 10
    body.append(f'<path d="M60 {y} H {W - 64}" stroke="{INK}" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>')
    bottom = Flow(60, y + 22, W - 128)
    bottom.heading('How to handle them in a sales conversation', 28)
    bottom.para('Don\'t lead with "we support Hindi": they list Hindi, Gujarati, Marathi and Tamil. Lead with Indian BFSI and pharma scenarios and compliance instead.', bullet=True)
    bottom.para('Run a head-to-head on a real Indian conversation: a Hinglish insurance renewal or a doctor detailing call. Let the realism decide.', bullet=True)
    H = int(bottom.y + 64)
    note, _ = HAND.text('quotes the page, labels its guesses', 28, W - 70, H - 42, fill=CORAL_DK, anchor='end')
    excerpt, _ = SANS.text('Excerpt: examples/live-run/battlecards/hyperbound.md', 17, 62, H - 44, fill=INK_SOFT)
    content = frame(W, H, uid) + ''.join(body) + left.svg() + right.svg() + bottom.svg() + note + excerpt
    content += label('REAL OUTPUT · live run', W - 190, 70, 3, BUTTER)
    write('example-battlecard.svg', svg(W, H, content, 'Example battlecard (real output)',
          'Excerpt of the real Hyperbound battlecard from the live run on 2026-11-01: pricing and packaging, where they are strong (Hindi, Gujarati, Marathi and Tamil are listed), where Rehearsely likely wins, and how to handle them in a sales conversation.'))


def example_digest():
    W, uid = 1280, 'ED'
    body = []
    t, _ = DISPLAY.text('Outflank — 2026-11-09', 44, 60, 96)
    body.append(t)
    f = Flow(60, 122, W - 130)
    f.para('**1 material, 2 minor changes across 2 competitors**', size=24, gap=18)
    f.heading('Material changes', 32, gap=6)
    f.heading('Northwind Metrics — pricing', 26, gap=8, font=ITALIC, color=CORAL_DK)
    f.para('**Pro rose to $69/month, an Enterprise plan was added and the free plan was removed.**', gap=16)
    kt = sticker(smart_quotes('Keyword trigger: "free plan" removed'), 0, 0, 0, fill='#FFE3D2', size=19)
    body.append(f'<g transform="translate({60 + 230} {f.y + 22}) rotate(-1.5)">{kt}</g>')
    f.y += 62
    f.para('**What changed:** The Pro plan rose from $49 to $69 per month, and a new Enterprise plan with SSO and audit logs was added at custom pricing. The "Free plan" section was removed.', bullet=True)
    f.para('**Why it matters:** Likely a move upmarket: dropping the free tier and adding Enterprise suggests they are prioritising larger accounts (speculation, based on the plan changes only).', bullet=True)
    f.para('**Impact on us:** Our flat pricing is now clearly cheaper for small teams, and teams on their free plan will need a new home.', bullet=True)
    f.para('**Suggested response:** Marketing: publish a short "moving from Northwind" guide aimed at former free-plan users this week. Sales: lead with total cost for teams under 50 seats. (confidence: high)', bullet=True, gap=20)
    f.heading('Minor changes', 32, gap=6)
    f.para('**Northwind Metrics** (changelog): Added a Salesforce export integration.', bullet=True)
    f.para('**Globex Insights** (homepage): Headline changed from "Analytics for everyone" to "AI analytics for product teams".', bullet=True, gap=16)
    f.para('Cost: $0.1268 of $1.00 cap (6 LLM calls, 18950 in / 4120 out tokens)', size=18, color=INK_SOFT)
    H = int(f.y + 50)
    content = frame(W, H, uid, fill=PAPER) + ''.join(body[:1]) + f.svg() + ''.join(body[1:])
    content += label('SAMPLE · fictional companies', W - 220, 74, -3, PEACH)
    write('example-digest.svg', svg(W, H, content, 'Example weekly digest (fictional sample)',
          'A sample weekly digest with fictional companies: one material change at Northwind Metrics (Pro rose to $69 a month, an Enterprise plan was added, the free plan was removed, with a keyword trigger) with what changed, why it matters, impact on us and a suggested response, plus two minor changes and the run cost.'))


def example_notification():
    W, uid = 1280, 'EN'
    f = Flow(182, 112, 990, size=21)
    f.para('**Outflank — 2026-11-09:** 1 material, 2 minor changes across 2 competitors', gap=8)
    items = [(CORAL, 'Northwind Metrics (pricing): Pro rose to $69/month, an Enterprise plan was added and the free plan was removed.'),
             (BUTTER, 'Northwind Metrics (changelog): Added a Salesforce export integration.'),
             (BUTTER, 'Globex Insights (homepage): Headline changed from "Analytics for everyone" to "AI analytics for product teams".')]
    for col, text in items:
        y0 = f.y
        f.para(text, bullet=True, gap=4, size=19)
        f.out.append(f'<circle cx="{182 + 8}" cy="{y0 + 19 - 19 * 0.32:.1f}" r="6" fill="{col}" stroke="{INK}" stroke-width="1.8"/>')
    link, lw = SANS_B.text('Read the full digest →', 19, 208, f.y + 22, fill=CORAL_DK)
    f.out.append(link + f'<path d="M208 {f.y + 30} H {208 + lw}" stroke="{CORAL_DK}" stroke-width="2"/>')
    bubble_h = int(f.y + 30 + 30 - 52)
    H = 52 + bubble_h + 92
    body = [frame(W, H, uid, fill=f'url(#skyd{uid})'), f'<ellipse cx="300" cy="50" rx="320" ry="60" fill="url(#glow{uid})"/>']
    body.append(card(150, 52, 1050, bubble_h, r=22, fill=PAPER, shadow=6))
    body.append(mark(uid, 56, 56, 0.66))
    n, nw = SANS_B.text('Outflank', 22, 182, 96)
    body.append(n)
    tm, _ = SANS.text('Monday 03:21', 18, 182 + nw + 14, 96, fill=INK_SOFT)
    body.append(tm)
    note, _ = HAND.text('what Slack / Discord gets', 27, 1222, H - 34, fill=INK, anchor='end')
    content = ''.join(body) + f.svg() + note + label('SAMPLE', 1180, 50, 4, PEACH)
    write('example-notification.svg', svg(W, H, content, 'Example notification (fictional sample)',
          'A sample Slack or Discord message from Outflank: the date and headline, one line per change with the material one first, and a link to the full digest.'))

logo()
icon()
banner()
how_it_works()
github_flow()
example_battlecard()
example_digest()
example_notification()
