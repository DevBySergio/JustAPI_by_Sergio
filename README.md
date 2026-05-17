# JustAPI ⚡

**JustAPI** is a local-first API client built directly into VS Code. Design, test, and debug HTTP requests without leaving your editor — and without sending your data anywhere.

Unlike cloud-based tools, **JustAPI works 100% locally**. Your requests, collections, and variables never leave your machine.

---

## ✨ Key Features

### 1. 🚀 Full HTTP Client

Execute requests with any method (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD) with full control:

- **Redirect Following** — Automatic 3xx handling (configurable per request)
- **SSL/TLS Toggle** — Enable/disable certificate verification
- **Configurable Timeout** — Per-request timeout in milliseconds
- **Content-Type Auto-Detection** — Auto-sets headers based on body type
- **Response Timing** — Duration measurement for every request
- **Error Classification** — Categorized errors (network, timeout, DNS, SSL) with troubleshooting hints

### 2. 📁 Collection Manager

Organize your requests with a powerful collection system:

- **Nested Folders** — Create folders inside collections with sub-folders and requests
- **Duplicate, Rename, Move** — Full CRUD with drag-free management
- **Import / Export** — Share collections as JSON
- **cURL Import** — Paste any cURL command and parse it automatically

### 3. 🔤 Variable Engine

Dynamic request building with `{{variable}}` interpolation everywhere (URL, headers, query params, body):

- **Four Scopes with Priority** — Global &lt; Variable Sets &lt; Collection &lt; Request
- **Variable Sets** — Reusable groups linkable to multiple collections
- **Inline Autocomplete** — Type `{{` and get scope-aware suggestions with keyboard navigation
- **Syntax Highlighting** — Visual highlighting of `{{variable}}` references in all text inputs
- **Conflict Detection** — Warnings when the same name exists in multiple scopes

### 4. 🔐 Authentication Builder

Built-in visual auth without manual header fiddling:

- **Bearer Token** — `Authorization: Bearer <token>`
- **Basic Auth** — `Authorization: Basic <base64>`
- **API Key** — Custom header or query parameter

### 5. 📊 Rich Response Viewer

Inspect responses in detail:

- **Status & Timing** — Color-coded status (2xx green, 4xx orange, 5xx red), duration, size
- **JSON Tree View** — Interactive collapsible tree with syntax highlighting
- **Raw / Formatted Toggle** — Pretty-print or raw JSON
- **XML Formatting** — Indentation-based XML pretty printer
- **Image Rendering** — Inline display of image responses
- **Headers & Cookies** — Parsed response headers and `Set-Cookie` inspection
- **Search** — Find-in-page with highlighting
- **Copy** — One-click copy of the full response body

### 6. 📜 History

Never lose a request:

- **Chronological List** — Newest first with method badges and timestamps
- **Replay** — Click any entry to reload the request into the editor
- **Filter** — Search by URL, method, or status code
- **Auto-Cap** — Maintains max 200 entries

### 7. 💻 Code Generation

Generate production-ready code from your current request:

- JavaScript (Fetch API)
- TypeScript (Fetch API)
- Python (requests)
- cURL
- C# (HttpClient)
- Java (java.net.http)
- Go (net/http)

### 8. 🔎 Global Search

Search across collections, folders, requests, and history from a single bar.

---

## 🚀 How to Use

Open the **JustAPI** activity bar icon (⚡) in the sidebar, or use the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                          | Description                         |
| -------------------------------- | ----------------------------------- |
| `JustAPI: New Request`           | Create a blank request              |
| `JustAPI: Import from cURL`      | Parse a cURL command from clipboard |
| `JustAPI: Export Collection`     | Export collection as JSON           |
| `JustAPI: Import Collection`     | Import collection from JSON         |
| `JustAPI: Open History`          | Open request history                |
| `JustAPI: Create Variable`       | Open variable editor                |
| `JustAPI: Generate Code Snippet` | Generate code from current request  |

### Keyboard Shortcuts

| Shortcut                   | Action           |
| -------------------------- | ---------------- |
| `Ctrl+Alt+N` / `Cmd+Alt+N` | New Request      |
| `Ctrl+Alt+V` / `Cmd+Alt+V` | Import from cURL |

---

## 🛡️ Privacy

Your data is yours.

- **No Telemetry** — This extension does **NOT** send any data to external servers
- **Local Storage** — All requests, collections, and variables are stored in a local JSON file in your VS Code user directory
- **No Account Required** — No sign-up, no API keys, no cloud

---

## 📝 License

This project is licensed under the MIT License.

---

**Happy coding!** ⚡
