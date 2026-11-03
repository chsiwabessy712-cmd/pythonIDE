/* ============================================================
 * pythonWorker.js — Pyodide Web Worker for Python Assessment
 * Runs Python code on a separate thread so the UI never freezes.
 * Communicates with the main thread via postMessage.
 * ============================================================ */

let pyodide = null;
let isReady = false;

const PYTHON_NOT_LOADED = 'Python could not be loaded. Check your internet connection and refresh the page.';

// ── Turtle module ────────────────────────────────────────────
// A stand-in for CPython's turtle that draws on the page: every action is
// sent to the main thread as a command ({action: "move", ...}), which
// src/components/common/TurtleCanvas.js animates. It follows CPython's
// turtle API, defaults (speed 3, classic shape, black pen) and maths, on a
// 400 x 400 screen. Each run starts with a "begin" command and an empty
// screen (see _turtle_new_run). Kept free of backslashes and backticks, since
// it is a JS template literal.
const TURTLE_PY = `
import sys
import math
import numbers
import types
import json as _json

# Turtle animations often loop forever (while True: forward/turn), so stop
# them cleanly after this many moves. Reset at the start of every run.
_TURTLE_MOVE_BUDGET = 5000
_turtle_moves = [0]

_SPEEDS = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
_SHAPES = ["arrow", "blank", "circle", "classic", "square", "triangle", "turtle"]


class _TurtleWorld:
    # What one run has put on the screen
    def __init__(self):
        self.reset()

    def reset(self):
        self.next_id = 0
        self.next_stamp = 0
        self.width = 400
        self.height = 400
        self.colormode = 1.0
        self.tracing = 1
        self.bg = "white"
        self.turtles = []
        self.default = None


_world = _TurtleWorld()


def _turtle_send(command):
    import js
    js._turtleEmit(_json.dumps(command, default=str))


def _turtle_new_run():
    _turtle_moves[0] = 0
    _world.reset()
    _turtle_send({"action": "begin"})


def _number(value, what="coordinates"):
    if not isinstance(value, numbers.Real):
        raise TypeError("turtle %s must be numbers, not %s" % (what, type(value).__name__))
    return float(value)


def _color_args(args):
    if len(args) == 1:
        return args[0]
    if len(args) == 3:
        return tuple(args)
    raise TypeError("a color is a name like 'red' or three numbers (r, g, b)")


def _css(color):
    # A turtle color as a CSS color: names and "#rrggbb" as they are,
    # (r, g, b) scaled by the colormode
    if isinstance(color, (tuple, list)) and len(color) == 3:
        scale = 255 / _world.colormode
        r, g, b = (max(0, min(255, round(float(v) * scale))) for v in color)
        return "rgb(%d, %d, %d)" % (r, g, b)
    return str(color).replace(" ", "").lower()


class Vec2D(tuple):
    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, other):
        return Vec2D(self[0] + other[0], self[1] + other[1])

    def __sub__(self, other):
        return Vec2D(self[0] - other[0], self[1] - other[1])

    def __mul__(self, other):
        if isinstance(other, Vec2D):
            return self[0] * other[0] + self[1] * other[1]
        return Vec2D(self[0] * other, self[1] * other)

    def __rmul__(self, other):
        if isinstance(other, numbers.Real):
            return Vec2D(self[0] * other, self[1] * other)
        return NotImplemented

    def __neg__(self):
        return Vec2D(-self[0], -self[1])

    def __abs__(self):
        return math.hypot(self[0], self[1])

    def rotate(self, angle):
        a = math.radians(angle)
        c, s = math.cos(a), math.sin(a)
        return Vec2D(self[0] * c - self[1] * s, self[0] * s + self[1] * c)

    def __repr__(self):
        return "(%.2f,%.2f)" % (self[0], self[1])


def _point(x, y):
    if y is None:
        if isinstance(x, WebTurtle):
            return x.x, x.y
        x, y = x
    return _number(x), _number(y)


class WebTurtle:
    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        _world.next_id += 1
        self._id = _world.next_id
        _world.turtles.append(self)
        self.screen = _screen
        self._shape = shape
        self._defaults(visible)

    def _defaults(self, visible=True):
        self.x = 0.0
        self.y = 0.0
        self._h = 0.0
        self.is_down = True
        self.p_color = "black"
        self.f_color = "black"
        self._pen_css = "black"
        self._fill_css = "black"
        self.p_width = 1
        self.speed_val = 3
        self._visible = visible
        self._stretch = (1.0, 1.0)
        self._filling = False
        self._fill_path = []
        self._send("new", x=self.x, y=self.y, **self._look())

    def _send(self, action, **fields):
        fields["action"] = action
        fields["id"] = self._id
        _turtle_send(fields)

    def _look(self):
        return {"h": self._h, "visible": self._visible, "shape": self._shape,
                "color": self._pen_css, "fill": self._fill_css, "size": self._stretch}

    def _restyle(self):
        self._send("state", **self._look())

    def _anim_speed(self):
        return self.speed_val if _world.tracing else 0

    # Screen methods also work on a turtle, as this module always allowed
    # (pen.bgcolor(...), pen.window_width())
    def __getattr__(self, name):
        if name.startswith("_") or not hasattr(_WebScreen, name):
            raise AttributeError("'Turtle' object has no attribute '%s'" % name)
        return getattr(_screen, name)

    # ── moving ──
    def _move_to(self, x, y):
        _turtle_moves[0] += 1
        if _turtle_moves[0] > _TURTLE_MOVE_BUDGET:
            raise _ProgramStop("turtle move budget reached")
        if self._filling:
            self._fill_path.append((x, y))
        self._send("move", x1=self.x, y1=self.y, x2=x, y2=y, pen=self.is_down,
                   color=self._pen_css, width=self.p_width, speed=self._anim_speed(), h=self._h)
        self.x = x
        self.y = y

    def forward(self, distance):
        d = _number(distance, "distances")
        rad = math.radians(self._h)
        self._move_to(self.x + d * math.cos(rad), self.y + d * math.sin(rad))

    def backward(self, distance):
        self.forward(-_number(distance, "distances"))

    def _rotate(self, angle):
        self._h += angle
        self._send("turn", h=self._h, angle=angle, speed=self._anim_speed())

    def left(self, angle):
        self._rotate(_number(angle, "angles"))

    def right(self, angle):
        self._rotate(-_number(angle, "angles"))

    def goto(self, x, y=None):
        self._move_to(*_point(x, y))

    def setx(self, x):
        self.goto(x, self.y)

    def sety(self, y):
        self.goto(self.x, y)

    def setheading(self, to_angle):
        # The shorter way round, like CPython
        delta = (_number(to_angle, "angles") - self._h) % 360
        if delta >= 180:
            delta -= 360
        self._rotate(delta)

    def home(self):
        self.goto(0, 0)
        self.setheading(0)

    def circle(self, radius, extent=None, steps=None):
        # Straight segments, the same way CPython's turtle draws it; the turns
        # between them aren't animated
        radius = _number(radius, "radii")
        extent = 360 if extent is None else _number(extent, "angles")
        if steps is None:
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * abs(extent) / 360)
        w = extent / steps
        w2 = 0.5 * w
        l = 2.0 * radius * math.sin(math.radians(w2))
        if radius < 0:
            l, w, w2 = -l, -w, -w2
        self._h += w2
        for _ in range(steps):
            rad = math.radians(self._h)
            self._move_to(self.x + l * math.cos(rad), self.y + l * math.sin(rad))
            self._h += w
        self._h -= w2
        self._send("turn", h=self._h, angle=0, speed=0)

    # ── where it is ──
    def xcor(self):
        return self.x

    def ycor(self):
        return self.y

    def position(self):
        return Vec2D(self.x, self.y)

    def heading(self):
        return self._h % 360

    def towards(self, x, y=None):
        px, py = _point(x, y)
        return math.degrees(math.atan2(py - self.y, px - self.x)) % 360

    def distance(self, x, y=None):
        px, py = _point(x, y)
        return math.hypot(px - self.x, py - self.y)

    # ── pen ──
    def penup(self):
        self.is_down = False

    def pendown(self):
        self.is_down = True

    def isdown(self):
        return self.is_down

    def pensize(self, width=None):
        if width is None:
            return self.p_width
        self.p_width = _number(width, "pen sizes")

    def speed(self, speed=None):
        if speed is None:
            return self.speed_val
        if speed in _SPEEDS:
            speed = _SPEEDS[speed]
        elif 0.5 < speed < 10.5:
            speed = int(round(speed))
        else:
            speed = 0
        self.speed_val = speed

    def pencolor(self, *args):
        if not args:
            return self.p_color
        self.p_color = _color_args(args)
        self._pen_css = _css(self.p_color)
        self._restyle()

    def fillcolor(self, *args):
        if not args:
            return self.f_color
        self.f_color = _color_args(args)
        self._fill_css = _css(self.f_color)
        self._restyle()

    def color(self, *args):
        if not args:
            return (self.p_color, self.f_color)
        if len(args) == 1:
            pen = fill = args[0]
        elif len(args) == 2:
            pen, fill = args
        else:
            pen = fill = _color_args(args)
        self.p_color, self.f_color = pen, fill
        self._pen_css, self._fill_css = _css(pen), _css(fill)
        self._restyle()

    # ── filling ──
    def filling(self):
        return self._filling

    def begin_fill(self):
        self._filling = True
        self._fill_path = [(self.x, self.y)]
        self._send("beginfill")

    def end_fill(self):
        # Filled with the fill color it has now, under the lines drawn since
        # begin_fill, as in CPython
        if self._filling:
            self._send("fill", points=self._fill_path, color=self._fill_css)
        self._filling = False
        self._fill_path = []

    # ── marks ──
    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        text = str(arg)
        if isinstance(font, str):
            font = font.split()
        font = tuple(font)
        family, size, style = (font + ("Arial", 8, "normal")[len(font):])[:3]
        self._send("write", x=self.x, y=self.y, text=text, align=str(align),
                   font=[str(family), size, str(style)], color=self._pen_css)
        if move:
            # About as far as CPython moves: the text's width
            self.goto(self.x + len(text) * float(size) * 0.75, self.y)

    def dot(self, size=None, *color):
        if not color and isinstance(size, (str, tuple)):
            color, size = (size,), None
        if size is None:
            size = self.p_width + max(self.p_width, 4)
        self._send("dot", x=self.x, y=self.y, size=_number(size, "dot sizes"),
                   color=_css(_color_args(color)) if color else self._pen_css)

    def stamp(self):
        _world.next_stamp += 1
        self._send("stamp", stamp=_world.next_stamp, x=self.x, y=self.y, **self._look())
        return _world.next_stamp

    def clearstamp(self, stampid):
        self._send("clearstamp", stamp=stampid)

    def clearstamps(self, n=None):
        self._send("clearstamps")

    def clear(self):
        self._send("clear")

    def reset(self):
        self._send("clear")
        self._defaults()

    # ── looks ──
    def shape(self, name=None):
        if name is None:
            return self._shape
        self._shape = str(name)
        self._restyle()

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None and outline is None:
            return (self._stretch[0], self._stretch[1], 1)
        wid = self._stretch[0] if stretch_wid is None else _number(stretch_wid, "sizes")
        length = wid if stretch_len is None else _number(stretch_len, "sizes")
        self._stretch = (wid, length)
        self._restyle()

    def hideturtle(self):
        self._visible = False
        self._restyle()

    def showturtle(self):
        self._visible = True
        self._restyle()

    def isvisible(self):
        return self._visible

    # ── the rest of the API ──
    def getscreen(self):
        return _screen

    def getturtle(self):
        return self

    def clone(self):
        twin = WebTurtle(self._shape, visible=self._visible)
        for name in ("x", "y", "_h", "is_down", "p_color", "f_color", "_pen_css", "_fill_css",
                     "p_width", "speed_val", "_stretch"):
            setattr(twin, name, getattr(self, name))
        twin._send("new", x=twin.x, y=twin.y, **twin._look())
        return twin

    def undo(self):
        pass

    def undobufferentries(self):
        return 0

    def setundobuffer(self, size):
        pass

    def degrees(self, fullcircle=360.0):
        pass

    def radians(self):
        pass

    def onclick(self, fun, btn=1, add=None):
        pass

    def onrelease(self, fun, btn=1, add=None):
        pass

    def ondrag(self, fun, btn=1, add=None):
        pass

    def begin_poly(self):
        pass

    def end_poly(self):
        pass

    def get_poly(self):
        return ()

    def tilt(self, angle):
        pass

    def settiltangle(self, angle):
        pass

    def tiltangle(self, angle=None):
        return 0.0

    fd = forward
    bk = back = backward
    rt = right
    lt = left
    setpos = setposition = goto
    seth = setheading
    pos = position
    width = pensize
    pu = up = penup
    pd = down = pendown
    ht = hideturtle
    st = showturtle
    turtlesize = shapesize
    getpen = getturtle


class _WebScreen:
    def window_width(self):
        return _world.width

    def window_height(self):
        return _world.height

    def setup(self, width=None, height=None, startx=None, starty=None):
        # Sizes up to 1 are a part of the monitor in CPython; the page keeps 400
        w = _world.width if width is None or _number(width, "sizes") <= 1 else int(width)
        h = _world.height if height is None or _number(height, "sizes") <= 1 else int(height)
        _world.width, _world.height = min(w, 4000), min(h, 4000)
        _turtle_send({"action": "setup", "width": _world.width, "height": _world.height})

    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        if canvwidth is None and canvheight is None and bg is None:
            return (_world.width, _world.height)
        if bg is not None:
            self.bgcolor(bg)

    def bgcolor(self, *args):
        if not args:
            return _world.bg
        _world.bg = _color_args(args)
        _turtle_send({"action": "bgcolor", "color": _css(_world.bg)})

    def bgpic(self, picname=None):
        return "nopic" if picname is None else None

    def colormode(self, cmode=None):
        if cmode is None:
            return _world.colormode
        if cmode == 1.0:
            _world.colormode = 1.0
        elif cmode == 255:
            _world.colormode = 255

    def tracer(self, n=None, delay=None):
        # tracer(0) draws without animation, until tracer(1)
        if n is None:
            return _world.tracing
        _world.tracing = int(n)

    def update(self):
        pass

    def delay(self, delay=None):
        return 10 if delay is None else None

    def mode(self, mode=None):
        return "standard" if mode is None else None

    def title(self, titlestring):
        pass

    def clear(self):
        _world.bg = "white"
        _world.tracing = 1
        _world.turtles = []
        _turtle_send({"action": "clearscreen"})

    def reset(self):
        for t in list(_world.turtles):
            t.reset()

    def turtles(self):
        return list(_world.turtles)

    def textinput(self, title, prompt):
        return input(prompt)

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        return float(input(prompt))

    def listen(self, xdummy=None, ydummy=None):
        pass

    def onkey(self, fun, key=None):
        pass

    def onkeypress(self, fun, key=None):
        pass

    def onclick(self, fun, btn=1, add=None):
        pass

    def ontimer(self, fun, t=0):
        pass

    def register_shape(self, name, shape=None):
        pass

    def getshapes(self):
        return list(_SHAPES)

    def getcanvas(self):
        return None

    def mainloop(self):
        pass

    def exitonclick(self):
        pass

    def bye(self):
        pass

    # Turtle methods also work on the screen, using the default turtle, as
    # this module always allowed (screen.forward(...))
    def __getattr__(self, name):
        if name.startswith("_") or not hasattr(WebTurtle, name):
            raise AttributeError("'_Screen' object has no attribute '%s'" % name)
        return getattr(_default_turtle(), name)

    clearscreen = clear
    resetscreen = reset
    onkeyrelease = onkey
    onscreenclick = onclick
    addshape = register_shape
    done = mainloop


def _default_turtle():
    # The module-level functions (turtle.forward(...)) use one turtle, made on
    # first use like in CPython
    if _world.default is None:
        _world.default = WebTurtle()
    return _world.default


def _module_function(owner, name):
    def turtle_function(*args, **kwargs):
        return getattr(owner(), name)(*args, **kwargs)
    turtle_function.__name__ = name
    return turtle_function


_screen = _WebScreen()
_m = types.ModuleType("turtle")
# Screen functions first: where a name is both, CPython's module function is
# the turtle's (clear, reset, onclick)
for _name in dir(_WebScreen):
    if not _name.startswith("_"):
        setattr(_m, _name, _module_function(lambda: _screen, _name))
for _name in dir(WebTurtle):
    if not _name.startswith("_"):
        setattr(_m, _name, _module_function(_default_turtle, _name))
_m.Turtle = _m.Pen = _m.RawTurtle = _m.RawPen = WebTurtle
_m.Screen = lambda: _screen
_m.TurtleScreen = _m._Screen = _WebScreen
_m.Vec2D = Vec2D
_m.Terminator = type("Terminator", (Exception,), {})
_m.TurtleGraphicsError = type("TurtleGraphicsError", (Exception,), {})
sys.modules["turtle"] = _m
`;

