import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { ApiError, knowledgeGraph } from "../lib/api";
import type { GraphEdge, GraphNode, GraphOut } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, EmptyState, PageHeader, Spinner } from "../components/ui";

const KIND_COLORS: Record<string, string> = {
  folder: "#d97706",
  file: "#4f46e5",
  goal: "#16a34a",
  task: "#9333ea",
  tag: "#db2777",
  category: "#64748b",
};

const KIND_ORDER = ["folder", "file", "goal", "task", "tag", "category"];
const ALL_KINDS = [...KIND_ORDER];
const NODE_R = 9;

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

interface Pt {
  x: number;
  y: number;
}

/* Deterministic force-directed layout (seeded PRNG, fixed iterations):
   repulsion separates clusters, springs keep related nodes close, gravity
   centers the result. Same data always yields the same picture. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Pt> {
  const rand = mulberry32(20240607);
  const pos = new Map<string, Pt>();
  const byKind = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (!byKind.has(n.kind)) byKind.set(n.kind, []);
    byKind.get(n.kind)?.push(n);
  }
  // Spread kinds around a circle so different types start separated.
  KIND_ORDER.forEach((kind, ki) => {
    const members = byKind.get(kind) ?? [];
    members.forEach((n, i) => {
      const angle = (2 * Math.PI * (ki / KIND_ORDER.length)) + (i / Math.max(members.length, 1)) * 1.1;
      const radius = 200 + (i % 5) * 40;
      pos.set(n.id, {
        x: Math.cos(angle) * radius + (rand() - 0.5) * 60,
        y: Math.sin(angle) * radius * 0.75 + (rand() - 0.5) * 60,
      });
    });
  });

  const adj = new Map<string, Array<{ to: string; rest: number }>>();
  const restFor = (rel: string) =>
    rel === "linked_to" ? 90 : rel === "version_of" || rel === "duplicate_of" ? 70 : 130;
  for (const e of edges) {
    const rest = restFor(e.rel);
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)?.push({ to: e.target, rest });
    adj.get(e.target)?.push({ to: e.source, rest });
  }

  const ids = nodes.map((n) => n.id);
  const iterations = ids.length > 220 ? 90 : 180;
  const REPEL = 110;
  for (let iter = 0; iter < iterations; iter += 1) {
    const cooling = 1 - iter / iterations;
    const force = new Map<string, Pt>(ids.map((id) => [id, { x: 0, y: 0 }]));
    // Pairwise repulsion (O(n^2) — fine under the backend's 400-node cap).
    for (let i = 0; i < ids.length; i += 1) {
      const a = pos.get(ids[i]) as Pt;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = pos.get(ids[j]) as Pt;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 24) {
          const angle = rand() * 2 * Math.PI;
          dx = Math.cos(angle) * 24;
          dy = Math.sin(angle) * 24;
          dist = 24;
        }
        const f = ((REPEL * REPEL) / dist) * 0.02 * cooling;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        const fa = force.get(ids[i]) as Pt;
        const fb = force.get(ids[j]) as Pt;
        fa.x += fx;
        fa.y += fy;
        fb.x -= fx;
        fb.y -= fy;
      }
    }
    // Springs along edges.
    for (const [id, neighbors] of adj) {
      const a = pos.get(id);
      if (!a) continue;
      for (const { to, rest } of neighbors) {
        const b = pos.get(to);
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const f = ((dist - rest) / rest) * 0.9 * cooling;
        const fa = force.get(id) as Pt;
        fa.x += (dx / dist) * f * rest * 0.05;
        fa.y += (dy / dist) * f * rest * 0.05;
      }
    }
    // Gentle gravity + integrate with clamped steps.
    for (const id of ids) {
      const p = pos.get(id) as Pt;
      const f = force.get(id) as Pt;
      let dx = f.x - p.x * 0.006;
      let dy = f.y - p.y * 0.006;
      const step = Math.hypot(dx, dy);
      const maxStep = 10 * cooling + 1;
      if (step > maxStep) {
        dx = (dx / step) * maxStep;
        dy = (dy / step) * maxStep;
      }
      pos.set(id, { x: p.x + dx, y: p.y + dy });
    }
  }
  // Recenter on centroid.
  let cx = 0;
  let cy = 0;
  for (const p of pos.values()) {
    cx += p.x;
    cy += p.y;
  }
  cx /= Math.max(pos.size, 1);
  cy /= Math.max(pos.size, 1);
  for (const [id, p] of pos) pos.set(id, { x: p.x - cx, y: p.y - cy });
  return pos;
}

function boundsOf(positions: Map<string, Pt>): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: -300, y: -200, w: 600, h: 400 };
  const pad = 90;
  return { x: minX - pad, y: minY - pad - 20, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 30 };
}

const REL_LABELS: Record<string, string> = {
  contains: "contains",
  tagged_with: "tagged",
  categorized_as: "category",
  linked_to: "linked",
  duplicate_of: "duplicate",
  version_of: "version",
  has_task: "task",
};

export default function Graph() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<GraphOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<string[]>(ALL_KINDS);
  const [depth, setDepth] = useState(2);
  const [focus, setFocus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [offsets, setOffsets] = useState<Record<string, Pt>>({});
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ mode: "pan" | "node"; start: Pt; nodeId?: string; moved: boolean } | null>(null);

  const load = useCallback(async () => {
    const [focusKind, focusId] = focus ? focus.split(":") : [];
    setSelectedId(null);
    setOffsets({});
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

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.35, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const positions = useMemo(
    () => (data ? layoutGraph(data.nodes, data.edges) : new Map<string, Pt>()),
    [data],
  );
  const frame = useMemo(() => boundsOf(positions), [positions]);
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;

  // Fit-to-view on every data load.
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [data]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const neighbors = useMemo(() => {
    if (!selected || !data) return [];
    const out: Array<{ edge: GraphEdge; node: (typeof data.nodes)[number] }> = [];
    for (const e of data.edges) {
      if (e.source === selected.id && byId.get(e.target)) {
        out.push({ edge: e, node: byId.get(e.target) as (typeof data.nodes)[number] });
      } else if (e.target === selected.id && byId.get(e.source)) {
        out.push({ edge: e, node: byId.get(e.source) as (typeof data.nodes)[number] });
      }
    }
    return out;
  }, [selected, data, byId]);
  const neighborIds = useMemo(
    () => new Set([selectedId, ...neighbors.map((n) => n.node.id)]),
    [selectedId, neighbors],
  );

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
      setOffsets((o) => {
        const prev = o[g.nodeId as string] ?? { x: 0, y: 0 };
        return { ...o, [g.nodeId as string]: { x: prev.x + dx, y: prev.y + dy } };
      });
      g.start = { x: e.clientX, y: e.clientY };
    }
  }

  function onUp(nodeId?: string) {
    const g = gesture.current;
    gesture.current = null;
    if (g && !g.moved) setSelectedId(nodeId ?? null);
  }

  function openLink(node: GraphNode): string | null {
    if (node.kind === "file") return `/files?open=${node.ref_id}`;
    if (node.kind === "goal") return `/goals?open=${node.ref_id}`;
    if (node.kind === "task" && node.goal_id) return `/goals?open=${node.goal_id}`;
    if (node.kind === "folder") return `/files?folder=${node.ref_id}`;
    return null;
  }

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <PageHeader title="Knowledge Graph" />
        <p className="text-sm text-slate-500">
          Sign in to explore your graph. <Link to="/login" className="underline">Go to sign in</Link>
        </p>
      </div>
    );
  }

  const edgeStroke = (rel: string) =>
    rel === "linked_to" ? "#16a34a" : rel === "duplicate_of" || rel === "version_of" ? "#d97706" : "#94a3b8";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Knowledge Graph"
        sub={
          data
            ? `${data.nodes.length} nodes · ${data.edges.length} relationships. Drag to pan, scroll to zoom, drag nodes to rearrange.`
            : "Mapping your files, goals, and how they connect."
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); setOffsets({}); }}>
              Reset view
            </Button>
            <Button variant="secondary" onClick={() => setZoom((z) => Math.min(3, z * 1.2))} aria-label="Zoom in">+</Button>
            <Button variant="secondary" onClick={() => setZoom((z) => Math.max(0.35, z / 1.2))} aria-label="Zoom out">−</Button>
          </>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Node kinds">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
              aria-pressed={kinds.includes(k)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                kinds.includes(k)
                  ? "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                  : "border-slate-200 text-slate-400 opacity-60 dark:border-slate-800"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS[k] }} />
              {k}s
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-slate-500">
          Depth
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-transparent px-1.5 py-1 text-sm dark:border-slate-700"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        {focus ? (
          <button onClick={() => setFocus(null)} className="text-sm text-indigo-600 underline dark:text-indigo-300">
            Clear focus ({focus})
          </button>
        ) : (
          <span className="text-sm text-slate-400">Select a node → Focus to explore its neighborhood.</span>
        )}
      </div>

      {!data ? (
        <Spinner label="Building graph…" />
      ) : data.nodes.length === 0 ? (
        <EmptyState
          icon={<Network size={28} />}
          title="Nothing to graph yet"
          hint="Upload files, create goals, and link them together — relationships appear here automatically."
        />
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row">
          <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
            <svg
              ref={svgRef}
              viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
              className="h-[440px] w-full touch-none md:h-[540px]"
              role="img"
              aria-label="Knowledge graph"
              onPointerDown={onBackgroundDown}
              onPointerMove={onMove}
              onPointerUp={() => onUp()}
              onPointerLeave={() => (gesture.current = null)}
            >
              <defs>
                <marker id="fm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
                </marker>
              </defs>
              <g transform={`translate(${cx + pan.x},${cy + pan.y}) scale(${zoom}) translate(${-cx},${-cy})`}>
                {data.edges.map((e, i) => {
                  const a = nodePos(e.source);
                  const b = nodePos(e.target);
                  const dimmed = selected && !(e.source === selected.id || e.target === selected.id);
                  const hot = hoverEdge === i;
                  return (
                    <g key={i} onPointerEnter={() => setHoverEdge(i)} onPointerLeave={() => setHoverEdge(null)}>
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={edgeStroke(e.rel)}
                        strokeWidth={hot ? 2.4 : e.rel === "linked_to" ? 1.8 : 1.1}
                        opacity={dimmed ? 0.12 : hot ? 1 : 0.6}
                        markerEnd="url(#fm-arrow)"
                      />
                      {/* Wide invisible hit area + hover label */}
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12}>
                        <title>{`${REL_LABELS[e.rel] ?? e.rel}${e.task_title ? ` · ${e.task_title}` : ""}${e.stem ? ` · ${e.stem}` : ""}`}</title>
                      </line>
                      {hot && (
                        <text
                          x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6}
                          textAnchor="middle" fontSize={11} fontWeight={600}
                          fill="#475569"
                          style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}
                        >
                          {REL_LABELS[e.rel] ?? e.rel}
                        </text>
                      )}
                    </g>
                  );
                })}
                {data.nodes.map((n) => {
                  const p = nodePos(n.id);
                  const dimmed = !!selected && !neighborIds.has(n.id);
                  const isFocus = data.focus === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      onPointerDown={(e) => onNodeDown(e, n.id)}
                      onPointerUp={() => onUp(n.id)}
                      className="cursor-grab"
                      opacity={dimmed ? 0.22 : 1}
                    >
                      <title>{`${n.kind}: ${n.label}`}</title>
                      <circle
                        r={NODE_R}
                        fill={KIND_COLORS[n.kind] ?? "#64748b"}
                        stroke={selectedId === n.id || isFocus ? "#4f46e5" : "white"}
                        strokeWidth={selectedId === n.id || isFocus ? 3 : 1.5}
                      />
                      {n.kind === "file" && n.favorite && (
                        <circle r={3} cx={6.5} cy={-6.5} fill="#fbbf24" stroke="white" strokeWidth={1} />
                      )}
                      <text
                        y={23} textAnchor="middle" fontSize={11} fontWeight={500}
                        fill="currentColor" opacity={0.9}
                        style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}
                        className="dark:[paint-order:stroke]"
                      >
                        {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800">
              <span className="font-semibold uppercase tracking-wide">Edges</span>
              <span><i className="mr-1 inline-block h-0.5 w-4 bg-green-500 align-middle" />goal link</span>
              <span><i className="mr-1 inline-block h-0.5 w-4 bg-amber-500 align-middle" />duplicate / version</span>
              <span><i className="mr-1 inline-block h-0.5 w-4 bg-slate-400 align-middle" />structure</span>
              {data.truncated && <span className="ml-auto">Truncated — focus on a node to narrow.</span>}
            </div>
          </div>

          <aside aria-label="Selected node" className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card xl:w-72 dark:border-slate-800 dark:bg-slate-900">
            {!selected ? (
              <div className="flex h-full min-h-24 flex-col justify-center text-sm text-slate-400">
                Select a node to inspect it. Hover an edge to see its relationship.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: KIND_COLORS[selected.kind] ?? "#64748b" }}
                    aria-hidden
                  />
                  <Badge tone={selected.kind === "file" ? "blue" : selected.kind === "goal" ? "green" : "slate"}>
                    {selected.kind}
                  </Badge>
                </div>
                <p className="break-words font-bold leading-snug">{selected.label}</p>
                <dl className="flex flex-col gap-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                  {selected.category && <div className="flex gap-1.5"><dt>Category:</dt><dd className="text-slate-700 dark:text-slate-200">{selected.category}</dd></div>}
                  {selected.goal_type && <div className="flex gap-1.5"><dt>Type:</dt><dd className="text-slate-700 dark:text-slate-200">{selected.goal_type}</dd></div>}
                  {selected.status && <div className="flex gap-1.5"><dt>Status:</dt><dd className="text-slate-700 dark:text-slate-200">{selected.status}</dd></div>}
                  {selected.mime && <div className="flex gap-1.5"><dt className="shrink-0">MIME:</dt><dd className="break-all text-slate-700 dark:text-slate-200">{selected.mime}</dd></div>}
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="secondary" onClick={() => { setFocus(selected.id); }} className="!px-2.5 !py-1 !text-xs">
                    Focus neighborhood
                  </Button>
                  {openLink(selected) && (
                    <Link
                      to={openLink(selected) as string}
                      className="inline-flex items-center rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      Open
                    </Link>
                  )}
                </div>
                <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Relationships ({neighbors.length})
                  </p>
                  {neighbors.length === 0 ? (
                    <p className="text-xs text-slate-400">No connections.</p>
                  ) : (
                    <ul className="fm-scroll flex max-h-56 flex-col gap-1 overflow-y-auto">
                      {neighbors.map(({ edge, node }) => (
                        <li key={`${edge.source}-${edge.target}-${edge.rel}`} className="flex items-center gap-1.5 text-xs">
                          <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-medium text-slate-500 dark:bg-slate-800">
                            {REL_LABELS[edge.rel] ?? edge.rel}
                          </span>
                          <button
                            onClick={() => setSelectedId(node.id)}
                            className="min-w-0 flex-1 truncate text-left hover:underline"
                            title={node.label}
                          >
                            {node.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
