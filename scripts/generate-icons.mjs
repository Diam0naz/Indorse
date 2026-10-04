/**
 * scripts/generate-icons.mjs — regenerate the app icon assets from the brand mark
 *
 * The Expo icon slots need PNGs, and the repo has no image toolchain (no sharp,
 * no ImageMagick). Instead we render the brand SVGs with headless Chrome and
 * screenshot straight to the target pixel sizes.
 *
 *   node scripts/generate-icons.mjs        # or: npm run icons
 *
 * Requires a Chrome/Chromium binary on PATH (or set CHROME_BIN).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MARK = readFileSync(join(ROOT, 'assets/brand/indorse-mark.svg'), 'utf8')
const MARK_MONO = readFileSync(join(ROOT, 'assets/brand/indorse-mark-mono.svg'), 'utf8')

/**
 * size  — output square in pixels
 * bg    — page background (null = transparent)
 * scale — brand mark as a fraction of the canvas (0 = background only)
 * mono  — render the single-colour silhouette instead of the amber mark
 */
const TARGETS = [
  { out: 'assets/images/icon.png', size: 1024, bg: '#0E0D0B', scale: 0.62 },
  { out: 'assets/images/splash-icon.png', size: 1024, bg: null, scale: 0.7 },
  { out: 'assets/images/favicon.png', size: 48, bg: null, scale: 0.88 },
  // Android adaptive icons keep art inside the inner ~66% safe zone.
  { out: 'assets/images/android-icon-foreground.png', size: 512, bg: null, scale: 0.56 },
  { out: 'assets/images/android-icon-background.png', size: 512, bg: '#0E0D0B', scale: 0 },
  { out: 'assets/images/android-icon-monochrome.png', size: 432, bg: null, scale: 0.56, mono: true },
]

function chromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      execFileSync('command', ['-v', candidate], { stdio: 'ignore', shell: true })
      return candidate
    } catch {
      // try the next candidate
    }
  }
  throw new Error('No Chrome/Chromium found. Install one or set CHROME_BIN.')
}

function page({ size, bg, scale, mono }) {
  const mark = mono ? MARK_MONO : MARK
  const art = scale > 0 ? `<div class="wrap">${mark}</div>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${bg ?? 'transparent'};}
    .wrap{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;}
    svg{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;display:block;}
  </style></head><body>${art}</body></html>`
}

const chrome = chromeBinary()
const work = mkdtempSync(join(tmpdir(), 'indorse-icons-'))

try {
  for (const target of TARGETS) {
    const htmlPath = join(work, 'page.html')
    const outPath = join(ROOT, target.out)
    writeFileSync(htmlPath, page(target))

    execFileSync(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${target.size},${target.size}`,
        `--screenshot=${outPath}`,
        `file://${htmlPath}`,
      ],
      { stdio: 'ignore' },
    )

    const bytes = statSync(outPath).size
    console.log(`✓ ${target.out} — ${target.size}×${target.size}, ${bytes} bytes`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
