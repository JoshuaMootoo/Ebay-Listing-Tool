# eBay Bulk Listing Tool — Chrome Extension

Automates adding variations and uploading variation images on eBay listing pages.

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The extension icon will appear in your toolbar

---

## Variations tab

Reads a `.txt` file (one variation per line) and for each line:
1. Clicks **Create your own** (`#msku-custom-option-link`)
2. Types the variation name into the input box
3. Clicks **Add**

### Usage

1. Open your eBay listing and navigate to the **Variations** section
2. Click the extension icon → **Variations** tab
3. Select your `.txt` file (one variation per line)
4. Adjust the delay between additions if needed (default 800 ms)
5. Click **Start Adding Variations**

### Text file format

```
001 / 185 - Weedle
002 / 186 - Kakuna
003 / 187 - Beedrill
```

Blank lines are ignored. A sample file is included at `extension/sample_variations.txt`.

---

## Images tab

Uploads an image to each variation's photo slot. Requires three inputs:

| Input | Description |
|-------|-------------|
| **Variations .txt** | Same file used in the Variations tab — determines the order and names of variations |
| **Image filenames .txt** | One image filename per line, in the same order as the variations |
| **Image folder** | Folder containing all the image files |

### Usage

1. Open your eBay listing and make the **Variations** section visible (the photo upload UI must be on screen)
2. Click the extension icon → **Images** tab
3. Select all three inputs
4. Adjust the wait time after each upload if needed (default 3000 ms)
5. Click **Start Uploading Images**

The extension will:
1. Find the listing frame and the shared picupload iframe
2. For each row, click the variation's button to select it
3. Inject the image file into the shared `input#DEFAULT` in the picupload frame
4. eBay routes the upload to whichever variation is currently active

### Image filenames file format

```
weedle.jpg
kakuna.jpg
beedrill.jpg
```

Lines must match filenames exactly (case-insensitive). The number of lines must match the variations file.

---

## Supported domains

The extension works on all major eBay regional domains:
`.com`, `.co.uk`, `.com.au`, `.de`, `.fr`, `.it`, `.es`, `.ca`
