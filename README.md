# Renderless Studio

Renderless Studio is a React + TypeScript broadcast graphics prototype for building templates in **Design**, driving live values from **Data Engine**, operating takes in **Control Room** (PST/PGM), and validating final output in **Output**.

---

## Purpose & Scope

- Build and edit graphics templates with layered assets/text/shapes.
- Bind text layers to simulated live baseball data.
- Save templates persistently and load/take them in playout views.
- Generate per-template public feed URLs and a program output feed URL.
- Manage branded assets and template folders in explorer-style UI.

Current scope is an MVP focused on local development/testing and operator workflow realism.

---

## Architecture (brief)

- **Frontend shell/routes**: `src/routes/*`
  - `DashboardRoute` (assets/templates/fonts entry)
  - `DesignRoute` (3-column Stage Pro editor)
  - `DataEngineRoute` (baseball simulation controls)
  - `ControlRoomRoute` (PST/PGM + queue actions)
  - `OutputRoute` (program monitor + output URL)
  - `PublicTemplateRoute` and `PublicOutputRoute` (public feed rendering)
- **Feature modules**: `src/features/*`
  - `assets/*` explorer UIs
  - `playout/*` rendering + live binding + URL helpers
  - `studio/*` modular workspace components (continuing migration path)
- **State stores (Zustand)**: `src/store/*`
  - `useLayerStore`, `useAssetStore`, `useTemplateStore`, `useDataEngineStore`, `usePlayoutStore`, `useStudioStore`
- **Domain contracts**: `src/types/domain.ts`

---

## Stack (exact versions currently configured)

From `package.json`:

- `react` **^18.3.1**
- `react-dom` **^18.3.1**
- `react-router-dom` **^6.28.1**
- `zustand` **^5.0.1**
- `vite` **^5.4.10**
- `typescript` **^5.6.3**
- `tailwindcss` **^3.4.16**
- `postcss` **^8.4.49**
- `autoprefixer` **^10.4.20**
- `@vitejs/plugin-react` **^4.3.4**

Local toolchain observed in this environment:

- Node.js: `v22.21.1`
- npm: `11.4.2`

---

## Run locally

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

Open:

- App: `http://localhost:4173`
- Optional direct routes:
  - `http://localhost:4173/design`
  - `http://localhost:4173/control-room`
  - `http://localhost:4173/output`

Build production bundle:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

---

## Seeds & persistence

### Seed/demo data

- Seed branded assets are defined in `bootstrap-data.js` (sample dimensions: 1920x1080, 1080x1920, 1080x1350, 1080x1080).
- Data Engine uses an in-app pitch-by-pitch baseball simulation for live-bind testing.

### Browser persistence keys

- Branded asset explorer: `renderless.fileExplorer.v1`
- Template asset-library explorer: `renderless.templateLibrary.v1`
- Saved design templates: `renderless.savedDesignTemplates.v1`

If local data seems stale, clear browser storage for the app origin.

---

## Public feed URL behavior

- Per-template public feed:
  - `/template-feed/:templateId?tpl=<encoded_payload>`
- Output/public program feed:
  - `/output-feed?tpl=<encoded_payload>`

These are generated via `src/features/playout/publicUrl.ts`.

---

## Changelog-lite (recent decisions)

- Migrated from legacy monolithic `app.js` flow to modular Vite/React/TypeScript routes + Zustand stores.
- Standardized Design into 3-column Stage Pro workflow (layers/assets left, canvas center, inspector right).
- Added persistent template save/load path connected to Control Room and Output.
- Added live data-binding rendering in PST/PGM/Output.
- Unified playout/public rendering through a shared SVG scene renderer (`TemplateSceneSvg`) to reduce PST/PGM/Output clipping mismatches.

