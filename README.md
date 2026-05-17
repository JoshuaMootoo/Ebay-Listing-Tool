# eBay Bulk Variation Adder — Chrome Extension

Automates adding multiple variations to an eBay listing from a plain text file.

## How it works

For each line in the text file the extension:
1. Clicks **Create your own** (`#msku-custom-option-link`)
2. Types the variation into the input box (`#msku-custom-option-input`)
3. Clicks **Add** (`#msku-custom-option-add`)

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The extension icon will appear in your toolbar

## Usage

1. Open the eBay listing page where you want to add variations
2. Navigate to the **Variations** section so the variation UI is visible
3. Click the extension icon to open the popup
4. Click **Select .txt file** and choose your variations file (one variation per line)
5. Adjust the **delay** between additions if needed (default 800 ms)
6. Click **Start Adding Variations** and watch the progress bar

## Text file format

One variation per line, blank lines are ignored:

```
Small
Medium
Large
X-Large
```

A sample file is included at `extension/sample_variations.txt`.
