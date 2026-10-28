// The shareable deposit report: /r/{move-out inspection id}.
import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalysingPanel } from "@/components/report/AnalysingPanel";
import { AutoRefresh } from "@/components/report/AutoRefresh";
import { Report } from "@/components/report/Report";
import { ReportHeader } from "@/components/report/ReportHeader";
import { ReportShell, StatusPanel } from "@/components/report/ReportShell";
import { frameCount } from "@/components/report/resolve";
import { ButtonLink } from "@/components/ui/Button";
import { getComparison, getInspection } from "@/lib/store";

export const metadata: Metadata = {
  title: "Deposit inspection report",
  description: "Move-in and move-out photos compared: only new damage is chargeable.",
  robots: { index: false, follow: false },
};

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ReportShell>
      <Suspense
        fallback={
          <>
            <ReportHeader />
            <StatusPanel icon="busy" title="Loading report…" />
          </>
        }
      >
        {params.then(({ id }) => (
          <ReportLoader id={id} />
        ))}
      </Suspense>
    </ReportShell>
  );
}

const homeLink = (
  <ButtonLink href="/" variant="secondary">
    Go to Deposit Guard
  </ButtonLink>
);

async function ReportLoader({ id }: { id: string }) {
  const moveOut = await getInspection(id);
  if (!moveOut) {
    return (
      <>
        <ReportHeader />
        <StatusPanel icon="alert" title="Report not found" action={homeLink}>
          <p>Check the link, or ask the person who sent it for a new one.</p>
        </StatusPanel>
      </>
    );
  }

  if (moveOut.kind === "move_in" || !moveOut.baselineId) {
    return (
      <>
        <ReportHeader property={moveOut.property} city={moveOut.city} moveInAt={moveOut.createdAt} />
        <StatusPanel title="This is the move-in record" action={homeLink}>
          <p>
            It&rsquo;s saved. The deposit report is made after the move-out walkthrough, by comparing the two
            walkthroughs photo by photo.
          </p>
        </StatusPanel>
      </>
    );
  }

  const [moveIn, comparison] = await Promise.all([getInspection(moveOut.baselineId), getComparison(id)]);
  if (!moveIn) {
    return (
      <>
        <ReportHeader property={moveOut.property} city={moveOut.city} />
        <StatusPanel icon="alert" title="Move-in record missing" action={homeLink}>
          <p>This report compares against a move-in record that can&rsquo;t be found, so it can&rsquo;t be shown.</p>
        </StatusPanel>
      </>
    );
  }

  if (!comparison) {
    const header = (
      <ReportHeader
        property={moveOut.property || moveIn.property}
        city={moveOut.city || moveIn.city}
        moveInAt={moveIn.createdAt}
        moveOutAt={moveOut.finishedAt}
      />
    );

    if (!moveOut.finishedAt) {
      return (
        <>
          {header}
          <StatusPanel icon="busy" title="Move-out walkthrough in progress">
            <p>The report starts as soon as the walkthrough is finished. This page updates by itself.</p>
          </StatusPanel>
          <AutoRefresh everyMs={3000} />
        </>
      );
    }

    return (
      <>
        {header}
        <AutoRefresh everyMs={3000} inspectionId={moveOut.id}>
          <AnalysingPanel startedAt={moveOut.finishedAt} photosIn={frameCount(moveIn)} photosOut={frameCount(moveOut)} />
        </AutoRefresh>
      </>
    );
  }

  return <Report moveIn={moveIn} moveOut={moveOut} comparison={comparison} />;
}
