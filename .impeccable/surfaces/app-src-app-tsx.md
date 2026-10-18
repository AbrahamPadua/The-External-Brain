---
version: 1
slug: "app-src-app-tsx"
primary_target: "app/src/App.tsx"
related_targets: ["app/src/NeuralBackground.tsx","app/src/studio.css","app/src/style.css"]
---

## Scope

App shell (rail navigation and top area), signed-in Home, and the RM submit reward moment. Visitor mode: Operate.

## Audience and job

Members on laptops late at night and on phones between classes. They need to see this week's cycle and what is due at a glance, submit the RM, and track HP. Research and Operations also see their approval queues here.

## Constraints

- Dark theme is the Living Type world. Light theme is provisional until designed: ink type on the Lobe Map ground `#F5F1E4`, same structure and type.
- Works at 390px. The reward moment has a reduced-motion version: no spike ramp, the finished brain and RM CLEAR! shown still.
- The workspace loader keeps its design and only gains small arcade touches.
- Real data only: HP belongs to the initiative, so Home shows the initiative's HP and the reward shows its real change. No streaks, no invented points.
- Recursive and Nabla are bundled with the app, not loaded from a third party.
- Product terms as in PRODUCT.md (initiative, RM, HP, review cycle, Research, Operations).

## Chosen direction and memorable moment

Living Type (see the contract). The memorable moment is the spike reveal: on a successful RM submit the UI fades to the dot grid, neurons spike faster and faster, the grid lights a brain colored by lobe, RM CLEAR! lands with the initiative's real HP change, then the UI returns.

## Unresolved

- What the score shows: the owner answered "000"; meaning to be confirmed.
- Fractal header fold: liked, deferred.
- Light theme design.

## Direction contract

THESIS: Home as a type specimen that reads the lab's data: HP sets the weight of the HP numeral, time left loosens or tightens deadline type, overdue work leans. It refuses the category default of grey cards, small type and one blue accent.

OWN-WORLD: Ink ground `#121114`, paper type `#F2EFE6`, one vermilion `#FF4A1C` for the primary action and live signals. Recursive with data-bound weight, casual and slant axes, its mono setting for metadata, huge display scale against small labels. Hairline rules instead of card chrome; bordered plates are the only containers. Lobe colors and the Nabla face appear only in the reward moment. Ground: a symmetric, centered dot grid with an occasional link between neighbors and slight pointer parallax.

STORY: A member opens Home, reads the week and what is due in seconds, submits the RM from the document view, and earns the spike reveal with their initiative's real HP change.

FIRST VIEWPORT: Left rail with Home as a paper pill. Main: the week heading at display size top left with a mono cycle-close line; the initiative's HP numeral at giant size top right. Below, two columns: Weekly updates and Reviews as hairline rows (title, mono meta, right-aligned time left in data-bound type, vermilion action) on the left; Needs your attention and Your initiatives plates on the right.

FORM: Variable-font specimen, dealt challenger 1 of the bolder re-roll (round 1). seed: fa485f3b875e2dd8

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
