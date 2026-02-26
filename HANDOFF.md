# HANDOFF.md

This document is for the **next fresh agent/session** to continue work without prior chat context.

---

## 1) Current status snapshot

Project: **Renderless Studio** (Vite + React + TypeScript + Zustand + Tailwind)

High-level workflow currently in place:
1. Build/edit graphic in **Design**.
2. Save template to persistent template store.
3. Load template to PST in **Control Room**.
4. Take to PGM/Program.
5. Validate in **Output** and public feed routes.

Recent docs update completed:
- `README.md` replaced with up-to-date project architecture, stack, runbook, persistence keys, feed URL behavior, and recent decisions.
- `HANDOFF.md` added (this file).

---

## 2) Open challenges / known risks

1. **UI parity is still sensitive**
   - User has repeatedly requested pixel-consistent parity between Design, PST/PGM, Output, and public feeds.
   - Any transform/render changes should be verified across all 4 surfaces.

2. **Persistence expectations are high**
   - User expects uploads and templates to persist locally across sessions.
   - Confirm localStorage limits and behavior when large images are uploaded.

3. **Operator-grade UX expectations**
   - User is treating this as a live sports graphics console.
   - UX regressions (stack behavior, layer controls, feed correctness) are high priority.

---

## 3) Immediate next steps (recommended)

1. Run full smoke pass:
   - Design: add asset/text/shape, bind text, save template.
   - Control Room: load preview, take to program.
   - Output: verify live program and copy output URL.
   - Public routes: open copied URLs and verify live updates.

2. Validate no clipping/cutoff regressions in PST/PGM/Output at multiple viewport sizes.

3. If user reports mismatch, inspect:
   - `src/features/playout/TemplateSceneSvg.tsx`
   - `src/features/playout/TemplatePreview.tsx`
   - `src/routes/PublicTemplateRoute.tsx`
   - `src/routes/PublicOutputRoute.tsx`

---

## 4) Key paths, artifacts, datasets

### Core paths
- Routes: `src/routes/`
- Stores: `src/store/`
- Playout/rendering: `src/features/playout/`
- Asset/template explorers: `src/features/assets/`
- Domain contracts: `src/types/domain.ts`
- Seed bootstrap: `bootstrap-data.js`

### Storage keys/contracts
- `renderless.fileExplorer.v1` → branded assets explorer tree
- `renderless.templateLibrary.v1` → template library explorer tree
- `renderless.savedDesignTemplates.v1` → saved design templates

### URL contracts
- Per-template public feed: `/template-feed/:templateId?tpl=<payload>`
- Output feed: `/output-feed?tpl=<payload>`

---

## 5) Schemas/contracts and expected outputs

Primary layer contract (`src/types/domain.ts`):
- `Layer` union:
  - `TextLayer` (`kind: 'text'`): text, font, color, data binding fields, text align/mode + transform props.
  - `ShapeLayer` (`kind: 'shape'`): rectangle/ellipse, width/height, fill + transform props.
  - `AssetLayer` (`kind: 'asset'`): asset reference + width/height + transform props.
- Shared transform fields: `x`, `y`, `anchorX`, `anchorY`, `scaleX`, `scaleY`, `rotation`, `opacity`, `zIndex`, `visible`, `locked`.

Expected output behavior:
- Layer order (`zIndex`) is respected consistently in Design, PST/PGM, Output, and public feeds.
- Data-bound text values update when Data Engine state updates.
- Public/template feeds should render without app chrome and without clipping.

---

## 6) Recent test results & logs

Latest validated commands (local run in this environment):

- `npm run build` ✅
- `npm run dev -- --host 0.0.0.0 --port 4173` ✅
- Playwright visual pass on `/control-room` and `/output` ✅ (artifacts produced in browser tool temp path)

Note:
- `npm` warns about unknown env config `http-proxy` in this environment; build/dev still succeed.

---

## 7) Environment + package management notes

### Exact environment observed
- Node.js: `v22.21.1`
- npm: `11.4.2`
- Package manager in use: **npm**

### Do NOT create duplicate environments
- This repo is JS/TS (no `venv`, `conda`, or `poetry` expected).
- Use existing `node_modules` under repo root.
- Do not introduce yarn/pnpm lockfiles unless explicitly requested.

### Standard commands
```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
npm run build
npm run preview
```

---

## 8) Working norms requested by user

- Keep getting closer to previous UI/UX feel when asked.
- Avoid regressions; validate visually when touching Design/Control/Output rendering.
- Prefer intuitive broadcast-operator workflows over placeholder UI.