// ── Initialisation ───────────────────────────────────────────

async function initPyodide() {
    try {
        self.postMessage({ type: 'loading', pct: 10, label: 'Loading Python runtime…' });

        importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

        self.postMessage({ type: 'loading', pct: 40, label: 'Initializing Python…' });

        pyodide = await loadPyodide();

        self.postMessage({ type: 'loading', pct: 60, label: 'Setting up modules…' });

        // Register JS helpers that Python can call via `import js`
        self._turtleEmit = (jsonStr) => {
            self.postMessage({ type: 'turtle', command: JSON.parse(jsonStr) });
        };

        self._flushOutput = (text) => {
            self.postMessage({ type: 'output', text });
        };

        // Base imports
        await pyodide.runPythonAsync(`
import sys
import types
import math
import json as _json

# Raised to end a graded run early without counting as an error (see
# isProgramStop). BaseException so a student's "except Exception" can't catch it.
class _ProgramStop(BaseException):
    pass
        `);

        // The turtle module, compiled as "<turtle>" so that cleanPythonError
        // leaves its frames out of the student's tracebacks
        pyodide.globals.set('_turtle_source', TURTLE_PY);
        await pyodide.runPythonAsync('exec(compile(_turtle_source, "<turtle>", "exec"), globals())\ndel _turtle_source');

        self.postMessage({ type: 'loading', pct: 90, label: 'Python ready!' });
        isReady = true;
        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', message: 'Failed to load Python: ' + err.message });
    }
}

