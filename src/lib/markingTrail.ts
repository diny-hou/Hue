/** Path length (px) behind the cursor before the trail fully fades out. */
export const MARKING_TRAIL_FADE_PX = 140;

export type MarkingTrailPoint = { x: number; y: number; arc: number };

type XY = { x: number; y: number; arc: number };

function catmullRom(p0: XY, p1: XY, p2: XY, p3: XY, t: number): { x: number; y: number } {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x: 0.5 * (
            2 * p1.x
            + (-p0.x + p2.x) * t
            + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
            + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        y: 0.5 * (
            2 * p1.y
            + (-p0.y + p2.y) * t
            + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
            + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        ),
    };
}

/** Resample the trail along a smooth Catmull-Rom spline (~stepPx apart). */
export function densifySmoothTrail(points: MarkingTrailPoint[], stepPx = 3): XY[] {
    if (points.length === 0) return [];
    if (points.length === 1) return [{ ...points[0] }];

    const dense: XY[] = [{ ...points[0] }];
    let arc = points[0].arc;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(2, Math.ceil(chord / stepPx));

        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const { x, y } = catmullRom(p0, p1, p2, p3, t);
            const prev = dense[dense.length - 1];
            const seg = Math.hypot(x - prev.x, y - prev.y);
            if (seg < stepPx * 0.35) continue;
            arc += seg;
            dense.push({ x, y, arc });
        }
    }

    return dense;
}

export function pushMarkingTrailPoint(
    trail: MarkingTrailPoint[],
    x: number,
    y: number,
    minDistSq = 2.25,
): MarkingTrailPoint[] {
    const last = trail[trail.length - 1];
    let arc = last?.arc ?? 0;
    if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) return trail;
        arc += Math.sqrt(distSq);
    }
    const next = [...trail, { x, y, arc }];
    const cutoff = arc - MARKING_TRAIL_FADE_PX - 24;
    let start = 0;
    while (start < next.length - 2 && next[start].arc < cutoff) {
        start += 1;
    }
    return start > 0 ? next.slice(start) : next;
}

function fadeAt(behind: number, fadeLen: number): number {
    if (behind <= 0) return 1;
    if (behind >= fadeLen) return 0;
    const t = behind / fadeLen;
    return 1 - t * t;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace(/^#/, '');
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16),
        };
    }
    if (h.length >= 6) {
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    return { r: 255, g: 255, b: 255 };
}

/** Subtle marking trail — single hairline, distance fade, no glow. */
export function drawMarkingTrail(
    ctx: CanvasRenderingContext2D,
    points: MarkingTrailPoint[],
    size: number,
    fadeLen = MARKING_TRAIL_FADE_PX,
    trailColor = '#ffffff',
): void {
    ctx.clearRect(0, 0, size, size);
    if (points.length < 2) return;

    const smooth = densifySmoothTrail(points, 3);
    if (smooth.length < 2) return;

    const headArc = smooth[smooth.length - 1].arc;
    const { r, g, b } = hexToRgb(trailColor);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < smooth.length; i++) {
        const prev = smooth[i - 1];
        const curr = smooth[i];
        const behind = headArc - curr.arc;
        const alpha = fadeAt(behind, fadeLen);
        if (alpha < 0.03) continue;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.22})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}
