# Authoring a simply-html app

This is the contract for an AI agent (or a human) writing a **reactive app** for simply-html.
The rule that makes everything else safe: **you write HTML + read-only formulas + a closed set of
`data-sh-*` directives. You never write JavaScript, and you never write CSS.** The audited runtime
supplies all behavior; the host supplies all design. Stay inside this grammar and a page you author
is safe to host behind a shared link.

> If you only remember one thing: **no `<script>`, no `on*` handlers, no `<style>`, no `style=`.**
> Express *behavior* with directives + formulas, *structure* with HTML, and *look* with the
> semantic class names below — never with your own CSS.

## 1. An app is a `[data-sh-app]` region

Wrap the app in an element with `data-sh-app` and declare initial state as JSON in
`data-sh-state` (pure data — it is parsed, never evaluated):

```html
<div data-sh-app data-sh-state='{"draft":"","todos":[{"text":"Ship it","done":false}]}'>
  ...directives...
</div>
```

The runtime mounts every `[data-sh-app]` region on the page. State is a plain JSON object; the
live root is also reachable in any formula/action as `$`.

## 2. Directives (the closed set)

| Directive | Value | What it does |
|---|---|---|
| `data-sh-text` | formula | sets the element's text, reactively |
| `data-sh-show` | formula | shows/hides the element (display:none when falsy) |
| `data-sh-class` | `<class> <formula>` | toggles `<class>` while the formula is truthy (class must be an allowlisted name) |
| `data-sh-attr-<name>` | formula | sets attribute `<name>` reactively (safe targets only — see §6) |
| `data-sh-repeat` | formula → array | renders the element's inner template once per item |
| `data-sh-as` | name | names the per-item binding for `data-sh-repeat` (default `item`) |
| `data-sh-index` | name | (optional, on `data-sh-repeat`) binds the 0-based loop index — handy for positioning SVG |
| `data-sh-on` | `<event>: <action>; <action>` | runs closed action(s) on a DOM event, then re-renders |
| `data-sh-bind` | field path | two-way binds an `<input>`/`<textarea>` to a state field |
| `data-sh-def` | name | defines a reusable component (its inner HTML is the template) |
| `data-sh-use` | name | expands a named component here |
| `data-sh-arg-<param>` | formula | passes `<param>` into a `data-sh-use` |
| `data-sh-chart` | `bar` / `line` / `sparkline` | draws a reactive SVG chart (the runtime draws it; no chart library, no model JS) |
| `data-sh-values` | formula → number array | the chart's data series |
| `data-sh-labels` | formula → array | optional per-point labels (shown as hover tooltips) |
| `data-sh-max` | formula → number | optional fixed y-scale max (default: the largest value) |

### Examples

```html
<!-- derived text -->
<p data-sh-text="count(todos where done) + ' of ' + count(todos) + ' done'"></p>

<!-- conditional -->
<p data-sh-show="count(todos where not done) == 0">All done 🎉</p>

<!-- list -->
<ul data-sh-repeat="todos" data-sh-as="t">
  <li>
    <button data-sh-on="click: toggle(t, 'done')" data-sh-text="t.text"></button>
    <button data-sh-on="click: remove(todos, t)">remove</button>
  </li>
</ul>

<!-- input + add (clears the draft via $) -->
<input data-sh-bind="draft" placeholder="New todo…">
<button data-sh-on="click: add(todos, {text: draft, done: false}); set($, 'draft', '')">Add</button>
```

## 3. Formulas (read-only)

Formula values are a tiny expression language. They can only **read** — there is no assignment,
loop, or function definition, so a formula can never change state or run code.

- **Literals:** `42`, `3.14`, `'text'`, `"text"`, `true`, `false`, `null`, `[1, 2, 3]`,
  `{name: 'a', done: false}` (object keys are literal names).
- **Fields:** `draft`, `todos`, `$` (the state root). Member access `todo.text`; over an array,
  member access vectorizes: `todos.text` → an array of every `text`.