// ── Run user code (for the "Run" button) ─────────────────────
// Supports: live output via time.sleep(), input() via re-execution pattern.
// Every re-execution of one Run gets the same seed, so random values printed
// before an input() don't change once the student types the answer.
async function runCode(code, preloadedInputs, seed) {
    if (!isReady) {
        self.postMessage({ type: 'error', message: PYTHON_NOT_LOADED });
        return;
    }

    try {
        const inputsJson = JSON.stringify(preloadedInputs || []);

        // Setup environment: stdout capture, input mock, sleep, trace
        await pyodide.runPythonAsync(`
import sys, time, random
from io import StringIO

random.seed(${Number.isInteger(seed) ? seed : 'None'})
_turtle_new_run()

# ── Input handling ──
class _InputInterrupt(Exception):
    def __init__(self, prompt=""):
        self.prompt = prompt
        super().__init__("InputInterrupt")

_preloaded_inputs = ${inputsJson}
_input_index = 0
_replay_phase = len(_preloaded_inputs) > 0

def _mock_input(prompt=""):
    global _input_index, _replay_phase
    if _input_index < len(_preloaded_inputs):
        val = str(_preloaded_inputs[_input_index])
        _input_index += 1
        # Show the prompt + typed value in output
        sys.stdout.write(str(prompt) + val + "\\n")
        if _input_index >= len(_preloaded_inputs):
            _replay_phase = False
        return val
    else:
        # Write the prompt to output before requesting input
        sys.stdout.write(str(prompt))
        # Flush output to main thread
        import js
        js._flushOutput(sys.stdout.getvalue())
        raise _InputInterrupt(str(prompt))

__builtins__.input = _mock_input

# ── Stdout capture ──
sys.stdout = StringIO()

# ── time.sleep patch ──
_original_sleep = time.sleep

def _patched_sleep(seconds):
    global _start_time
    if _replay_phase:
        return  # Skip sleep during input replay (fast replay)
    # Flush output to main thread BEFORE sleeping
    import js
    js._flushOutput(sys.stdout.getvalue())
    # Busy-wait (blocks worker thread, NOT the UI)
    _end = time.time() + float(seconds)
    while time.time() < _end:
        pass
    # Reset CPU trace timer
    _start_time = time.time()

time.sleep = _patched_sleep

# ── Infinite loop protection ──
_start_time = time.time()
_total_start = time.time()
_line_count = 0
_LINE_LIMIT = 10_000_000          # ~tens of millions of CPython ops
_OUTPUT_LIMIT = 500_000           # 500 KB stdout cap (per run)
_CPU_BURST_LIMIT = 3.0            # seconds without sleep/input
_TOTAL_LIMIT = 60.0               # absolute wall-clock cap

def _trace(frame, event, arg):
    global _line_count
    _line_count += 1
    # 1. Iteration cap (catches tight loops within milliseconds even in slow
    # browsers, before stdout balloons or the 3s burst timer fires).
    if _line_count > _LINE_LIMIT:
        sys.settrace(None)
        raise Exception(
            "Infinite loop detected! Your code ran more than "
            f"{_LINE_LIMIT:,} steps.\\nTip: If you intended a long loop, "
            "add time.sleep() or call input() so the loop can pause."
        )
    # 2. Output buffer cap (prevents the worker from posting a multi-MB
    # string back to the main thread which would lock the UI thread).
    try:
        if sys.stdout.tell() > _OUTPUT_LIMIT:
            sys.settrace(None)
            raise Exception(
                "Output too large! Your program printed more than "
                f"{_OUTPUT_LIMIT // 1000} KB. Limit your loops or use a "
                "counter to print fewer lines."
            )
    except (AttributeError, OSError):
        pass  # stdout might have been replaced by user code
    # 3. CPU-burst timer (covers cases the line counter misses).
    elapsed_cpu = time.time() - _start_time
    elapsed_total = time.time() - _total_start
    if elapsed_total > _TOTAL_LIMIT:
        sys.settrace(None)
        raise Exception(
            f"Program stopped: Maximum execution time ({int(_TOTAL_LIMIT)}s) "
            "exceeded."
        )
    if elapsed_cpu > _CPU_BURST_LIMIT:
        sys.settrace(None)
        raise Exception(
            "Infinite loop detected! Your code ran for too long without "
            "pausing.\\nTip: If you intended to loop, add time.sleep() or "
            "input() to control the speed."
        )
    return _trace

sys.settrace(_trace)
        `);

        // Run the user's code
        try {
            await pyodide.runPythonAsync(code);
        } catch (err) {
            if (!isProgramStop(err)) throw err;
        }

        // Cleanup and get output
        const output = await pyodide.runPythonAsync(`
sys.settrace(None)
time.sleep = _original_sleep
_result = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
_result
        `);

        self.postMessage({ type: 'done', output });

    } catch (err) {
        const errMsg = err.message || String(err);

        // Check if it's an InputInterrupt (needs user input)
        if (errMsg.includes('InputInterrupt')) {
            // Get current output before the input request
            try {
                const currentOutput = await pyodide.runPythonAsync(`
sys.settrace(None)
time.sleep = _original_sleep
_result = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
_result
                `);
                self.postMessage({
                    type: 'input_request',
                    outputSoFar: currentOutput
                });
            } catch (e) {
                self.postMessage({
                    type: 'input_request',
                    outputSoFar: ''
                });
            }
        } else {
            // Clean up Python state
            try {
                await pyodide.runPythonAsync(`
sys.settrace(None)
try:
    time.sleep = _original_sleep
except:
    pass
sys.stdout = sys.__stdout__
                `);
            } catch (_) { /* ignore cleanup errors */ }

            self.postMessage({ type: 'error', message: cleanPythonError(errMsg) });
        }
    }
}

