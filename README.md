# ServerPanel demo

This repository contains a small frontend demo (index.html, style.css, script.js) and a tiny Node/Express server in `src/server.js`.

Quick start (Windows PowerShell):

1. Install dependencies:

```powershell
npm install
```

2. Start the server:

```powershell
npm start
```

3. Open http://localhost:3000 in your browser.

What it provides:
- Serves the UI at `/`.
- `/api/metrics` returns basic metrics.
- `/api/activity` returns recent activity.
- `POST /api/features` accepts feature selections.
