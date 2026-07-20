/** Path length (px) behind the cursor before the trail fully fades out. */
export const MARKING_TRAIL_FADE_PX = 220;

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
    const cutoff = arc - MARKING_TRAIL_FADE_PX - 32;
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
    // Smoothstep-ish tail — soft dissolve, no hard cutoff
    return (1 - t) * (1 - t) * (3 - 2 * (1 - t));
}

/** Paint a smooth comet trail onto a square canvas matching the pie viewBox. */
export function drawMarkingTrail(
    ctx: CanvasRenderingContext2D,
    points: MarkingTrailPoint[],
    size: number,
    fadeLen = MARKING_TRAIL_FADE_PX,
): void {
    ctx.clearRect(0, 0, size, size);
    if (points.length < 2) return;

    const smooth = densifySmoothTrail(points, 2.5);
    if (smooth.length < 2) return;

    const headArc = smooth[smooth.length - 1].arc;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Wide soft bloom (additive)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(5px)';
    for (let i = 1; i < smooth.length; i++) {
        const prev = smooth[i - 1];
        const curr = smooth[i];
        const behind = headArc - curr.arc;
        const alpha = fadeAt(behind, fadeLen);
        if (alpha < 0.02) continue;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = `rgba(139, 92, 246, ${alpha * 0.42})`;
        ctx.lineWidth = 6 + alpha * 14;
        ctx.stroke();
    }
    ctx.restore();

    // Mid violet sheen
    for (let i = 1; i < smooth.length; i++) {
        const prev = smooth[i - 1];
        const curr = smooth[i];
        const behind = headArc - curr.arc;
        const alpha = fadeAt(behind, fadeLen);
        if (alpha < 0.02) continue;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = `rgba(196, 181, 253, ${alpha * 0.5})`;
        ctx.lineWidth = 2 + alpha * 4;
        ctx.stroke();
    }

    // Bright core — thins toward tail
    for (let i = 1; i < smooth.length; i++) {
        const prev = smooth[i - 1];
        const curr = smooth[i];
        const behind = headArc - curr.arc;
        const alpha = fadeAt(behind, fadeLen);
        if (alpha < 0.02) continue;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.72})`;
        ctx.lineWidth = 0.8 + alpha * 2.2;
        ctx.stroke();
    }

    const head = points[points.length - 1];
    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 18);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    glow.addColorStop(0.25, 'rgba(216, 180, 254, 0.45)');
    glow.addColorStop(0.55, 'rgba(139, 92, 246, 0.12)');
    glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
    ctx.fill();
}
