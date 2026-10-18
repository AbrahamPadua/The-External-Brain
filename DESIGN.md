---
name: The External Brain
description: Living Type, a working screen set like a type specimen that reads the lab's data.
---

<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: The External Brain

## Overview

**Creative North Star: "Living Type"**

The workspace is set like a type specimen: big confident letterforms on an ink ground, small mono labels, hairline rules and almost no chrome. Type does more than label the data, it reads it. The HP numeral gets heavier as HP rises, deadline figures tighten as time runs out, and overdue work leans. Everything else stays quiet so members can scan the week in seconds, on a laptop late at night or a phone between classes.

Behind the interface sits a symmetric dot grid, the lab's network of neurons. In daily use it barely moves: now and then two neighbouring dots link and let go, and the grid shifts a few pixels with the pointer. Colour is held back on purpose. Working screens use ink, paper and one vermilion. The full lobe palette is saved for the one moment that earns it: submitting an RM.

**Signature: the spike reveal.** After the server confirms a member's first submission of an RM, the interface fades away and only the dot grid remains. Neurons spike faster and faster, spikes gather inside a brain silhouette, and the grid lights up a brain coloured by lobe. RM CLEAR! lands with the initiative's real HP change, then the interface returns. The working reference is `.impeccable/mocks/spike-reveal.html` (prototype code, not production code).

- Sequence: interface fade 320ms; spiking for 2400ms at 4 spikes per second times e^(t / 480ms), reaching roughly 600 per second; about 35% of spikes jump to a grid neighbour of a recent spike so activity travels; the chance a spike lands inside the brain rises from 25% to 100%.
- Brain dots that spike stay lit (fading in over 240ms). At the end of the ramp every remaining brain dot fires within 180ms, completing the image.
- RM CLEAR! slams in 300ms after that burst (560ms, `cubic-bezier(.34, 1.56, .64, 1)`), with the HP change beneath it. It holds about 2.1s, then the brain fades over 600ms and the interface returns.
- The brain is a lateral view facing left. The central sulcus, lateral fissure, parieto-occipital line and the boundary above the cerebellum stay unlit so it reads as a brain, not a blob.
- Reduced motion: no spike ramp. The finished brain and RM CLEAR! fade in still, then the interface returns.
- Revisions and reviews do not trigger it; they keep the normal confirmation.

**Key Characteristics:**
- Ink ground, paper type, one vermilion.
- Huge display type against small mono labels; hierarchy by scale.
- Data-bound type: HP sets weight, time left sets the casual axis, overdue sets slant.
- Hairline rules and bordered plates instead of cards and shadows.
- A symmetric dot grid that is the stage for the spike reveal.

**Not yet decided:** what the score shows (the owner answered "000"; meaning to be confirmed), the real light theme, the deferred fractal header fold, and the arcade touches for the workspace loader. Streaks are not used.

## Colors

Restrained: tinted neutrals plus one vermilion on working screens; the lobe palette appears only in the spike reveal.

