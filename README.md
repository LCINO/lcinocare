# LcinoCare — Therapy for Your Mac

A free, open-source, native macOS care app. LcinoCare finds hidden junk,
visualizes storage, uninstalls apps cleanly, and keeps your Mac fast —
privately, honestly, and safe by design.

**Website:** <https://care.lcino.com>

## Highlights

- **Smart Care** — one scan powers every module; review-first workflow
- **Junk Cleanup** — System Junk, Mail Attachments, Trash Bins — every item explained in plain English
- **Space Lens** — your home folder as a living bubble map
- **Performance** — login items, background agents, honest live CPU/memory
- **Applications** — real uninstaller with leftover detection
- **My Tools** — 9 focused tools, incl. Time Machine snapshot cleanup
- **My Activity** — health score and a timeline of everything LcinoCare did

## Safety by design

- **Trash-only deletion** — nothing is erased permanently until you say so, twice
- **Hard blocklist** — Keychains, Mail data, system databases locked inside the delete call
- **App-quit checks** — graceful ⌘Q requests, never `kill -9`
- **Zero telemetry** — no account, no analytics, no servers

## Requirements

macOS 13+ · Apple Silicon (M1/M2/M3/M4) · ~124 MB

## Install

Download the latest `LcinoCare-arm64.dmg` from
[Releases](https://github.com/LCINO/lcinocare/releases/latest), open it, and
drag LcinoCare to Applications. On first launch, right-click the app and
choose **Open** once (notarization is on the roadmap).

## Development

```bash
npm install
npm start        # run the app
npm run scan     # CLI scan check
npm run dist     # build the .dmg (electron-builder, arm64)
```

## License

[MIT](LICENSE) © LCINO
