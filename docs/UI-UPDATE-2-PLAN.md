# Updated platform visuals — staged plan

2026-09-22. Scope: the new background, logo, Connecting Ideas loader and catalog references under `UI/stitch_open_labs_platform_design_updated/`. This supersedes earlier visual choices only for those four areas. Existing working-tree changes remain separate. No deployment is part of this request.

## High-level stages

1. U0: inspect references and choose one implementation per feature; record baseline and allowance.
2. U1: apply the supplied logo and a subtle CSS/SVG neural background, including light mode and reduced motion.
3. U2: replace the old standalone SVG loader with the updated animated Connecting Ideas renderer in both themes, retaining the actual loading/error/retry lifecycle.
4. U3: update the catalog header, search/filter controls and image/illustration cards with accessible detail reveals and real-data counts.
5. U4: integrate, run focused checks, inspect responsive screenshots, and save a continuation record.

Each stage is a usable stopping point. Agent drafts are reviewed before applying. One writer at a time; independent draft generation may overlap while root verifies the preceding stage.

## Reference decisions

- Logo: `decoded_brain_logo_mark_no_text/code.html` is already standalone SVG; reuse it directly for header, loader and favicon rather than redraw a bitmap.
- Platform background: `open_labs_member_dashboard_ultra_subtle_neural_motion/code.html` supplies neural paths and CSS motion. Light treatment follows `open_labs_member_dashboard_light_mode`. Choose CSS/SVG, which the user explicitly permits, rather than maintaining a second WebGL renderer. No graphics library, settings toggle or shader fallback framework.
- Loader: dark/light `open_labs_connecting_ideas_*_mode_loader/code.html` supplies the real canvas animation; screenshots omit most canvas content and must not be treated as a request for a blank loader. Adapt paths and timing, adding cleanup and defensive context handling.
- Catalog: `open_labs_research_catalog_interactive_hover_reveals` takes precedence for interaction; `open_labs_redesigned_research_catalog` supports composition. Use current records, images and categories, with local illustrative fallbacks. Omit mock flux/sync, API keys and export controls that do not exist in the app.
- Concrete blue/cyan/coral screenshots override the unrelated lime palette in the broader DESIGN.md. Light mode remains light throughout navigation and loader. No font downloads required.

## Acceptance and cost controls

- Preserve hashes, role guards, catalog public visibility, real counts, image crop positions and current editing/submission behavior. No backend or schema changes.
- Background must be decorative, pointer-transparent and behind readable content; animate only lightweight SVG/CSS properties and pause in hidden tabs. Reduced motion is static. Loader loops/listeners must be cancelled on unmount and paused when hidden; cap pixel density and frame rate.
- Catalog card links work with mouse, touch and keyboard. Titles/status remain visible. Hover details also appear on focus and remain visible on touch devices. Search, category, active-only and any sort controls must actually work; no fabricated metrics.
- Inspect 390/768/1440px and both themes, empty search results, keyboard navigation and actual loader success/error/retry. Build and focused tests, not repeated unrelated backend suites.
- Use AGY `gemini-3.8-flash-high`, high effort, for most packets. Existing helper sends bounded source context with no agent tool permissions. No model upgrade unless repeated concrete failures justify it.
- Check actual five-hour allowance after each stage using `node app/scripts/read-ui-budget.mjs`. At <=10% remaining prepare the checkpoint; at <=5% stop starting work. No credit purchases, account switching or reset redemption. Record exact unfinished functions/checks and next action. Do not invent an automatic restart schedule.

See [implementation packets](UI-UPDATE-2-TASKS.md) and [continuation state](UI-UPDATE-2-CONTINUATION.md).
