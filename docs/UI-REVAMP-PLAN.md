# UI revamp: staged delivery

Status: initial staged revamp implemented and locally verified, 2026-09-22. See [agent packets](UI-REVAMP-TASKS.md), [review evidence](UI-REVAMP-REVIEW.md) and [continuation checkpoint](UI-REVAMP-CONTINUATION.md).

## Outcome and design authority

Refresh the existing React application using the supplied UI references, with each stage leaving a usable application. Keep existing membership, permissions, drafts, submissions, and navigation behavior.

Reference root: `UI/stitch_open_labs_platform_design/stitch_open_labs_platform_design/`.

| Reference | Use |
| --- | --- |
| `open_labs_member_dashboard_redesigned_from_current_app/code.html` | Primary source for shell, dashboard composition, panel shapes and colors. Translate into existing React/CSS. |
| Same directory, `screen.png` | Header/sidebar appearance only: supplied capture is largely blank below them. Do not reproduce the missing content. |
| `decoded_brain_technical_studio/DESIGN.md` | Typography, blue/coral/cyan accents, restrained scientific identity. |
| `open_labs_standalone_neural_arbor_loader_1280x1024/code.html` and `screen.png` | Neural arbor SVG and actual loading-state presentation. |
| `image.png/screen.png` | Supplemental neuron illustration reference; no new image generation needed. |
| `my_taste.md` | Clear actions, readable copy, intuitive navigation and simplicity. |

Resolve reference conflicts explicitly: the concrete dashboard's moderately rounded panels take precedence over DESIGN.md's universal sharp-corner rule. Use its midnight background (#090D16), surface (#0F131E), card (#161B28), border (#242C3F), blue (#1259F3), and restrained coral/cyan accents. Keep readable text contrast instead of copying faint metadata. Use Space Grotesk headings, Inter/system body and JetBrains Mono/system metadata, with reliable fallbacks. Preserve the existing theme preference and usable light mode; dark is the visual reference, not permission to discard a saved preference.

## Delivery sequence

| Stage | Deliverable | Depends on | Release gate |
| --- | --- | --- | --- |
| P0 | Baseline and source mapping | None | Existing build/test failures recorded; reference decisions settled. |
| P1 | Tokens and responsive application shell | P0 | Header, sidebar, Settings, role visibility and mobile keyboard navigation work. |
| P2 | Member dashboard | P1 | Real obligations, reviews, decisions, threads and initiatives use reference hierarchy. |
| P3 | Secondary screens | P2 | Catalog/detail, documents/forms, then administration/settings remain usable; each subgroup is a separate packet. |
| P4 | Neural arbor loader | P1; schedule after P3 to avoid shared-file conflicts | Real pending state, no artificial delay, reduced motion, error/retry preserved. |
| P5 | Integration review and handoff | P2–P4 | Focused regression suite and responsive visual evidence; unresolved gaps listed. |

Implement one packet at a time. Each packet has a small diff and its own validation and checkpoint. Finishing P1 or P2 is a valid session boundary; never require an unfinished redesign to be deployed. No automatic commit, push or deployment is part of this plan.

## Acceptance contract

- Preserve hash URLs, role guards, account approval, preview restrictions, draft/autosave state, lead/reviewer submission rules, deadlines, HP and historical read-only content. RM remains Roast Me.
- Populate all counts, names, dates, roles and links from current data. Omit fake lab-node status, scientific measurements and percentages from the mockup.
- At 390, 768 and 1440 CSS pixels: readable content, reachable actions, no page-wide horizontal overflow; intentionally wide tables may scroll within their own container. Also inspect dashboard at the supplied 1600-pixel reference width.
- Keyboard focus is visible; mobile navigation and dialogs retain Escape/focus return behavior. Inputs have labels; statuses do not depend on color alone; normal text reaches 4.5:1 contrast and large text/control boundaries 3:1 where applicable.
- Preserve empty, pending, suspended, signed-out, error and busy states. Decoration is aria-hidden and cannot intercept pointers. Reduced motion disables nonessential animation.
- Use current CSS, React and Lucide. No Tailwind runtime/CDN, new component framework, state manager, router, backend schema, generic dashboard engine or wholesale App.tsx extraction. Extract only a small component when it has a concrete reuse or isolates the loader.
- No static prototype HTML injection or remote mockup avatar/logo URLs. Reuse available assets or a simple existing icon. No new font dependency is necessary for an initial stage.
- Record a brief evidence-based my_taste review at P2 and P5; target at least 75/100, fixing usability problems first. This is a proposed project gate, not a score already observed.

## Agent and credit policy

Use AGY `gemini-3.8-flash-high` with `--effort high` for implementation packets and routine review. Local `agy models` confirmed this identifier on 2026-09-22. CLI effort supports low/medium/high; extra-high was not listed. Never silently substitute another provider or more expensive model.

One writer at a time: most packets touch App.tsx/style.css. Give each agent only this plan, its packet, relevant source sections and UI references. Do not load old transcript/event files, secrets, private imports or unrelated backend code. No duplicate reviews, broad repeated test runs, dependency upgrades or speculative cleanup. After two unsuccessful attempts at the same issue, checkpoint the failure rather than spend on an open-ended retry loop.

Before starting and after completing each packet, inspect the provider's actual five-hour allowance if available. Stop starting work at **5% remaining or less (95% consumed)**; at 10% remaining, finish only the current bounded packet and prepare the checkpoint. Respect an earlier user stop. Do not purchase credits, switch accounts or redeem resets. Usage percentage and reset time must come from the provider, never token-count guesses. If usage cannot be observed, save the checkpoint and request the current remaining allowance before starting implementation. A missing meter is not evidence of zero usage or unlimited usage.