- **Operators:** `+ - * / %`, `== != < <= > >=`, `and or not`.
- **Filter:** `todos where done`, `todos where not done`, `items where amount > 10`.
- **Functions:** `count`, `sum`, `avg`, `min`, `max`, `len`, `abs`, `round`, `floor`, `ceil`,
  `if(cond, a, b)`, `lower`, `upper`, `contains`, `not`.

```
count(todos where done)
sum((items where paid).amount)
if(count(todos) == 0, 'Nothing yet', count(todos) + ' items')
```

You cannot index with `[]`, call anything outside the function list, reach `__proto__` /
`constructor` / `toString` / any built-in member, or touch a JS global — by construction.

## 4. Actions (the only way state changes)

State only changes through this closed registry, used in `data-sh-on`:

| Action | Effect |
|---|---|
| `toggle(obj, 'field')` | flips a boolean field |
| `set(obj, 'field', value)` | assigns a field |
| `inc(obj, 'field', n)` | adds `n` (default 1) to a numeric field |
| `add(collection, value)` | appends `value` (often an object literal) to an array |
| `remove(collection, item)` | drops `item` from an array |

- `obj`/`collection` are formulas that resolve to the live object/array (an item from a
  `data-sh-repeat`, a top-level field, or `$` for the root).
- Chain actions with `;`: `data-sh-on="click: add(todos, {text: draft, done: false}); set($, 'draft', '')"`.
- Filter key events with `.<key>`: `data-sh-on="keydown.enter: add(todos, {text: draft, done: false})"`
  fires only on Enter (handy on an `<input>` so the user can submit without a button).
- To write a **top-level** field, use `$`: `set($, 'count', count + 1)`.
- Field names that are built-in members (`toString`, `__proto__`, …) are rejected.

## 5. Components (`data-sh-def` / `data-sh-use`)

Define a fragment once, reuse it with arguments:

```html
<div data-sh-def="todo-row">
  <button data-sh-on="click: toggle(t, 'done')" data-sh-text="t.text"></button>
  <button data-sh-on="click: remove(todos, t)">remove</button>
</div>

<ul data-sh-repeat="todos" data-sh-as="t">
  <li data-sh-use="todo-row" data-sh-arg-t="t"></li>
</ul>
```

A `data-sh-def` is harvested at mount and not rendered directly. `data-sh-arg-<param>` passes a
formula in as `<param>`; args are re-evaluated reactively. Define components at the top level of
the app region. Component nesting is depth-capped, so a component cannot reference itself forever.

## 5b. Charts (no chart library, no model JS)

Bind a numeric series and the runtime draws a small reactive SVG — it redraws when the data changes:

```html
<div data-sh-chart="bar"
     data-sh-values="categories.amount"
     data-sh-labels="categories.name"></div>

<div data-sh-chart="sparkline" data-sh-values="[3, 1, 4, 1, 5, 9]"></div>
```

`bar`, `line`, and `sparkline` are the kinds. `data-sh-values` is a formula resolving to numbers
(e.g. a vectorized field `categories.amount`, or a literal `[1, 2, 3]`); `data-sh-labels` (optional)
become hover tooltips; `data-sh-max` (optional) fixes the scale. The bars/line use `currentColor`, so
the host's CSS `color` themes the chart. You declare it; the runtime draws the SVG — you write no JS.

## 5c. Drawing in SVG (custom, interactive graphics — still no JS)

