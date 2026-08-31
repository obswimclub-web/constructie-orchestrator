interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-white border border-slate-200 rounded-xl shadow-sm">
      <h2 className="text-2xl font-bold text-slate-900 mb-2">{title}</h2>
      <p className="text-slate-500 max-w-md">{description}</p>
      <div className="mt-8 px-4 py-2 bg-slate-100 text-slate-500 rounded-md text-sm font-medium border border-slate-200">
        Coming in next work package
      </div>
    </div>
  );
}
