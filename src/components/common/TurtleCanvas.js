import React, { useEffect, useRef, useState } from 'react';
import { FastForward, Move, RotateCcw, X } from 'lucide-react';

// Turtle graphics for the Python portal. The turtle module in
// public/pythonWorker.js sends one command per action while a program runs
// (new turtle, move, turn, fill, write, ...). TurtleStream collects them and
// TurtlePanel draws them the way CPython's turtle window does: animated at
// each turtle's speed, with fills, text, dots, stamps and the turtle's shape.

// CPython moves a turtle in hops of 3 * 1.1^speed * speed pixels and turns it
// in steps of 3 * speed degrees, with one screen update per hop
const HOPS_PER_SECOND = 40;
// Most commands handled in one animation frame when they don't animate
const INSTANT_PER_FRAME = 20000;

// CPython's turtle shapes, pointing up (+y); see drawShape
const circleShape = Array.from({ length: 20 }, (_, i) => [10 * Math.cos(i * Math.PI / 10), 10 * Math.sin(i * Math.PI / 10)]);
const SHAPES = {
    classic: [[0, 0], [-5, -9], [0, -7], [5, -9]],
    arrow: [[-10, 0], [10, 0], [0, 10]],
    turtle: [[0, 16], [-2, 14], [-1, 10], [-4, 7], [-7, 9], [-9, 8], [-6, 5], [-7, 1], [-5, -3], [-8, -6],
        [-6, -8], [-4, -5], [0, -7], [4, -5], [6, -8], [8, -6], [5, -3], [7, 1], [6, 5], [9, 8], [7, 9],
        [4, 7], [1, 10], [2, 14]],
    square: [[10, -10], [10, 10], [-10, 10], [-10, -10]],
    triangle: [[10, -5.77], [0, 11.55], [-10, -5.77]],
    circle: circleShape,
    blank: [],
};

const sameCommand = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The commands of the program run on screen. After an input() the worker runs
// the program again from the start with the inputs so far (see runCode in
// pythonWorker.js), so that run repeats the commands already drawn first.
export class TurtleStream {
    constructor() {
        this.commands = [];
        this.version = 0; // goes up when the drawing starts over
        this.replayAt = null; // while a re-run repeats the commands drawn
        this.divergedAt = null; // a re-run drew something else from here
        this.listeners = new Set();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach((listener) => listener());
    }

    // A new run: the drawing starts over
    reset() {
        this.load([]);
    }

    // Shows a finished run's commands (a graded run on Submit)
    load(commands) {
        this.commands = [...commands];
        this.version++;
        this.replayAt = null;
        this.divergedAt = null;
        this.notify();
    }

    // The same run again after an input(): only what comes after the
    // commands already drawn is new
    replay() {
        this.replayAt = 0;
    }

    push(command) {
        if (this.replayAt !== null) {
            if (this.replayAt < this.commands.length) {
                if (sameCommand(this.commands[this.replayAt], command)) {
                    this.replayAt++;
                    return;
                }
                // It went another way this time (time- or input-dependent
                // drawing): drop what the earlier run drew from here on
                this.commands.length = this.replayAt;
                this.divergedAt = Math.min(this.divergedAt ?? Infinity, this.replayAt);
            }
            this.replayAt = null;
        }
        this.commands.push(command);
        this.notify();
    }
}

// Seconds a command takes on screen at its turtle's speed (0 = no animation)
const commandDuration = (cmd) => {
    const speed = cmd.speed;
    if (!speed) return 0;
    if (cmd.action === 'move') {
        const dist = Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1);
        return (1 + Math.floor(dist / (3 * 1.1 ** speed * speed))) / HOPS_PER_SECOND;
    }
    if (cmd.action === 'turn' && cmd.angle) {
        return (1 + Math.floor(Math.abs(cmd.angle) / (3 * speed))) / HOPS_PER_SECOND;
    }
    return 0;
};

// A canvas keeps its last valid color when given one it doesn't know, so
// start from black (unknown turtle colors draw black)
const setColor = (ctx, prop, color) => {
    ctx[prop] = '#000';
    ctx[prop] = color;
};

