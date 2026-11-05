# Contributing to Superpower PiP

Thanks for taking the time to contribute! This project stays deliberately small: vanilla JavaScript, no build system, no dependencies, minimal permissions.

## Ways to help

- **Report a bug** — open an [issue](https://github.com/SnegOwo/SuperPower-PiP/issues) with a clear title.
- **Suggest a feature** — explain the use case first, not only the solution.
- **Send a pull request** — bug fixes, site compatibility, docs and accessibility improvements are all welcome.
- **Translate** — the UI is English-first; localization proposals are welcome as issues.
- **Review** — testing the extension on different sites and Chrome versions is genuinely useful.

## Reporting a bug

Please include:

1. Chrome version (`chrome://version`).
2. Extension version (popup footer or `manifest.json`).
3. The site URL where it fails (public URLs only — never paste private tokens, cookies or account pages).
4. Steps to reproduce.
5. What the **Diagnostics** panel shows for that page.
6. Console errors from the popup (`chrome://extensions` → **Inspect views: popup**).

> Security issues: please **do not** open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/SnegOwo/SuperPower-PiP/security/advisories/new) instead.

## Development setup

```bash
git clone https://github.com/SnegOwo/SuperPower-PiP.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the repository folder
4. After editing:
   - popup files (`popup/*`) → reopen the popup
   - `background.js` → click **Reload** on the extension card
   - `content/pip-core.js` → reload the target tab (it is re-injected on demand)

No `npm install`, no bundler, no transpilation. Push your changes and the landing page (`index.html`) redeploys through Vercel.

## Project conventions

- **Vanilla only** — no frameworks, no runtime dependencies, no CDN scripts in the extension (the site may use Tailwind via CDN).
- **Minimal permissions** — never add a permission without a concrete need; prefer the `activeTab` + on-demand injection model.
- **Local-first** — no network request, no telemetry, no remote config.
- **Self-contained content script** — `content/pip-core.js` is injected as a function and must not rely on extension globals.
- **English** — code, comments, commit messages, docs and UI strings.
- **Formatting** — 4 spaces, semicolons, single quotes in JS; keep existing style in each file.
- **Compatibility** — feature-detect newer APIs (for example Document PiP) and always keep a native fallback.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short imperative summary>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `ci`.
Example: `fix(popup): keep volume slider in sync after the video changes`

Keep each commit focused on one logical change.

## Pull request checklist

- [ ] The extension loads without errors in `chrome://extensions`.
- [ ] Tested on at least one regular page and one iframe-based player.
- [ ] PiP works through the popup, the keyboard shortcut and the context menu.
- [ ] No new permission unless strictly necessary.
- [ ] No new dependency, no network call, no tracking.
- [ ] Docs updated if behaviour or settings changed.

By submitting a pull request, you agree to license your contribution under the [MIT License](LICENSE).
