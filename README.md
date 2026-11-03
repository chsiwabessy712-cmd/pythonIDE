# Python IDE (standalone)

A standalone copy of the Python IDE from the Training Manager site
(`training-manager/src/components/common/PythonAssessment.js` and the files it uses, the IDE
that Advance levels open), running on Vite with no Firebase.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5181

- `?role=admin` opens it as staff: every question unlocked and the staff tools shown.
- `?questionIndex=1` opens the second question directly.
- Saves, submissions and passed questions are kept in the browser's localStorage. To start over,
  clear the site data for localhost:5181.

## What was copied, and what was swapped

Copied unchanged from `training-manager`:

- `src/components/common/` — `PythonAssessment.js`, `TurtleCanvas.js`, `Button.js`, `ErrorBoundary.js`,
  `ImageViewer.js`, `sanitizeHtml.js`, `feedbackSound.js`
- `public/pythonWorker.js` — runs the code with Pyodide, including `input()` and turtle
- `public/assets/sounds/` — the pass/fail sounds
- `src/index.css`, `tailwind.config.js`, `postcss.config.js`

Swapped:

- `src/firebase/firestore.js` — a localStorage stand-in for the Firestore calls the IDE makes.
  `vite.config.mjs` aliases `firebase/firestore` to it, so `PythonAssessment.js` needs no edits.
- `src/context/AppStateContext.js` — a fixed demo user instead of the site's login.

Pyodide (from jsDelivr) and the Monaco editor still load from a CDN at runtime, as on the site,
so the page needs internet access.

## Questions

Defined in `src/data/demoLevel.js`, copied from the site's Firestore (Advance 1) and seeded at the
same paths `PythonAssessment` reads (`codingLevels/{level}/units_new/{unit}/challenges/{challenge}/steps`):

1. **Print Quotes** — print a sentence with quotes and an apostrophe; checked against the expected output.
2. **If-Else** — read a feeling with `input()` and answer "You are happy!" for any casing of "happy";
   checked with 4 input test cases and code requirements (`input`, `.lower()`, `if`/`else`, …).

Question 2 unlocks once Question 1 is submitted (as a teacher).
