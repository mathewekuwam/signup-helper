<<<<<<< HEAD
# 🚀 Signup Helper & Extension Generator

> **Turn any manual signup or web workflow into a standalone Manifest V3 Chrome Extension — with zero dependencies and privacy built in.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Pure JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-blue.svg)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## 📌 About the Project

**Signup Helper** is a dual-purpose developer and productivity tool built for Google Chrome (and Chromium browsers). It acts as a **smart workflow recorder** and a **zero-dependency extension compiler**.

Instead of writing complex Puppeteer/Selenium scripts or manual web-scraping bots, Signup Helper allows you to perform any onboarding, registration, or multi-step form process once. The extension records the interaction structure, compiles it in-memory, and generates a **ready-to-use, tailored Chrome Extension packaged in a `.zip` file**.

### 🌟 Key Highlights

- 🔒 **Privacy-First Recording**: Keystrokes and passwords are **never** stored. The recorder captures element signatures (IDs, test IDs, names, aria labels, placeholders) and data types (`email`, `digits`, `text`), keeping all sensitive credentials private.
- 📦 **In-Browser ZIP Compilation**: Zero third-party dependencies! Includes a custom, pure JavaScript PKZIP implementation (`makeZip` with custom CRC32 calculation) that builds and downloads the generated extension zip directly from the browser.
- ⚛️ **Modern Framework Compatible**: Dispatches native and React/Vue-compatible synthetic input events (`Event('input')`, `Event('change')`, property descriptor overrides) to ensure modern SPAs detect filled values without glitches.
- 🔢 **Intelligent OTP & Verification Detection**: Automatically identifies single-character verification boxes (e.g., 4-digit or 6-digit OTP fields) and handles multi-box distribution or on-screen prompt dialogues.
- ⚙️ **Built-in Rules & Conditions Engine**: The generated extension includes an options dashboard allowing conditional logic (`goto`, `stop`, `wait`, `save`), page state triggers (`pageHasText`, `elementExists`, `urlContains`), and dynamic templating (`{{email}}`, `{{now}}`, `{{text:selector}}`).
- 📂 **JSON Data Integration**: Supply batch signup values via a local JSON file path or a direct file picker, and output run results automatically into your `Downloads` directory.

---

## 🏗️ How It Works

```
┌────────────────────────────────┐
│   1. Manual Action Recording   │  recorder.js & background.js
│   • Clicks, typing, Enter key  │  Captures semantic selectors & DOM snapshots
│   • Privacy-safe field parsing │  (No passwords or raw values saved)
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│   2. Distillation & Building   │  generator.js
│   • Action deduplication       │  Analyzes recording & packages
│   • Host scoping & Manifest    │  complete MV3 extension files into .zip
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│   3. Generated Extension Run   │  runner.js, popup.js, options.js
│   • Automated replay engine    │  Runs form filling, prompts for OTP,
│   • Rule conditions & storage  │  and saves results to Downloads folder
└────────────────────────────────┘
```

---

## 📁 Repository Structure

```plaintext
signup-helper/
├── manifest.json       # Manifest V3 configuration for the main helper extension
├── background.js       # Background service worker (badge indicator & recording queue)
├── recorder.js         # Content script injected across pages to monitor user interactions
├── generator.js        # Core engine: Action distillation, zip compilation, code templates
├── popup.html          # Extension popup UI (record controls, JSON import/export, run test)
├── popup.js            # Controller for recorder triggers, export actions, and test runs
└── content.js          # Standalone quick-test automation script for standard email/OTP flows
```

### Detailed Component Overview

| File | Purpose |
| :--- | :--- |
| **[`manifest.json`](manifest.json)** | Declares Manifest V3 permissions (`activeTab`, `scripting`, `storage`), service worker, and recorder content script injection. |
| **[`background.js`](background.js)** | Maintains a step-queue with sequential async locks, writes steps to `chrome.storage.local`, and controls the `● REC` badge. |
| **[`recorder.js`](recorder.js)** | Listens to clicks, debounced inputs, and Enter keys. Generates resilient CSS paths, inspects `data-testid`, tags dialogs, and records snapshot metadata. |
| **[`generator.js`](generator.js)** | The heart of the project. Contains `distill()`, dynamic code generation for `runner.js`, `options.html`, `popup.html`, and an in-memory binary ZIP writer (`makeZip`). |
| **[`popup.html`](popup.html)** / **[`popup.js`](popup.js)** | The user dashboard to Start/Stop recording, copy/download recorded JSON, paste existing JSON, or trigger the built-in test runner. |
| **[`content.js`](content.js)** | An included reference automation script demonstrating programmatic input filling, modal observation, and on-page OTP prompt dialogs. |

---

## 🚀 Installation & Quick Start

### 1. Load the Recorder Extension

1. Clone or download this repository to your local computer:
   ```bash
   git clone https://github.com/YOUR_USERNAME/signup-helper.git
   ```
