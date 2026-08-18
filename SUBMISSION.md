# Obsidian Community Plugins submission checklist

## Before publishing

- Publish this directory as a public GitHub repository.
- Confirm the repository default branch contains `README.md`, `LICENSE`, `manifest.json`, and `versions.json`.
- Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Manually test every command on desktop and mobile Obsidian.

## First release

- Keep `package.json`, `manifest.json`, and `versions.json` at the same version.
- Create a tag exactly matching the manifest version, such as `0.1.0` (not `v0.1.0`).
- Push the tag and confirm the release workflow attaches `main.js`, `manifest.json`, and `styles.css`.
- Test installation from that release, optionally with BRAT before public submission.

## Directory submission

- Sign in to `community.obsidian.md` and link the GitHub account that owns the repository.
- Open **Plugins → New plugin**, provide the repository URL, accept the developer policies, and submit.
- Address automated review findings with a new version and matching GitHub release.
