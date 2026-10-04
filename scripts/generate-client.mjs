/**
 * scripts/generate-client.mjs — Render the @solana/kit client for the Indorse
 * program from the synced Anchor IDL.
 *
 * Run `npm run idl:sync` first (after `anchor build`) so the input matches the
 * deployed program, then `npm run client:generate`. The output under
 * `lib/generated/indorse` is committed, so neither the app build nor Metro ever
 * needs the Anchor or Codama toolchain — only this script does.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const idlPath = resolve(root, 'lib/idl/indorse_program.json')
const outputDir = resolve(root, 'lib/generated/indorse')

const idl = JSON.parse(readFileSync(idlPath, 'utf8'))
const codama = createFromRoot(rootNodeFromAnchor(idl))

await codama.accept(
  renderVisitor(outputDir, {
    deleteFolderBeforeRendering: true,
    // Render straight into the output folder instead of the renderer's default
    // `src/generated` package layout, so the app imports `@/lib/generated/indorse`.
    generatedFolder: '.',
    // No package.json in the output folder: it is source the app imports
    // through the `@/` alias, not a separately installable package.
    syncPackageJson: false,
  }),
)

console.log(`✔ Wrote @solana/kit client for ${idl.address} → lib/generated/indorse`)