2. Open Google Chrome (or Edge/Brave) and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `signup-helper` folder containing `manifest.json`.

---

### 2. Record a Flow & Generate Your Automation

1. Navigate to the website where you want to automate signup or form entry.
2. Click the **Signup Helper** extension icon in your browser toolbar.
3. Click **Start recording** (a red `REC` badge appears on the extension icon and in the bottom-left corner).
4. Perform the signup or workflow manually in the browser tab.
5. Once complete, click the extension icon and select **Stop & build extension**.
6. A `.zip` file (named e.g. `auto-signup-<domain>.zip`) will automatically download to your computer!

---

### 3. Load & Run Your Generated Automation

1. Unzip the downloaded `.zip` file.
2. Go to `chrome://extensions` and click **Load unpacked**.
3. Select the unzipped folder.
4. Open the target website tab and click your newly installed extension.
5. (Optional) Provide an email override or configure values in the extension settings.
6. Click **Run on this tab** to watch the automation execute automatically!

---

## ⚙️ Advanced Features & Configuration

### Dynamic Values File (`values.json`)

The generated extension allows loading input values dynamically so you can run the automation for different accounts or datasets without changing code.

Create a `values.json` file:
```json
{
  "email": "alex.dev@example.com",
  "fullName": "Alex Developer",
  "username": "alexdev99"
}
```

In the generated extension's **Settings (options.html)** page:
- **Option A (File Path)**: Enter your local file path (e.g. `C:\data\signup-values.json` or `/Users/alex/signup-values.json`). Re-read on every execution! *(Note: Requires enabling "Allow access to file URLs" in `chrome://extensions` -> Extension Details).*
- **Option B (File Picker)**: Upload the JSON file directly to store it inside the extension.

---

### Rules & Conditions Engine

Each generated extension comes with a programmable rules engine configured through the settings page:

```json
{
  "output": { "file": "AutoSignup/results.json" },
  "steps": {
    "4": { "optional": true, "timeout": 15000 }
  },
  "rules": [
    {
      "name": "Log verification request",
      "when": { "step": 4, "event": "reached" },
      "do": [
        { "save": { "email": "{{email}}", "status": "code requested", "timestamp": "{{now}}" } }
      ]
    },
    {
      "name": "Skip OTP if already verified",
      "when": { "step": 4, "event": "skipped" },
      "do": [ { "goto": 6 } ]
    },
    {
      "name": "Detect account exists error",
      "when": { "pageHasText": "email already registered" },
      "do": [
        { "save": { "email": "{{email}}", "status": "already registered" } },
        { "stop": "Email already registered" }
      ]
    },
    {
      "name": "Capture confirmation details on completion",
      "when": { "step": 5, "event": "done" },
      "do": [
        { "save": { "email": "{{email}}", "accountTitle": "{{text:h1}}", "url": "{{url}}" } }
      ]
    }
  ]
}
```

#### Supported Rule Triggers (`when`)
- `step`: Target step number (1-indexed).
- `event`: Trigger lifecycle (`reached`, `done`, `skipped`, `failed`).
- `pageHasText`: String match against document text.
- `elementExists`: CSS selector check.
- `urlContains`: Partial URL substring match.

#### Supported Rule Actions (`do`)
- `save`: Writes structured output records (supports `{{email}}`, `{{url}}`, `{{title}}`, `{{now}}`, `{{text:cssSelector}}`).
- `goto`: Jumps to a specific step index.
- `continue`: Skips failure and proceeds to next step.
- `wait`: Pause execution for specified milliseconds.
- `stop`: Halts the automation with an error or status message.

---

## 🔒 Privacy & Security

- **Zero Remote Telemetry**: No third-party network requests, analytics, or tracking scripts are included. Everything executes strictly on your local browser.
- **Credential Protection**: Typed passwords and raw keystrokes are never recorded by `recorder.js`.
- **Scoped Host Permissions**: The generated extension is scoped strictly to the origin domain of the recorded website (`https://example.com/*`).

---

## 🛠️ Tech Stack

- **Platform**: Google Chrome Extensions (Manifest Version 3)
- **Language**: Vanilla JavaScript (ES2022+), HTML5, CSS3
- **Storage**: Chrome Storage API (`chrome.storage.local`)
- **Scripting**: Chrome Scripting API (`chrome.scripting.executeScript`)
- **Packaging**: Custom in-memory binary PKZIP encoder

---

## 🤝 Contributing

Contributions, feedback, and improvements are welcome!
1. Fork this repository.
2. Create a feature branch: `git checkout -b feature/awesome-feature`
3. Commit your changes: `git commit -m "Add awesome feature"`
4. Push to branch: `git push origin feature/awesome-feature`
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
=======
# signup-helper
Record any manual signup or web workflow and compile it into a standalone Manifest V3 Chrome Extension. Zero dependencies, privacy-first, and fully customizable with rules and JSON data.
>>>>>>> f0e1184ec7bb401e8bb012bfa71f7f96f4538a9d
