# X Cleanup Tool

A browser-console tool that adds a small floating control panel to your X (Twitter) profile, letting you bulk-delete tweets, unlike posts, and undo reposts on your own account — with dry-run previews, safety confirmations, and paced timing to reduce the risk of rate-limiting.

Built by **Michael Adedapo** — [github.com/mrmikeade](https://github.com/mrmikeade)

---

## ⚠️ Disclaimer

This is an **unofficial** tool. It is not affiliated with, endorsed by, or supported by X Corp. It works entirely by simulating clicks inside your own logged-in browser session on your own account — it does not use private APIs or bypass login.

- **Deleting tweets is permanent and cannot be undone.**
- Bulk automated actions may run against X's automation rules and could trigger rate-limiting or a temporary account restriction.
- Use this tool entirely at your own risk. Always try **Dry Run** mode first.

---

## Features

- **Delete Tweets** — deletes tweets from your Posts tab (automatically skips your pinned tweet)
- **Unlike All** — unlikes tweets from your Likes tab
- **Undo Reposts** — undoes reposts from your Posts tab
- **Get Stats** — best-effort read of your profile's visible post count
- **Dry Run mode** — preview exactly what would be deleted/unliked/undone, with no actual changes made
- **Confirmation step** before any delete run starts
- **Editable delay range** (default: random 2–4 seconds between actions) to keep the pace human-like
- **Auto-stop** after repeated consecutive failures (a likely sign of rate-limiting or X changing its page layout)
- **Runs correctly in background tabs** — timing uses a Web Worker so it isn't stalled by browser tab-throttling when you switch away
- Live status report shown directly in the panel as it works

---

## How it works

The script is pasted into your browser's DevTools console while you're logged into X. It injects a small floating panel into the page and simulates the same clicks you'd make manually (opening a tweet's menu, clicking delete, confirming, etc.), just automatically and at a randomized pace.

It does **not**:
- Store, transmit, or send your data anywhere
- Use your API keys or credentials
- Run outside of your own browser tab

---

## Installation / Usage

1. Open [x.com](https://x.com) and log in.
2. Go to your own profile: `https://x.com/<your_handle>`
3. Open DevTools:
   - **Chrome/Edge:** `F12` or `Ctrl+Shift+J` (`Cmd+Option+J` on Mac)
   - **Firefox:** `F12` or `Ctrl+Shift+K`
4. Click the **Console** tab.
5. Copy the entire contents of [`twitter-cleanup-panel.js`](./twitter-cleanup-panel.js) and paste it into the console, then press `Enter`.
6. A control panel appears in the bottom-right corner of the page.

### Recommended first run

1. Tick **Dry run (preview only, no changes)**.
2. Navigate to the tab you want to act on (see table below).
3. Click the matching button and watch the status box — it will report what it *would* do without changing anything.
4. When you're confident, untick Dry Run and run it for real.

### Buttons

| Button | What it does | Tab you need to be on |
|---|---|---|
| **Get Stats** | Reads your profile's visible post count | Your profile page |
| **Delete Tweets** | Deletes your tweets one by one (skips pinned tweet) | Posts tab |
| **Unlike All** | Unlikes tweets | Likes tab |
| **Undo Reposts** | Undoes reposts | Posts tab |
| **Stop** | Halts whatever loop is currently running | — |

### Settings in the panel

- **Dry run** — toggle preview mode on/off at any time before starting an action
- **Delay (sec)** — adjust the min/max random delay between each action; increase this if you're worried about rate limits

### Stopping

Click **Stop** in the panel at any time — it finishes the current step and halts before the next one. You can also re-paste the script at any point; it will automatically stop any previous run and replace the panel.

---

## Troubleshooting

- **Buttons aren't doing anything / nothing gets found:** X periodically changes its page structure. Open `twitter-cleanup-panel.js` and check the `SELECTORS` object near the top — inspect the relevant element on the page (right-click → Inspect) and update the selector there.
- **It auto-stopped with a warning about repeated failures:** This is intentional — it means several actions in a row failed, which usually means either a selector is out of date or X is rate-limiting you. Wait a while before retrying, and consider increasing the delay range.
- **It seems to pause when I switch tabs:** This version uses a Web Worker for timing specifically to avoid that. If your browser's battery/memory saver mode is discarding the tab entirely after long idle periods, add x.com as an exception in your browser's power-saving settings, or just keep the window visible on screen (it doesn't need to be focused).

---

## License

MIT — free to use, modify, and share. No warranty of any kind. See [`LICENSE`](./LICENSE) for details.

## Author

**Michael Adedapo**
GitHub: [@mrmikeade](https://github.com/mrmikeade)
