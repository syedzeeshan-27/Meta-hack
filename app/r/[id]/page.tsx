// The shareable deposit report: /r/{move-out inspection id}.
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/report/AutoRefresh";
import { Report } from "@/components/report/Report";
import { ReportShell, StatusPanel } from "@/components/report/ReportShell";
import { getComparison, getInspection } from "@/lib/store";

export const metadata: Metadata = {
  title: "Deposit inspection report",
  description: "Move-in and move-out photos compared: only new damage is chargeable.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ReportShell>
      <Suspense fallback={<StatusPanel title="Loading report…" busy />}>
        {params.then(({ id }) => (
          <ReportLoader id={id} />
        ))}
      </Suspense>
    </ReportShell>
  );
}

async function ReportLoader({ id }: { id: string }) {
  const moveOut = await getInspection(id);
  if (!moveOut) {
    return (
      <StatusPanel title="Report not found">
        <p>Check the link, or ask the person who sent it for a new one.</p>
      </StatusPanel>
    );
  }

  if (moveOut.kind === "move_in" || !moveOut.baselineId) {
    return (
      <StatusPanel title="Move-in record saved">
        <p>
          {moveOut.property}
          {moveOut.city && `, ${moveOut.city}`}. The deposit report is created after the move-out walkthrough, by
          comparing it with this record.
        </p>
      </StatusPanel>
    );
  }

  const [moveIn, comparison] = await Promise.all([getInspection(moveOut.baselineId), getComparison(id)]);
  if (!moveIn) {
    return (
      <StatusPanel title="Move-in record missing">
        <p>This report compares against a move-in record that can&rsquo;t be found, so it can&rsquo;t be shown.</p>
      </StatusPanel>
    );
  }

  if (!comparison) {
    const walking = !moveOut.finishedAt;
    return (
      <>
        <StatusPanel title={walking ? "Move-out walkthrough in progress" : "Analysing…"} busy>
          <p>
            {walking
              ? "The report starts once the move-out walkthrough is finished."
              : "Comparing the move-out photos with the move-in record and checking local repair prices."}
          </p>
          <p className="text-base">This page refreshes every few seconds.</p>
        </StatusPanel>
        <AutoRefresh everyMs={3000} inspectionId={walking ? undefined : moveOut.id} />
      </>
    );
  }

  return <Report moveIn={moveIn} moveOut={moveOut} comparison={comparison} />;
}