// ── Test isolation ───────────────────────────────────────────
// Graded code runs in its own namespace, and every test case starts from the
// same files, so a variable or a file line left by an earlier run can't
// change the result.

function freshNamespace() {
    return pyodide.toPy({ __name__: '__main__' });
}

function snapshotFiles() {
    const snap = {};
    for (const name of pyodide.FS.readdir('.')) {
        if (name !== '.' && name !== '..' && pyodide.FS.isFile(pyodide.FS.stat(name).mode)) {
            snap[name] = pyodide.FS.readFile(name);
        }
    }
    return snap;
}

function restoreFiles(snap) {
    for (const name of pyodide.FS.readdir('.')) {
        if (name !== '.' && name !== '..' && !(name in snap) && pyodide.FS.isFile(pyodide.FS.stat(name).mode)) {
            pyodide.FS.unlink(name);
        }
    }
    for (const [name, data] of Object.entries(snap)) {
        pyodide.FS.writeFile(name, data);
    }
}

// ── Run test cases (for "Submit Answer") ─────────────────────
async function runTestCases(code, testCases, validationScript) {
    if (!isReady) {
        self.postMessage({
            type: 'test_done',
            results: testCases.map((tc, i) => ({
                testCaseIndex: i,
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                actualOutput: `Error: ${PYTHON_NOT_LOADED}`,
                passed: false,
                error: PYTHON_NOT_LOADED
            })),
            validationResult: { passed: true, error: null },
            lastOutput: ''
        });
        return;
    }

    const results = [];
    let lastOutput = '';
    const filesBefore = snapshotFiles();
    let ns = null;

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const inputs = Array.isArray(tc.input) ? tc.input : [tc.input];

        restoreFiles(filesBefore);
        if (ns) ns.destroy();
        ns = freshNamespace();

        try {
            // Setup environment for this test case
            await pyodide.runPythonAsync(`
import sys, time, random
from io import StringIO

random.seed()
_turtle_new_run()

_test_inputs = ${JSON.stringify(inputs)}
_test_input_idx = 0
_stop_when_inputs_run_out = ${tc.stopWhenInputsRunOut ? 'True' : 'False'}

def _test_mock_input(prompt=""):
    global _test_input_idx
    if _test_input_idx < len(_test_inputs):
        val = str(_test_inputs[_test_input_idx])
        _test_input_idx += 1
        return val
    if _stop_when_inputs_run_out:
        # The program loops on input() forever by design; this is its end
        raise _ProgramStop("test inputs ran out")
    raise EOFError("Test execution stopped: No more input values available")

__builtins__.input = _test_mock_input
sys.stdout = StringIO()

_original_sleep = time.sleep
_start_time = time.time()
_test_line_count = 0
_TEST_LINE_LIMIT = 5_000_000
_TEST_OUTPUT_LIMIT = 200_000
_TEST_CPU_LIMIT = 3.0

def _test_sleep(seconds):
    global _start_time
    _start_time = time.time()
    # Skip actual sleep during tests for speed

time.sleep = _test_sleep

def _test_trace(frame, event, arg):
    global _test_line_count
    _test_line_count += 1
    if _test_line_count > _TEST_LINE_LIMIT:
        sys.settrace(None)
        raise Exception(
            f"Infinite loop detected during testing (more than "
            f"{_TEST_LINE_LIMIT:,} steps)."
        )
    try:
        if sys.stdout.tell() > _TEST_OUTPUT_LIMIT:
            sys.settrace(None)
            raise Exception(
                "Output too large during testing (>"
                f"{_TEST_OUTPUT_LIMIT // 1000} KB)."
            )
    except (AttributeError, OSError):
        pass
    if time.time() - _start_time > _TEST_CPU_LIMIT:
        sys.settrace(None)
        raise Exception("Infinite loop detected during testing!")
    return _test_trace

sys.settrace(_test_trace)
            `);

            // Run the code
            try {
                await pyodide.runPythonAsync(code, { globals: ns });
            } catch (err) {
                if (!isProgramStop(err)) throw err;
            }

            // Clean up trace
            await pyodide.runPythonAsync('sys.settrace(None)');

            // Get output
            const output = await pyodide.runPythonAsync('sys.stdout.getvalue()');

            // Reset
            await pyodide.runPythonAsync(`
time.sleep = _original_sleep
sys.stdout = sys.__stdout__
            `);

            // Handle eval: dynamic expected output
            let expectedOutput = tc.expectedOutput;
            if (typeof expectedOutput === 'string' && expectedOutput.startsWith('eval:')) {
                const expression = expectedOutput.substring(5).trim();
                try {
                    expectedOutput = String(await pyodide.runPythonAsync(expression, { globals: ns }));
                } catch (evalErr) {
                    expectedOutput = `[Dynamic Rule Error: ${evalErr.message}]`;
                }
            }

            results.push({
                testCaseIndex: i,
                input: tc.input,
                expectedOutput,
                actualOutput: output,
                passed: tc.expectedOutput === '*' || normalizeOutput(output) === normalizeOutput(expectedOutput),
                error: null
            });

            lastOutput = output;

        } catch (err) {
            const errMsg = err.message || String(err);

            // Output printed before the program was stopped
            let partialOutput = '';
            try {
                partialOutput = await pyodide.runPythonAsync('sys.settrace(None)\nsys.stdout.getvalue()');
            } catch (_) {}

            // Clean up on error
            try {
                await pyodide.runPythonAsync(`
sys.settrace(None)
try:
    time.sleep = _original_sleep
except:
    pass
sys.stdout = sys.__stdout__
                `);
            } catch (_) {}

            // A test case flagged allowRunaway is for a program meant to run
            // forever (an animation or clock), so being stopped by the limits is
            // its normal end: it passes on "*", or when its first lines are the
            // expected output.
            if (tc.allowRunaway && /Infinite loop detected|Output too large/.test(errMsg)) {
                const anyOutput = tc.expectedOutput === '*';
                const expectedLines = normalizeOutput(tc.expectedOutput).split('\n').length;
                lastOutput = anyOutput ? partialOutput.slice(-5000) : firstLines(partialOutput, expectedLines);
                results.push({
                    testCaseIndex: i,
                    input: tc.input,
                    expectedOutput: tc.expectedOutput,
                    actualOutput: lastOutput,
                    passed: anyOutput || lastOutput === normalizeOutput(tc.expectedOutput),
                    error: null
                });
                continue;
            }

            const cleanError = cleanPythonError(errMsg);
            results.push({
                testCaseIndex: i,
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                actualOutput: `Error: ${cleanError}`,
                passed: false,
                error: cleanError
            });
        }
    }

    // Run validation script if provided (against the last test case's variables)
    let validationResult = { passed: true, error: null };
    if (validationScript && validationScript.trim()) {
        try {
            await pyodide.runPythonAsync(validationScript, { globals: ns });
        } catch (err) {
            validationResult = { passed: false, error: err.message };
        }
    }
    if (ns) ns.destroy();
    // Leave the files as they were, so submitting again behaves the same
    restoreFiles(filesBefore);

    self.postMessage({
        type: 'test_done',
        results,
        validationResult,
        lastOutput
    });
}