const drawLine = (ctx, x1, y1, x2, y2, color, width) => {
    setColor(ctx, 'strokeStyle', color);
    ctx.lineWidth = Math.max(1, width);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
};

// A turtle shape at (x, y) facing heading h. As in CPython, a shape's +y
// points along the heading and +x to its right; shapesize stretches x by
// size[0] and y by size[1].
const drawShape = (ctx, look, x, y, h) => {
    const poly = SHAPES[look.shape] || SHAPES.classic;
    if (!poly.length) return;
    const [stretchWid, stretchLen] = look.size || [1, 1];
    const r = (h * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    ctx.beginPath();
    poly.forEach(([px, py], i) => {
        const ax = px * stretchWid;
        const ay = py * stretchLen;
        const wx = x + ax * s + ay * c;
        const wy = y - ax * c + ay * s;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
    });
    ctx.closePath();
    setColor(ctx, 'fillStyle', look.fill);
    ctx.fill();
    setColor(ctx, 'strokeStyle', look.color);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
};

// Text the way Tk draws turtle.write(): sizes in points, the bottom of the
// text at the turtle, left/center/right of it
const drawText = (ctx, item) => {
    const [family, size, style] = item.font;
    const points = Number(size) || 8;
    const px = points < 0 ? -points : (points * 4) / 3;
    const styles = String(style).toLowerCase();
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.scale(1, -1);
    ctx.font = `${styles.includes('italic') ? 'italic ' : ''}${styles.includes('bold') ? 'bold ' : ''}${px}px ${family}, sans-serif`;
    ctx.textAlign = { center: 'center', right: 'right' }[item.align] || 'left';
    ctx.textBaseline = 'bottom';
    setColor(ctx, 'fillStyle', item.color);
    ctx.fillText(item.text, 0, 0);
    if (styles.includes('underline')) {
        const width = ctx.measureText(item.text).width;
        const left = ctx.textAlign === 'center' ? -width / 2 : ctx.textAlign === 'right' ? -width : 0;
        ctx.fillRect(left, 0, width, Math.max(1, px / 14));
    }
    ctx.restore();
};

const drawItem = (ctx, item) => {
    switch (item.kind) {
        case 'line':
            drawLine(ctx, item.x1, item.y1, item.x2, item.y2, item.color, item.width);
            break;
        case 'fill': {
            if (!item.points || item.points.length < 3) break;
            ctx.beginPath();
            item.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
            ctx.closePath();
            setColor(ctx, 'fillStyle', item.color);
            ctx.fill('evenodd');
            break;
        }
        case 'write':
            drawText(ctx, item);
            break;
        case 'dot':
            setColor(ctx, 'fillStyle', item.color);
            ctx.beginPath();
            ctx.arc(item.x, item.y, Math.max(0.5, item.size / 2), 0, 2 * Math.PI);
            ctx.fill();
            break;
        case 'stamp':
            drawShape(ctx, item, item.x, item.y, item.h);
            break;
        default:
            break;
    }
};

const DEFAULT_LOOK = { h: 0, visible: true, shape: 'classic', color: 'black', fill: 'black', size: [1, 1] };

// Plays a TurtleStream onto a canvas. Finished drawing is kept on an
// offscreen "ink" canvas; each frame paints the background, the ink, the move
// in progress and the turtles.
class TurtlePlayer {
    constructor(stream, canvas, onChange) {
        this.stream = stream;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ink = document.createElement('canvas');
        this.ink.width = canvas.width;
        this.ink.height = canvas.height;
        this.inkCtx = this.ink.getContext('2d');
        this.onChange = onChange;
        this.version = stream.version;
        this.skipping = false;
        this.raf = null;
        this.last = 0;
        this.reported = null;
        this.clearScene();
        this.frame = this.frame.bind(this);
        this.unsubscribe = stream.subscribe(() => this.wake());
    }

    clearScene() {
        this.index = 0; // next command to show
        this.progress = 0; // how far the command at index has animated
        this.items = []; // finished drawing, oldest first
        this.turtles = new Map();
        this.fillSlots = new Map(); // turtle id -> fill started by begin_fill
        this.bg = 'white';
        this.world = { width: 400, height: 400 };
        this.inkDirty = true;
    }

    dispose() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.unsubscribe();
    }

    wake() {
        if (this.raf) return;
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.frame);
    }

    resize(width, height, dpr) {
        const w = Math.max(1, Math.round(width * dpr));
        const h = Math.max(1, Math.round(height * dpr));
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = this.ink.width = w;
        this.canvas.height = this.ink.height = h;
        this.inkDirty = true;
        this.wake();
    }

    replay() {
        this.clearScene();
        this.skipping = false;
        this.wake();
    }

    skip() {
        this.skipping = true;
        this.wake();
    }

    // Shows the commands up to now at once (a panel opened mid-run)
    catchUp() {
        this.skipping = this.stream.commands.length > 0;
        this.wake();
    }

    // Turtle coordinates on a canvas: origin in the middle, y up
    toWorld(ctx) {
        const k = this.canvas.width / this.world.width;
        ctx.setTransform(k, 0, 0, -k, this.canvas.width / 2, this.canvas.height / 2);
    }

    turtle(id) {
        if (!this.turtles.has(id)) this.turtles.set(id, { ...DEFAULT_LOOK, x: 0, y: 0 });
        return this.turtles.get(id);
    }

    addItem(item) {
        this.items.push(item);
        if (!this.inkDirty) {
            this.toWorld(this.inkCtx);
            drawItem(this.inkCtx, item);
        }
    }

    apply(cmd) {
        const { id } = cmd;
        switch (cmd.action) {
            case 'new':
                this.turtles.set(id, { ...DEFAULT_LOOK, ...cmd });
                break;
            case 'state':
                Object.assign(this.turtle(id), cmd);
                break;
            case 'move': {
                const t = this.turtle(id);
                t.x = cmd.x2;
                t.y = cmd.y2;
                t.h = cmd.h;
                if (cmd.pen) {
                    this.addItem({ kind: 'line', id, x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, color: cmd.color, width: cmd.width });
                }
                break;
            }
            case 'turn':
                this.turtle(id).h = cmd.h;
                break;
            case 'beginfill': {
                // The fill goes under what the turtle draws until end_fill
                const slot = { kind: 'fill', id, points: null, color: null };
                this.items.push(slot);
                this.fillSlots.set(id, slot);
                break;
            }
            case 'fill': {
                const slot = this.fillSlots.get(id);
                this.fillSlots.delete(id);
                if (slot) {
                    slot.points = cmd.points;
                    slot.color = cmd.color;
                    this.inkDirty = true;
                } else {
                    this.addItem({ kind: 'fill', id, points: cmd.points, color: cmd.color });
                }
                break;
            }
            case 'write':
            case 'dot':
            case 'stamp':
                this.addItem({ ...cmd, kind: cmd.action });
                break;
            case 'clear':
                this.items = this.items.filter((item) => item.id !== id);
                this.inkDirty = true;
                break;
            case 'clearstamp':
                this.items = this.items.filter((item) => !(item.kind === 'stamp' && item.stamp === cmd.stamp));
                this.inkDirty = true;
                break;
            case 'clearstamps':
                this.items = this.items.filter((item) => !(item.kind === 'stamp' && item.id === id));
                this.inkDirty = true;
                break;
            case 'clearscreen':
                this.items = [];
                this.turtles.clear();
                this.fillSlots.clear();
                this.bg = 'white';
                this.inkDirty = true;
                break;
            case 'bgcolor':
                this.bg = cmd.color;
                break;
            case 'setup':
                this.world = { width: cmd.width, height: cmd.height };
                this.inkDirty = true;
                break;
            default:
                break;
        }
    }

    // Shows commands [0, n) at once, from an empty screen
    rebuild(n) {
        this.clearScene();
        const { commands } = this.stream;
        for (let i = 0; i < n && i < commands.length; i++) this.apply(commands[i]);
        this.index = Math.min(n, commands.length);
    }

    frame(now) {
        this.raf = null;
        const { stream } = this;
        if (stream.version !== this.version) {
            this.version = stream.version;
            this.clearScene();
        }
        if (stream.divergedAt !== null) {
            const at = stream.divergedAt;
            stream.divergedAt = null;
            if (this.index > at) this.rebuild(at);
        }

        let budget = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        const { commands } = stream;
        let handled = 0;
        while (this.index < commands.length && handled < INSTANT_PER_FRAME) {
            const cmd = commands[this.index];
            const duration = this.skipping ? 0 : commandDuration(cmd);
            if (duration > 0) {
                const left = duration * (1 - this.progress);
                if (budget < left) {
                    this.progress += budget / duration;
                    break;
                }
                budget -= left;
            }
            this.apply(cmd);
            this.index++;
            this.progress = 0;
            handled++;
        }
        const animating = this.index < commands.length;
        if (!animating) this.skipping = false;

        this.draw(animating ? commands[this.index] : null);
        this.report({ animating, drawn: this.index > 0, width: this.world.width, height: this.world.height });
        if (animating) this.raf = requestAnimationFrame(this.frame);
    }

    report(state) {
        const r = this.reported;
        if (r && r.animating === state.animating && r.drawn === state.drawn && r.width === state.width && r.height === state.height) return;
        this.reported = state;
        this.onChange(state);
    }

    draw(current) {
        const { ctx, canvas } = this;
        if (this.inkDirty) {
            this.inkCtx.setTransform(1, 0, 0, 1, 0, 0);
            this.inkCtx.clearRect(0, 0, this.ink.width, this.ink.height);
            this.toWorld(this.inkCtx);
            this.items.forEach((item) => drawItem(this.inkCtx, item));
            this.inkDirty = false;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        setColor(ctx, 'fillStyle', this.bg);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.ink, 0, 0);
        this.toWorld(ctx);

        // The move or turn in progress
        let pose = null;
        if (current && this.progress > 0) {
            if (current.action === 'move') {
                const x = current.x1 + (current.x2 - current.x1) * this.progress;
                const y = current.y1 + (current.y2 - current.y1) * this.progress;
                if (current.pen) drawLine(ctx, current.x1, current.y1, x, y, current.color, current.width);
                pose = { id: current.id, x, y, h: current.h };
            } else if (current.action === 'turn') {
                pose = { id: current.id, h: current.h - current.angle * (1 - this.progress) };
            }
        }
        this.turtles.forEach((t, id) => {
            if (!t.visible) return;
            const p = pose && pose.id === id ? { ...t, ...pose } : t;
            drawShape(ctx, p, p.x, p.y, p.h);
        });
    }
}

