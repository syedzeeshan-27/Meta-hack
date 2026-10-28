import type { ReactNode } from "react";
import { CameraIcon, Card, ShareIcon, ShieldIcon } from "@/components/ui";

// Tints follow the app's colour language: amber = logged at move-in, red = new at move-out, green = done.
const steps: { icon: ReactNode; tint: string; title: string; body: string }[] = [
  {
    icon: <CameraIcon />,
    tint: "bg-existing/12 text-existing",
    title: "Film at move-in",
    body: "Walk through each room. Marks that are already there get outlined and logged.",
  },
  {
    icon: <ShieldIcon />,
    tint: "bg-new/10 text-new",
    title: "Film at move-out",
    body: "Walk through again when you leave. Only damage that wasn't there before counts.",
  },
  {
    icon: <ShareIcon />,
    tint: "bg-ok/10 text-ok",
    title: "Share the report",
    body: "A link with before-and-after photos and fair repair costs, ready for your landlord.",
  },
];

export function EmptyState() {
  return (
    <Card>
      <h2 className="text-xl font-semibold leading-[26px]">How it works</h2>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((s, n) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-full ${s.tint}`}>
              {s.icon}
            </span>
            <div className="min-w-0">
              <p className="font-medium">
                <span className="text-muted">{n + 1}</span> {s.title}
              </p>
              <p className="mt-0.5 text-sm text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
