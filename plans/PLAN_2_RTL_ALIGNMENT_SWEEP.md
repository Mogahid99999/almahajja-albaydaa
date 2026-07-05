# PLAN 2 — RTL Left-Alignment Sweep

Source: owner directly observed this live during testing ("some texts and
titles are aligned to the left side"), then confirmed independently by two
separate test agents (on-device student journey + two-device رفيق test) on
different accounts, same result both times.

## Confirmed scope (do not over-fix beyond this — every other screen tested
## RTL-clean)

The violation is **isolated to section and subsection pages**
(`app/(student)/section/[id].tsx` or equivalent — confirm exact path), not
app-wide. Specifically, on both a top-level section (العقيدة) and a nested
subsection (كتاب التوحيد), these elements render flush-LEFT when they should
hug the right edge like everything else on the same screen:

1. **Hero title + subtitle** — e.g. "العقيدة" / "كتاب التوحيد" title and its
   subtitle ("باب التوحيد وأقسامه") are flush-left; the section's icon badge
   correctly sits on the right, so the text block is misaligned relative to
   its own icon.
2. **Progress-card value + footer** — the "٠%" value and the footer line
   "أكملت ٠ من ٣ محاضرة" (or however many are complete) are flush-left inside
   their card, while the card's own header "تقدّمك في القسم" is correctly
   flush-right.
3. **Quiz-card meta line** — "٣ أسئلة · النجاح: ٢ من ٥ ..." (and its wrapped
   second line) starts from the left instead of the right.

**Confirmed correct on the same screens** (do not touch / regress these):
lecture list cards, "محاضرات القسم" section heading, "الأقسام الفرعية"
heading, and literally every other screen in the app (Home, player, journey,
profile, questions, notifications, about, downloads, auth, buddy-search) —
all tested RTL-clean.

## Root cause direction

The app forces RTL globally via `I18nManager.forceRTL(true)` +
`I18nManager.swapLeftAndRightInRTL(false)` (`app/_layout.tsx:102-104`), which
keeps left/right styles **physical** (a literal `textAlign: 'left'` or
`left: 0` really means the left edge, not "start"). The project convention
(per `CLAUDE.md` and confirmed by the codebase's own static-audit results) is
that everything should use physical-right styling to appear correctly in
RTL. The three broken elements above are the only spots where a component
(likely shared across section + subsection since the bug is identical on
both) has either an explicit `textAlign: 'left'` / `alignItems: 'flex-start'`
/ `left: 0`-style positioning, or relies on a default that resolves to
left-anchored inside this app's forced-RTL setup.

## Fix steps

1. Find the shared components rendering the section/subsection hero block
   and the progress card — likely under `app/(student)/section/` or a
   `src/components/` equivalent (e.g. `SectionHero`, `ProgressCard`,
   `QuizCard` or similarly named). Since the bug is identical on a
   top-level section AND a nested subsection, this is almost certainly ONE
   shared component instance, not two separate bugs — fix it once.
2. Grep those specific files for `textAlign: 'left'`, `alignItems:
   'flex-start'`, `justifyContent: 'flex-start'`, explicit `left:` positioning,
   or any style that isn't using the project's established physical-right
   pattern (compare against a known-good component on the same screen, e.g.
   whatever renders "تقدّمك في القسم" or the lecture list cards correctly, to
   see the pattern actually used there).
3. Also do a targeted re-check of the two `row-reverse` usages the static
   scanner found in `app/(auth)/sign-in.tsx:134` and `:191` — while sign-in
   is a different screen than the confirmed bug, `row-reverse` on a
   `flexDirection` on top of forced-RTL cancels the automatic mirroring and
   is exactly the kind of bug that produces this symptom. Replace both with
   plain `flexDirection: 'row'` and visually verify the WhatsApp
   support-link row and the password show/hide-eye row land on the correct
   side afterward.
4. **Verify on-device, not just visually in code review**: rebuild, install
   on an emulator, navigate to a section AND a subsection, and confirm all
   three elements now hug the right edge, matching the correctly-aligned
   elements on the same screen. Take a screenshot for the record.
5. Do a final quick pass over the rest of the app's screens (Home, player,
   journey, profile, admin) to confirm nothing regressed — the fix should be
   scoped to the shared section-hero/progress-card/quiz-card component(s)
   only.

## Related, lower-priority cosmetic finding to fold in here

- **Wrong-password sign-in error is unlocalized English** ("Invalid login
  credentials"), and renders left-aligned on the Arabic-first sign-in form
  (confirmed on both native and web). Translate to Arabic and right-align to
  match the rest of the form. File: wherever `signIn()`'s error is surfaced
  in `app/(auth)/sign-in.tsx` — likely a raw Supabase error message passed
  straight to the UI; map known Supabase auth error codes to Arabic strings
  instead of showing `error.message` directly.
