# Third-party notices

IV Studio ships these components. Their licence texts are in `resources/licenses/` and are installed
with the app.

| Component | Licence | Use |
| --- | --- | --- |
| Electron (with Chromium and Node.js) | MIT; Chromium's notices ship as `LICENSES.chromium.html` in the install folder | App runtime |
| React, React DOM | MIT | Interface |
| @modelcontextprotocol/sdk | MIT | MCP server |
| zod | MIT | MCP tool schemas |
| electron-updater | MIT | Updates from GitHub Releases |
| Barlow and Barlow Condensed (Jeremy Tribby) | SIL OFL 1.1 | Display type |
| DM Sans (Colophon Foundry) | SIL OFL 1.1 | Body type |
| JetBrains Mono (JetBrains) | SIL OFL 1.1 | Monospace type |

## Artwork

`src/renderer/src/assets/eye.webp` is Infinite Variance's own artwork (the "What If?" eye from infinitevariance.ai). It is © Infinite Variance and is **not** covered by the MIT licence; don't reuse it outside IV Studio without permission.

## Not bundled

IV Studio doesn't include ComfyUI, its node packs or any model weights. Setup downloads models
from their upstream hosts on request, and each comes under its own licence. Check the model page
before any commercial use. The node packs install from their own GitHub repositories under their
own licences.
