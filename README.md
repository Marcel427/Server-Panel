# Server Panel

**Version:** 1.0.0  
**Author:** Kenshi9999

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
