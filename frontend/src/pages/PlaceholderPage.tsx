export default function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm text-slate-500">
        Empty state — no records yet. Full functionality ships in {phase}. This route exists so every navigation item
        works from day one.
      </p>
    </div>
  );
}
