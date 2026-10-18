---
name: verify-ui
description: Run the demo-mode browser review for The External Brain and inspect the screenshots. Use after any change to screens, styles, layout or navigation, and before calling UI work done.
---

# Verify UI

The repo already has a dependency-free browser check (`app/scripts/check-ui-browser.mjs`). It drives the installed Windows Chrome over the fictional demo: users maya, alex and sam (plus signed-out visitor), dark and light themes, widths 390, 768, 1440 and 1600. It exits non-zero on horizontal overflow, a broken mobile menu, failed images or auth-flow regressions.

1. From `app/`, start Vite in the background: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174`. Skip this if something already answers on port 5174. Wait until it responds.
2. From the repo root, run `node app/scripts/check-ui-browser.mjs`.
3. Read `report.json` in the output folder it prints (`%TEMP%/openlabs-ui-evidence`). Then open the PNGs for every view your change touches with the Read tool and look at them. Check for: overflow or clipped text, contrast in both themes, the mobile menu, spacing and alignment against `DESIGN.md`, and empty, loading and error states.
4. If you added a screen or route, add a row for it to the view list in `check-ui-browser.mjs` (and an assertion for its key behavior) so it is covered from now on.
5. Stop the dev server you started.
6. Report which views you inspected, what you fixed, and anything you could not verify.
