# Portal and download publication

Maintained by zerodayprime for the team at [Fanclan.io](https://fanclan.io).

The production branch is `main`. GitHub checks cover the production build, static checks, unit tests and browser tests. Vercel publishes the static site from this branch. The application has no server recording endpoints, media buckets, upload handlers or cloud relay.

## Dashboard artifact

Run `npm ci`, the required checks, and `npm run build:artifact` on the exact release commit. Publish the generated dashboard archive, checksum and manifest together in an immutable GitHub release. The Companion pins both the archive checksum and the hash of every bundled file. Never replace a released archive in place; use a new version if its content changes.

The portal build also produces its hosted copy from the same dashboard source. The bundled dashboard uses its own origin; the hosted dashboard targets the local companion. Pairing and media credentials must never be sent to the public site or included in published artifacts.

## Verified downloads

`src/data/releases.json` is controlled by the release maintainer. Add a release only after downloading each published asset, verifying its SHA-256 and platform metadata, and checking the matching installation/test evidence. Each entry contains `version`, `date`, `verified: true`, `notes`, and `artifacts` with a descriptive `label`, HTTPS `url`, and SHA-256 `sha256`.

Do not mark an entry verified merely because a build job succeeded or an asset URL was constructed. Keep the manifest empty until distributable candidates pass their release gates. Beta assets must be explicitly labeled as unsigned where applicable; stable installers additionally require signing and notarization evidence. Documentation and contract-only releases are not application downloads.

Production canonical URLs, sitemap, Open Graph images and repository homepages must use the actual verified production address. Preview deployments remain protected and excluded from indexing. The `/app/` dashboard is always excluded from indexing.
