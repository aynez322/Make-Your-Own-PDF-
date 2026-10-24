# MYOPDF – Make Your Own PDF

Collect the pages you need from your course PDFs with a hotkey, then download them as one summary PDF.

## Install (Chrome / Edge / Brave)

1. Run `npm install && npm run copy-libs`.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the `extension` folder.
3. Optional, for PDFs saved on your computer: on the MYOPDF card click **Details** and turn on **Allow access to file URLs**.

After you edit the code, click ↻ on the MYOPDF card and reopen any MYOPDF tabs.

## Use it

| Action | Shortcut |
|---|---|
| Add / remove the current page | **Alt+Shift+A** |
| Undo the last added page | **Alt+Shift+Z** |
| Open the summary | **Alt+Shift+S** |

You can change these at `chrome://extensions/shortcuts`.

- PDFs from websites open in MYOPDF automatically. For downloaded PDFs, drag them onto a MYOPDF tab or use the popup.
- The **☰** sidebar shows page thumbnails and chapters. Ctrl+click a thumbnail to add that page, Ctrl+right-click to remove it.
- On the **Summary** page, drag pages to reorder them, then click **Download PDF**. **🗑 Clear summary** removes every page.

Everything stays on your computer. Exported pages are copied from the originals, so the text stays sharp and searchable.

## Known limits

- If a site only serves a PDF while you're logged in, download the file and drag it in.
- PDFs embedded in another page (iframe) aren't opened automatically. Right-click the link → *Open PDF in MYOPDF*.
- Firefox isn't supported.

Built on PDF.js (Apache-2.0) and pdf-lib (MIT). `npm run build` creates `dist/myopdf.zip`.