### Primary
- **Signal Vermilion** (#FF4A1C): the primary action button (ink text on it), the occasional link between grid dots, and the ring around each spike. Nothing else on a working screen is saturated.

### Neutral (dark theme, the Living Type world)
- **Specimen Ink** (#121114): page ground and rail.
- **Paper** (#F2EFE6): primary text, the active navigation pill, plate borders.
- **Faded Paper** (#A9A49A): metadata, labels, secondary text.
- **Hairline** (#2A282E): row and section rules, the rail edge.
- **Grid Dot** (#3A3740): resting dots of the background grid; brightened to #5E5966 while the spike reveal plays.

### State
- **Late** (#FF6B6B): overdue figures, set in the slanted style.
- **Submitted** (#8BD17C): the submitted stamp on a locked RM.

### Reward palette (spike reveal only)
- Frontal **#8ED462**, parietal **#F5E211**, temporal **#2BA0FF**, occipital **#FF705D**, cerebellum **#EBC1FF**, brainstem **#F2EFE6**.

### Light theme (provisional)
Same structure and type on the Lobe Map ground: ground **#F5F1E4**, text **#2C2E2A**, secondary text **#4A4D46**, grid dot **#C9C2AE** (moment **#9D967F**), vermilion unchanged. Reward lobes darken for contrast on the light ground: **#4FA82B**, **#C99700**, **#2B8FE6**, **#E8553F**, **#A86AE0**, brainstem **#2C2E2A**. To be designed properly later.

### Named Rules
**The One Vermilion Rule.** Vermilion is the only saturated colour on a working screen. If two things on a screen are vermilion, one of them is wrong.

**The Plate Quarantine Rule.** The lobe colours and any other saturated colour live only in the spike reveal. They never decorate navigation, rows or headings.

## Typography

**Display and Body Font:** Recursive (variable: weight 300 to 1000, casual 0 to 1, slant -15 to 0, mono 0 to 1), bundled with the app.
**Reward Font:** Nabla (colour font), for RM CLEAR! only, bundled with the app.

**Character:** One workhorse family that changes voice through its axes: linear and crisp for reading, mono for data, heavy and tight for display. Nabla's multicolour 3D letters appear once, as the prize.

### Hierarchy
- **Display** (900, clamp(48px, 7vw, 92px), line-height 0.92, letter-spacing -0.035em): the week heading on Home.
- **HP numeral** (weight = HP x 10, clamped 300 to 1000; clamp(72px, 9vw, 124px); line-height 0.85; letter-spacing -0.04em): the initiative's HP, top right on Home. The weight eases over 900ms when HP changes.
- **Deadline figure** (800, 28px, tabular): time left on a row. Casual axis about 0.6 with plenty of time, 0 near the deadline; overdue switches to slant -15 in Late.
- **Title** (700, 19 to 20px): row and plate titles.
- **Section heading** (700, 15px): above a hairline, with a mono count on the right.
- **Body** (400, 16px, line-height 1.5, casual 0).
- **Label** (mono 1, 13px, uppercase, letter-spacing 0.03em, Faded Paper): metadata such as "RM · DRAFT SAVED 2H AGO".
- **Reward** (Nabla, clamp(48px, 9vw, 96px)): RM CLEAR! in the spike reveal only.

### Named Rules
**The Data Is the Type Rule.** A number that matters sets its own type. HP drives weight, time left drives the casual axis, overdue drives slant. Never fake it with colour or an icon.

## Layout

A left rail (232px) and a main column padded 40px by 48px. Home leads with the week heading at top left and the HP numeral at top right, then two columns (1.4fr and 1fr, gap 36 to 40px): Weekly updates and Reviews as hairline rows on the left, Needs your attention and Your initiatives as plates on the right. A row is a three-part grid: title and label, the right-aligned deadline figure, the action. All of the week's work should fit above the fold on a laptop.

At 860px and below the rail collapses to a top bar, Home becomes one column, and a row's action spans the full width.

The background grid is evenly spaced and centred so its margins match: spacing is the viewport width divided by 60, rounded and clamped to 16 to 24px; dots are 1.4px in radius. An idle link between two neighbouring dots appears every 2.2 to 3.8 seconds (grows over 450ms, holds, fades over 1.2s). Pointer parallax moves the grid at most 7px, eased. The grid canvas is oversized by 24px on each side so parallax never shows an edge.

## Elevation & Depth

Flat. Working surfaces have no shadows. Separation comes from 1px hairlines and 1px Paper borders around plates. The only layering is the interface sitting over the dot grid, and the spike reveal is the only time that order changes.

### Named Rules
**The Flat Specimen Rule.** If a surface needs a shadow to be noticed, it needs a hairline or more space instead.

## Shapes

Mostly rectangular. Buttons have a small radius (8 to 10px); the active navigation item is a Paper pill with a 10px radius; plates are square-cornered with a 1px Paper border. Dots and spikes are the only circles.

## Do's and Don'ts

### Do:
- **Do** set the HP numeral in Recursive with weight equal to HP x 10, clamped 300 to 1000.
- **Do** keep metadata in Recursive mono, 13px, uppercase, Faded Paper (#A9A49A).
- **Do** separate rows with 1px Hairline (#2A282E) rules and use 1px Paper-bordered plates as the only containers.
- **Do** play the spike reveal only after the server confirms a first RM submission, and show the initiative's real HP change (or no number if it did not change).
- **Do** give reduced-motion users the still version of the spike reveal.
- **Do** bundle Recursive and Nabla with the app instead of loading them from a third party.

### Don't:
- **Don't** use grey card chrome, drop shadows, glows, gradient text or a blue accent on working screens.
- **Don't** use the lobe colours or Nabla anywhere outside the spike reveal.
- **Don't** show streaks or invented points.
- **Don't** animate the dot grid in daily use beyond the occasional link and the pointer parallax.
- **Don't** add a second accent colour; vermilion is the only one.