// ── Run code for submit (no test cases) ──────────────────────
async function runForSubmit(code, validationScript) {
    if (!isReady) {
        self.postMessage({ type: 'submit_done', output: '', validationResult: { passed: true, error: null }, error: PYTHON_NOT_LOADED });
        return;
    }

    const ns = freshNamespace();
    try {
        // Setup — simpler than runCode (no live output, no input)
        await pyodide.runPythonAsync(`
import sys, time, random
from io import StringIO

random.seed()
_turtle_new_run()

def _submit_input(prompt=""):
    # A step without test cases has no inputs to give, so the program ends
    # here and is graded on its code requirements.
    raise _ProgramStop("no input available during submission")

__builtins__.input = _submit_input
sys.stdout = StringIO()

_original_sleep = time.sleep
_start_time = time.time()
_submit_line_count = 0
_SUBMIT_LINE_LIMIT = 5_000_000
_SUBMIT_OUTPUT_LIMIT = 200_000
_SUBMIT_CPU_LIMIT = 5.0

def _submit_sleep(seconds):
    global _start_time
    _start_time = time.time()

time.sleep = _submit_sleep

def _submit_trace(frame, event, arg):
    global _submit_line_count
    _submit_line_count += 1
    if _submit_line_count > _SUBMIT_LINE_LIMIT:
        sys.settrace(None)
        raise Exception(
            f"Infinite loop detected during submission "
            f"(more than {_SUBMIT_LINE_LIMIT:,} steps)."
        )
    try:
        if sys.stdout.tell() > _SUBMIT_OUTPUT_LIMIT:
            sys.settrace(None)
            raise Exception(
                "Output too large during submission "
                f"(>{_SUBMIT_OUTPUT_LIMIT // 1000} KB)."
            )
    except (AttributeError, OSError):
        pass
    if time.time() - _start_time > _SUBMIT_CPU_LIMIT:
        sys.settrace(None)
        raise Exception("Infinite loop detected!")
    return _submit_trace

sys.settrace(_submit_trace)
        `);

        try {
            await pyodide.runPythonAsync(code, { globals: ns });
        } catch (err) {
            if (!isProgramStop(err)) throw err;
        }

        const output = await pyodide.runPythonAsync(`
sys.settrace(None)
time.sleep = _original_sleep
_result = sys.stdout.getvalue()
sys.stdout = sys.__stdout__
_result
        `);

        // Run validation script
        let validationResult = { passed: true, error: null };
        if (validationScript && validationScript.trim()) {
            try {
                await pyodide.runPythonAsync(validationScript, { globals: ns });
            } catch (err) {
                validationResult = { passed: false, error: err.message };
            }
        }

        self.postMessage({ type: 'submit_done', output, validationResult, error: null });

    } catch (err) {
        try {
            await pyodide.runPythonAsync(`
sys.settrace(None)
try: time.sleep = _original_sleep
except: pass
sys.stdout = sys.__stdout__
            `);
        } catch (_) {}

        self.postMessage({ type: 'submit_done', output: '', validationResult: { passed: true, error: null }, error: err.message });
    } finally {
        ns.destroy();
    }
}