`data-sh-chart` is a shortcut; for anything custom you can **draw in SVG yourself** and wire it with
the same directives. The model may emit a safe SVG drawing subset — `svg`, `g`, `path`, `rect`,
`circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, gradients, `clipPath` — and the
sanitizer strips every script vector (`<script>`, `<foreignObject>`, `<use>`, `<image>`, the
`<animate>`/`<set>` family, `on*`, `javascript:` hrefs), so "no model JS" still holds for graphics.

Make it reactive/interactive by putting `data-sh-*` on the SVG shapes. Geometry/paint attributes
(`x`, `y`, `cx`, `cy`, `r`, `width`, `height`, `d`, `points`, `transform`, `fill`, `stroke`, …) can
be reactively bound with `data-sh-attr-*`; shapes can carry `data-sh-on` actions; `<text>` takes
`data-sh-text`. In a `data-sh-repeat`, add `data-sh-index="i"` to get the 0-based index for
positioning:

```html
<svg viewBox="0 0 100 50">
  <g data-sh-repeat="bars" data-sh-as="b" data-sh-index="i">
    <rect width="20"
          data-sh-attr-x="i * 25"
          data-sh-attr-height="b.value"
          data-sh-attr-y="40 - b.value"
          data-sh-attr-fill="if(b.label == selected, '#2563eb', '#bfdbfe')"
          data-sh-on="click: set($, 'selected', b.label)"></rect>
    <text y="48" data-sh-attr-x="i * 25 + 10" data-sh-text="b.label"></text>
  </g>
</svg>
```

That's a clickable, reactive bar chart — hand-drawn, no charting library, no JavaScript. See
[`examples/svg-chart.html`](examples/svg-chart.html). (`href`/`xlink:href` are deliberately not
bindable, and `<style>` inside SVG is dropped — express colour with `fill`/`stroke` + `currentColor`.)
Paint can reference a **local** gradient/clip (`fill="url(#myGradient)"`), but an **external**
`url(https://…)` in `fill`/`stroke`/`clip-path` is stripped: an off-page paint-server reference is a
request that leaks, so it never survives — statically or through a reactive `data-sh-attr-fill`.

## 6. Rules & limits (what keeps it safe)

- **No JavaScript.** No `<script>`, no `on*` attributes, no `javascript:`/`data:text/html` URLs.
- **No CSS.** No `<style>`, no `style=`. Use the semantic classes in §7 (see the design contract).
- **Forms are inert.** `<input>`, `<button>`, `<textarea>`, `<label>` are allowed; `<form>` and
  `<select>` are not. Buttons/inputs do nothing except through `data-sh-on` / `data-sh-bind`.
- **`data-sh-attr-*` safe targets only:** `href`, `src`, `alt`, `title`, `width`, `height`,
  `colspan`, `rowspan`, `scope`, `start`, `reversed`, `open`, `dir`, `lang`, `loading`, `role`,
  `aria-*`, plus the SVG geometry/paint attrs (§5c). Never `on*`, `style`, `class` (use
  `data-sh-class`), `id`, or `name`. A reactive `href`/`src` is URL-checked, so a dangerous scheme
  (`javascript:`) or a protocol-relative `//host` (a third-party origin) is dropped; a reactive
  SVG paint (`fill`/`stroke`) drops an external `url(…)` (see §5c).
- **Two-way `data-sh-bind`** targets a field path (`draft` or `todo.text`), not an arbitrary
  expression, and refuses built-in member names.
- **Bounded:** formulas are size/work-capped; `add` is collection-capped; components are
  depth-capped. You cannot hang the page.

## 7. Design contract (no model CSS)

You do not style the page — the host's design system does. Express *meaning* with these class
names and let the host render them:

| Class | Meaning |
|---|---|
| `sh-callout` + `info` / `success` / `warn` / `danger` / `note` | a callout box with a tone |
| `success` / `warn` / `danger` / `note` | a semantic tone on inline content |

Only allowlisted class names survive on a hosted page (static `class` and `data-sh-class` alike),
so inventing your own class names will have no effect there. If a layout needs a look that the
semantic classes don't cover, that's a gap to raise with the host's design system — not a reason
to write CSS. (A richer app design vocabulary is the host's responsibility and is evolving.)

## 8. A complete example

See [`examples/habit-tracker.html`](examples/habit-tracker.html): derived counts, a conditional
celebration, a `habit-row` component rendered per item, toggle/remove actions, and add-from-input.
The **`data-sh-app` region** — the part you (or the model) author — has zero JavaScript and zero
CSS. That file is a standalone demo, so it also includes a page *shell* — a `<style>` block (the
host's design) and a `<script>` (the one audited runtime). Those are host-supplied, not model
output; the file is commented to make the split obvious. On a hosted page the host and the
sanitizer supply them, and the model never writes them.
