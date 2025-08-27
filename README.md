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

All Api Endpoints

| Method | Endpoint            | Description                                            |
| ------ | ------------------- | ------------------------------------------------------ |
| GET    | /api/files          | List files in a directory (`query: path`)              |
| POST   | /api/files/create   | Create new file or folder (`body: { path, type }`)     |
| POST   | /api/files/rename   | Rename a file or folder (`body: { oldPath, newPath }`) |
| POST   | /api/files/delete   | Delete a file or folder (`body: { path }`)             |
| GET    | /api/files/download | Download a file (`query: path`)                        |
| GET    | /api/files/read     | Read file content (`query: path`)                      |
| POST   | /api/files/write    | Write file content (`body: { path, content }`)         |

Api config call

| Method | Endpoint    | Description                                                   |
| ------ | ----------- | ------------------------------------------------------------- |
| POST   | /api/config | Update configuration (`body: JSON object of config settings`) |



