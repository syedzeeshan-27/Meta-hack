// The shareable repair card: /r/{id}.
import type { Metadata } from "next";
import { Suspense } from "react";
import { RepairCardView } from "@/components/card/RepairCardView";
import { ReportShell, StatusPanel } from "@/components/report/ReportShell";
import { ButtonLink } from "@/components/ui/Button";
import { getRepair } from "@/lib/store";

export const metadata: Metadata = {
  title: "Repair card · FixCam",
  description: "What was wrong, how it was found, and how it was fixed.",
  robots: { index: false, follow: false },
};

export default function RepairCardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ReportShell>
      <Suspense fallback={<StatusPanel icon="busy" title="Loading repair card…" />}>
        {params.then(({ id }) => (
          <CardLoader id={id} />
        ))}
      </Suspense>
    </ReportShell>
  );
}

async function CardLoader({ id }: { id: string }) {
  const card = await getRepair(id);
  if (!card) {
    return (
      <StatusPanel
        icon="alert"
        title="Repair card not found"
        action={
          <ButtonLink href="/" variant="secondary">
            Go to FixCam
          </ButtonLink>
        }
      >
        <p>Check the link, or ask the person who sent it for a new one.</p>
      </StatusPanel>
    );
  }
  return <RepairCardView card={card} />;
}
