# Veodyn documentation

The product documentation site, built with [Docusaurus](https://docusaurus.io/).
Content lives in `docs/` (this directory's `docs/` subfolder), screenshots in
`static/img/screenshots/`.

The loose `*.md` files next to this README are engineering notes for this
repository. They are not part of the published site, and they are addressed to
this team rather than to a reader who has just cloned the tree:
`scripts/public_tree_forbidden_paths.py` decides which of them travel, and the
answer for a note written for us is that it does not. Anything a public reader
needs belongs in `docs/`, written for that audience.

## Develop

```bash
npm install
npm start        # dev server with hot reload
```

## Build

```bash
npm run build    # static site into build/; fails on broken links
npm run serve    # preview the production build
```