const PanelButton = ({ label, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700 transition-colors"
    >
        {children}
    </button>
);

// Where the turtle window was dragged to, from the middle of the editor. Kept
// while the page is open, so the window opens there again
let savedOffset = { x: 0, y: 0 };
const STAGE_MARGIN = 16; // between the window and the editor's edges (p-4)
const CANVAS_PADDING = 12; // around the canvas in the window (p-3)
const MAX_CANVAS_SCALE = 1.2; // of the turtle screen's size

// The turtle window. It floats in the middle of the code editor (its parent
// must be positioned) and can be dragged by its title bar; double-clicking the
// title bar centres it again. It draws while the program runs, and keeps
// drawing while the program waits for input().
export const TurtlePanel = ({ stream, running, waitingForInput, catchUp = false, onClose }) => {
    const stageRef = useRef(null);
    const headerRef = useRef(null);
    const canvasRef = useRef(null);
    const playerRef = useRef(null);
    const limitsRef = useRef({ x: 0, y: 0 }); // how far the window can move from the middle
    const [view, setView] = useState({ animating: false, drawn: false, width: 400, height: 400 });
    const [cssSize, setCssSize] = useState(null);
    const [offset, setOffset] = useState(savedOffset);

    const clampOffset = ({ x, y }) => {
        const limits = limitsRef.current;
        return { x: Math.min(limits.x, Math.max(-limits.x, x)), y: Math.min(limits.y, Math.max(-limits.y, y)) };
    };
    const moveTo = (next) => {
        savedOffset = clampOffset(next);
        setOffset(savedOffset);
    };

    useEffect(() => {
        const player = new TurtlePlayer(stream, canvasRef.current, setView);
        playerRef.current = player;
        if (catchUp) player.catchUp();
        else player.wake();
        return () => player.dispose();
        // catchUp only matters when the panel opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stream]);

    // As large as fits in the editor, up to MAX_CANVAS_SCALE, and kept inside it
    useEffect(() => {
        const fit = () => {
            const stage = stageRef.current;
            if (!stage) return;
            const roomWidth = stage.clientWidth - 2 * STAGE_MARGIN;
            const roomHeight = stage.clientHeight - 2 * STAGE_MARGIN;
            const chromeWidth = 2 * CANVAS_PADDING + 2;
            const chromeHeight = (headerRef.current?.offsetHeight || 40) + 2 * CANVAS_PADDING + 2;
            const scale = Math.max(0.25, Math.min(
                (roomWidth - chromeWidth) / view.width,
                (roomHeight - chromeHeight) / view.height,
                MAX_CANVAS_SCALE
            ));
            const width = view.width * scale;
            const height = view.height * scale;
            limitsRef.current = {
                x: Math.max(0, (roomWidth - width - chromeWidth) / 2),
                y: Math.max(0, (roomHeight - height - chromeHeight) / 2),
            };
            setCssSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
            savedOffset = clampOffset(savedOffset);
            setOffset((old) => (old.x === savedOffset.x && old.y === savedOffset.y ? old : savedOffset));
            playerRef.current?.resize(width, height, window.devicePixelRatio || 1);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(stageRef.current);
        return () => observer.disconnect();
        // clampOffset only reads refs
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view.width, view.height]);

    const startDrag = (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        e.preventDefault();
        const header = e.currentTarget;
        const start = { x: e.clientX, y: e.clientY, from: savedOffset };
        const onMove = (ev) => moveTo({ x: start.from.x + ev.clientX - start.x, y: start.from.y + ev.clientY - start.y });
        const onEnd = () => {
            header.removeEventListener('pointermove', onMove);
            header.removeEventListener('pointerup', onEnd);
            header.removeEventListener('pointercancel', onEnd);
        };
        header.setPointerCapture(e.pointerId);
        header.addEventListener('pointermove', onMove);
        header.addEventListener('pointerup', onEnd);
        header.addEventListener('pointercancel', onEnd);
    };

    const status = view.animating ? 'Drawing…' : waitingForInput ? 'Waiting for input' : running ? 'Running…' : 'Done';
    const busy = view.animating || waitingForInput || running;

    return (
        <div ref={stageRef} className="absolute inset-0 z-30 p-4 flex items-center justify-center pointer-events-none">
            <section
                aria-label="Turtle output"
                className="pointer-events-auto rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
            >
                <div
                    ref={headerRef}
                    onPointerDown={startDrag}
                    onDoubleClick={(e) => { if (!e.target.closest('button')) moveTo({ x: 0, y: 0 }); }}
                    title="Drag to move, double-click to centre"
                    className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 border-b border-slate-200 dark:border-slate-700 cursor-move select-none touch-none"
                >
                    <Move size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-800 dark:text-white">Turtle</span>
                    <span className={`flex items-center gap-1.5 text-[11px] font-medium ${busy ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                        {busy && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />}
                        {status}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5">
                        {view.animating ? (
                            <PanelButton label="Skip to the end" onClick={() => playerRef.current?.skip()}>
                                <FastForward size={15} />
                            </PanelButton>
                        ) : view.drawn && (
                            <PanelButton label="Draw again" onClick={() => playerRef.current?.replay()}>
                                <RotateCcw size={15} />
                            </PanelButton>
                        )}
                        <PanelButton label="Hide turtle" onClick={onClose}>
                            <X size={15} />
                        </PanelButton>
                    </div>
                </div>
                <div className="p-3">
                    <canvas
                        ref={canvasRef}
                        role="img"
                        aria-label="Turtle drawing"
                        style={cssSize ? { width: cssSize.width, height: cssSize.height } : undefined}
                        className="block rounded-md ring-1 ring-slate-200 dark:ring-slate-600"
                    />
                </div>
            </section>
        </div>
    );
};