// ── File I/O ─────────────────────────────────────────────────

function syncFiles() {
    if (!pyodide) return;
    try {
        const json = pyodide.runPython(`
import os, json
_files = []
for f in os.listdir('.'):
    if os.path.isfile(f) and not f.startswith('.'):
        try:
            with open(f, 'r', encoding='utf-8') as fh:
                _files.append({"name": f, "content": fh.read()})
        except:
            pass
json.dumps(_files)
        `);
        self.postMessage({ type: 'files', files: JSON.parse(json) });
    } catch (e) {
        self.postMessage({ type: 'files', files: [] });
    }
}

function saveFile(name, content) {
    if (!pyodide) return;
    pyodide.FS.writeFile(name, content, { encoding: 'utf8' });
    syncFiles();
}

function deleteFile(name) {
    if (!pyodide) return;
    try {
        pyodide.FS.unlink(name);
    } catch (_) {}
    syncFiles();
}

// ── Utility ──────────────────────────────────────────────────

// True when a run ended through _ProgramStop (turtle move budget, inputs that
// ran out by design) or sys.exit()/exit(), all of which are a normal finish.
function isProgramStop(err) {
    const msg = (err && err.message) || String(err);
    return /(^|\n)(_ProgramStop|SystemExit)\b/.test(msg);
}

