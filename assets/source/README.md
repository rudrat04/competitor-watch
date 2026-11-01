# Outflank design source

`build.py` generates every SVG in `assets/` (the logo, mark, banner, diagrams and the README
example cards) in the theme of [f1rstword.com](https://f1rstword.com):

- **Colours:** coral `#FF5233`, ink `#1A1523`, cream `#FFF6EE`, and the sunset sky gradient.
- **Shapes:** 2–3px ink borders with hard offset shadows, and pill "stickers".
- **Fonts:** Fraunces, Space Grotesk and Caveat.

Text is converted to outlines (HarfBuzz shaping, fontTools glyph paths), and each glyph is stored
once and reused. The SVGs look identical on GitHub, which shows README images without web fonts.

To regenerate:

1. Put these static TTFs from Google Fonts in `assets/source/fonts/`. They're all under the SIL
   Open Font License, and the folder is gitignored.
   - `Fraunces_opsz_wght_144_800.ttf` (Fraunces 144pt ExtraBold)
   - `Fraunces_ital_opsz_wght_1_144_600.ttf` (Fraunces 144pt SemiBold Italic)
   - `Space_Grotesk_wght_500.ttf`
   - `Space_Grotesk_wght_700.ttf`
   - `Caveat_wght_700.ttf`
2. `pip install fonttools uharfbuzz`
3. `python3 assets/source/build.py assets`

The example cards quote `examples/live-run/battlecards/hyperbound.md` (real output) and
`examples/digest-weekly.md` (a fictional sample). If you change those files, update the cards.
