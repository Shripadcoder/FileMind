import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";

export default function PlaceholderPage({ title }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} sub="This page doesn't exist." />
      <p className="text-sm text-slate-500">
        <Link to="/" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
