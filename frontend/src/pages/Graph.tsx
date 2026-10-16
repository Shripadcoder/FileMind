import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, knowledgeGraph } from "../lib/api";
import type { GraphEdge, GraphNode, GraphOut } from "../lib/api";
import { useAuth } from "../lib/auth";

const KIND_COLORS: Record<string, string> = {
  folder: "#f59e0b",
  file: "#3b82f6",
  goal: "#22c55e",
  task: "#a855f7",
  tag: "#ec4899",
  category: "#64748b",
};

const KIND_ORDER = ["folder", "file", "goal", "task", "tag", "category"];
const ALL_KINDS = [...KIND_ORDER];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

interface Pt {
  x: number;
  y: number;
}

export default function Graph() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<GraphOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<string[]>(ALL_KINDS);
  const [depth, setDepth] = useState(2);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  // View transform (pan/zoom) + per-node drag offsets.
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [offsets, setOffsets] = useState<Record<string, Pt>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ mode: "pan" | "node"; start: Pt; nodeId?: string; moved: boolean } | null>(null);

  const load = useCallback(async () => {
    const [focusKind, focusId] = focus ? focus.split(":") : [];
    setData(
      await knowledgeGraph({
        focus_kind: focusKind || undefined,
        focus_id: focusId ? Number(focusId) : undefined,
        depth,
        kinds: kinds.length === ALL_KINDS.length ? undefined : kinds.join(",") || "none",
      }),
    );
  }, [focus, depth, kinds]);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(errMsg(e)));
  }, [user, load]);

  // Wheel zoom (native listener so preventDefault works).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.3, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const positions = useMemo(() => {
    if (!data) return new Map<string, Pt>();
    const pos = new Map<string, Pt>();
    if (data.focus && data.nodes.some((n) => n.id === data.focus)) {
      // Concentric rings around the focus by BFS distance.
      const adj = new Map<string, string[]>();
      for (const e of data.edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        if (!adj.has(e.target)) adj.set(e.target, []);
        adj.get(e.source)?.push(e.target);
        adj.get(e.target)?.push(e.source);
      }
      const dist = new Map<string, number>([[data.focus, 0]]);
      const queue = [data.focus];
      while (queue.length > 0) {
        const cur = queue.shift() as string;
        for (const nb of adj.get(cur) ?? []) {
          if (!dist.has(nb)) {
            dist.set(nb, (dist.get(cur) as number) + 1);
            queue.push(nb);
          }
        }
      }
      const rings = new Map<number, GraphNode[]>();
      for (const n of data.nodes) {
        const d = dist.get(n.id) ?? 9;
        if (!rings.has(d)) rings.set(d, []);
        rings.get(d)?.push(n);
      }
      for (const [d, members] of rings) {
        members.forEach((n, i) => {
          if (d === 0) {
            pos.set(n.id, { x: 0, y: 0 });
          } else {
            const angle = (2 * Math.PI * i) / Math.max(members.length, 1);
            pos.set(n.id, { x: Math.cos(angle) * d * 170, y: Math.sin(angle) * d * 130 });
          }
        });
      }
    } else {
      // Columns by kind.
      const byKind = new Map<string, GraphNode[]>();
      for (const n of data.nodes) {
        if (!byKind.has(n.kind)) byKind.set(n.kind, []);
        byKind.get(n.kind)?.push(n);
      }
      KIND_ORDER.forEach((kind, col) => {
        (byKind.get(kind) ?? []).forEach((n, i) => {
          pos.set(n.id, { x: (col - 2.5) * 220, y: (i - (byKind.get(kind)?.length ?? 1) / 2) * 56 });
        });
      });
    }
    return pos;
  }, [data]);

  function nodePos(id: string): Pt {
    const base = positions.get(id) ?? { x: 0, y: 0 };
    const off = offsets[id];
    return off ? { x: base.x + off.x, y: base.y + off.y } : base;
  }

  function onBackgroundDown(e: React.PointerEvent) {
    gesture.current = { mode: "pan", start: { x: e.clientX - pan.x, y: e.clientY - pan.y }, moved: false };
  }

  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    gesture.current = { mode: "node", start: { x: e.clientX, y: e.clientY }, nodeId: id, moved: false };
  }

  function onMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "pan") {
      setPan({ x: e.clientX - g.start.x, y: e.clientY - g.start.y });
      g.moved = true;
    } else if (g.nodeId) {
      const dx = (e.clientX - g.start.x) / zoom;
      const dy = (e.clientY - g.start.y) / zoom;
      if (Math.abs(e.clientX - g.start.x) + Math.abs(e.clientY - g.start.y) > 4) g.moved = true;
      // Incremental deltas: advance the gesture start each move.
      setOffsets((o) => {
        const prev = o[g.nodeId as string] ?? { x: 0, y: 0 };
        return { ...o, [g.nodeId as string]: { x: prev.x + dx, y: prev.y + dy } };
      });
      g.start = { x: e.clientX, y: e.clientY };
    }
  }

  function onUp(_e: React.PointerEvent, node?: GraphNode) {
    const g = gesture.current;
    gesture.current = null;
    if (g && !g.moved && node) setSelected(node);
    else if (g && !g.moved && !node) setSelected(null);
  }

  function openLink(node: GraphNode): string | null {
    if (node.kind === "file") return `/files?open=${node.ref_id}`;
    if (node.kind === "goal") return `/goals?open=${node.ref_id}`;
    if (node.kind === "task" && node.goal_id) return `/goals?open=${node.goal_id}`;
    if (node.kind === "folder") return `/files?folder=${node.ref_id}`;
    return null;
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Knowledge Graph</h1>
        <p className="text-sm text-slate-500">
          Sign in to explore your graph.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  const edgeColor = (rel: string) =>
    rel === "linked_to" ? "#22c55e" : rel === "duplicate_of" || rel === "version_of" ? "#f59e0b" : "#94a3b8";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Graph</h1>
          <p className="text-sm text-slate-500">
            {data ? `${data.nodes.length} nodes · ${data.edges.length} relationships` : "Loading…"}
            {data?.truncated ? " (truncated — focus on a node to narrow)" : ""} · drag to pan, scroll
            to zoom, drag nodes to rearrange.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setZoom(1);
              setOffsets({});
            }}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
          >
            Reset view
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Show:</span>
        {ALL_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1 capitalize">
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) =>
                setKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)))
              }
            />
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLORS[k] }} />
            {k}s
          </label>
        ))}
        <label className="ml-2 flex items-center gap-1 text-slate-500">
          Depth
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded border border-slate-200 bg-transparent px-1 py-0.5 dark:border-slate-700"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        {focus ? (
          <button onClick={() => setFocus(null)} className="underline">
            Clear focus ({focus})
          </button>
        ) : (
          <span className="text-slate-500">Click a node, then “Focus” to explore its neighborhood.</span>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <svg
          ref={svgRef}
          viewBox="-500 -320 1000 640"
          className="h-[480px] w-full flex-1 touch-none rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
          role="img"
          aria-label="Knowledge graph"
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={(e) => onUp(e)}
          onPointerLeave={() => (gesture.current = null)}
        >
          <g transform={`translate(${pan.x / zoom},${pan.y / zoom}) scale(${zoom})`}>
            {data?.edges.map((e: GraphEdge, i: number) => {
              const a = nodePos(e.source);
              const b = nodePos(e.target);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={edgeColor(e.rel)}
                  strokeWidth={e.rel === "linked_to" ? 2 : 1}
                  opacity={0.55}
                >
                  <title>{`${e.rel}${e.task_title ? ` (${e.task_title})` : ""}${e.stem ? ` [${e.stem}]` : ""}`}</title>
                </line>
              );
            })}
            {data?.nodes.map((n) => {
              const p = nodePos(n.id);
              const isFocus = data.focus === n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  onPointerDown={(e) => onNodeDown(e, n.id)}
                  onPointerUp={(e) => onUp(e, n)}
                  className="cursor-grab"
                >
                  <title>{`${n.kind}: ${n.label}`}</title>
                  <circle
                    r={n.kind === "file" || n.kind === "goal" ? 11 : 8}
                    fill={KIND_COLORS[n.kind] ?? "#64748b"}
                    stroke={selected?.id === n.id || isFocus ? "#0f172a" : "white"}
                    strokeWidth={selected?.id === n.id || isFocus ? 2.5 : 1.5}
                  />
                  {n.kind === "file" && n.favorite && (
                    <circle r={3.5} cx={7} cy={-7} fill="#fbbf24" stroke="white" strokeWidth={1} />
                  )}
                  <text y={22} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.85}>
                    {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <aside
          aria-label="Selected node"
          className="w-full shrink-0 rounded-xl border border-slate-200 p-3 text-sm lg:w-64 dark:border-slate-800"
        >
          {!selected ? (
            <p className="text-slate-500">Select a node to see details.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <span
                className="inline-block w-fit rounded px-1.5 text-xs capitalize text-white"
                style={{ background: KIND_COLORS[selected.kind] ?? "#64748b" }}
              >
                {selected.kind}
              </span>
              <p className="break-words font-bold">{selected.label}</p>
              {selected.category && <p className="text-slate-500">Category: {selected.category}</p>}
              {selected.goal_type && <p className="text-slate-500">Type: {selected.goal_type}</p>}
              {selected.status && <p className="text-slate-500">Status: {selected.status}</p>}
              {selected.mime && <p className="break-all text-slate-500">{selected.mime}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setFocus(selected.id);
                    setSelected(null);
                  }}
                  className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                >
                  Focus
                </button>
                {openLink(selected) && (
                  <Link
                    to={openLink(selected) as string}
                    className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                  >
                    Open
                  </Link>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800">
            <p className="font-semibold">Legend</p>
            <p>green edge = goal link · amber = duplicate/version · gray = structure</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
