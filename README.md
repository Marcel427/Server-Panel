# Server Panel

**Version:** 1.0.0  
**Author:** Your Name  
**License:** MIT  

A web-based server management panel with file management, editor, and settings.

---

## Tabs

### 1. File Management

**Description:** Browse, create, rename, delete, upload, and download files and folders in your server.

**Features:**
- File browser with folder navigation
- Create new files or folders
- Rename or delete files/folders
- Upload files to current directory
- Search functionality for files and folders
- Three-dot context menu for file actions

**Usage:**
- Click a folder to navigate into it
- Click a file to open it in the editor
- Use the context menu (⋮) for options like Edit, Download, Delete, Rename
- Use the Upload button to add new files to the current directory

---

### 2. File Editor

**Description:** Edit files directly in the browser with live save options.

**Features:**
- In-page text editor for files
- Supports syntax highlighting
- Save changes instantly
- Dark/light theme support
- Toast notifications for save status or errors

**Usage:**
- Click on a file to open it in the editor
- Make changes in the textarea
- Click **Save** to write changes to the server
- Close the editor with the ✖ button

---

### 3. Settings

**Description:** Configure server panel options, PM2 integration, theme, and start folder.

**Features:**
- Instantly save configuration changes
- Toggle Dark/Light theme
- Enable or disable PM2 process management
- Set default folder for file operations
- Max activity events configuration

**Usage:**
- Navigate to the **Settings** tab
- Change any value and it is saved automatically
- Theme and PM2 toggle buttons save instantly
- Max activity and start folder updates are saved to `config.json`

---

## Installation

1. Clone the repository:  
```bash
git clone <repo-url>
Navigate to project folder:

bash
Code kopieren
cd server-panel
Install dependencies:

bash
Code kopieren
npm install
Start server:

bash
Code kopieren
node server.js
Optional: Start with PM2:

bash
Code kopieren
pm2 start server.js --name server-panel
API Endpoints
/api/files
Method	Endpoint	Description
GET	/api/files	List files in a directory (query: path)
POST	/api/files/create	Create new file or folder (body: { path, type })
POST	/api/files/rename	Rename a file or folder (body: { oldPath, newPath })
POST	/api/files/delete	Delete a file or folder (body: { path })
GET	/api/files/download	Download a file (query: path)
GET	/api/files/read	Read file content (query: path)
POST	/api/files/write	Write file content (body: { path, content })

/api/config
Method	Endpoint	Description
POST	/api/config	Update configuration (body: JSON object of config settings)

Notes
Requires Node.js and npm

PM2 recommended for production

Supports Windows, Linux, macOS (path adjustments may be needed)

All settings and file operations are reflected live in the panel

Contributing
Submit pull requests or issues. Follow the existing structure and style for consistency.