function normalizeOutput(str) {
    if (!str) return '';
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

// The first n lines of a program's output, normalised like normalizeOutput
function firstLines(str, n) {
    return normalizeOutput(str).split('\n').slice(0, n).join('\n');
}

// Helpers this worker defines in Python (input mocks, loop guards): their
// frames point at lines that aren't in the student's code. The turtle
// module's frames are in "<turtle>", which is dropped anyway
const INTERNAL_FRAME = /^(_trace|_test_\w+|_submit_\w+|_mock_input|_patched_sleep)$/;

// The student's part of a Python traceback: drops Pyodide's frames and this
// worker's helpers (with their source and ^^^ lines), and repeated frames
function cleanPythonError(errMsg) {
    if (!errMsg.includes('File "<exec>"')) return errMsg;
    const lines = [];
    let skipping = false;
    for (const line of errMsg.split('\n')) {
        const frame = line.match(/^\s*File "([^"]*)", line \d+, in (\S+)/);
        if (frame) {
            skipping = frame[1] !== '<exec>' || INTERNAL_FRAME.test(frame[2]);
            if (!skipping && line !== lines[lines.length - 1]) lines.push(line);
        } else if (!(skipping && /^\s{4}/.test(line))) {
            skipping = false;
            lines.push(line);
        }
    }
    return lines.join('\n').trim();
}

// ── Message handler ──────────────────────────────────────────

// Messages are handled one at a time, in the order they arrive. A Run or
// Submit sent while Python is still loading then waits for it instead of being
// dropped, and a double-clicked Submit can't run two sets of tests on the same
// interpreter at once (they would swap each other's inputs and output).
let messageQueue = Promise.resolve();

self.onmessage = (e) => {
    messageQueue = messageQueue
        .then(() => handleMessage(e.data))
        .catch(err => console.error('pythonWorker:', err));
};

async function handleMessage(msg) {
    switch (msg.type) {
        case 'init':
            await initPyodide();
            break;

        case 'run':
            await runCode(msg.code, msg.inputs || [], msg.seed);
            break;

        case 'test':
            await runTestCases(msg.code, msg.testCases, msg.validationScript);
            break;

        case 'submit_run':
            await runForSubmit(msg.code, msg.validationScript);
            break;

        case 'sync_files':
            syncFiles();
            break;

        case 'save_file':
            saveFile(msg.name, msg.content);
            break;

        case 'delete_file':
            deleteFile(msg.name);
            break;
    }
}
