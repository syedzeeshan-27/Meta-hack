import type { Comparison, Inspection } from "@/lib/inspect/types";
import { EvidenceFooter } from "./EvidenceFooter";
import { ReportHeader } from "./ReportHeader";
import { photoCount, resolveFindings, roomOrder } from "./resolve";
import { RoomSection } from "./RoomSection";
import { Summary } from "./Summary";

const totalPhotos = (i: Inspection) => i.rooms.reduce((n, r) => n + r.frames.length, 0);

/** The finished report: header, summary, room by room, items not seen, evidence. */
export function Report({ moveIn, moveOut, comparison }: { moveIn: Inspection; moveOut: Inspection; comparison: Comparison }) {
  const findings = resolveFindings(moveIn, moveOut, comparison.findings);
  const rooms = roomOrder(moveIn, moveOut, comparison);
  const count = (status: string) => findings.filter((f) => f.status === status).length;

  return (
    <>
      <ReportHeader
        property={moveOut.property || moveIn.property}
        city={moveOut.city || moveIn.city}
        moveInAt={moveIn.createdAt}
        moveOutAt={moveOut.finishedAt ?? moveOut.createdAt}
        reportId={moveOut.id}
      />

      <Summary
        newCount={count("new")}
        existingCount={count("pre_existing")}
        wearCount={count("wear")}
        total={comparison.total}
        photosIn={totalPhotos(moveIn)}
        photosOut={totalPhotos(moveOut)}
        roomCount={rooms.length}
      />

      <div className="mt-12">
        <h2 className="text-sm font-semibold tracking-wide text-(color:--muted) uppercase">Room by room</h2>
        {rooms.map((room) => (
          <RoomSection
            key={room}
            room={room}
            findings={findings.filter((f) => f.room === room)}
            photosIn={photoCount(moveIn, room)}
            photosOut={photoCount(moveOut, room)}
          />
        ))}
      </div>

      {comparison.missingItems.length > 0 && (
        <section className="mt-12 print:break-inside-avoid" aria-labelledby="missing-title">
          <h2 id="missing-title" className="text-2xl font-semibold tracking-tight">
            Not seen at move-out
          </h2>
          <p className="mt-2 max-w-prose leading-relaxed text-(color:--muted)">
            Listed at move-in but not spotted in the move-out photos. They may simply have been out of frame.
          </p>
          <ul className="mt-3 divide-y divide-(--line) rounded-xl border border-(--line) bg-(--card) px-4">
            {comparison.missingItems.map((m, i) => (
              <li key={`${m.room}-${m.item}-${i}`} className="flex justify-between gap-4 py-3">
                <span className="font-medium">{m.item}</span>
                <span className="text-(color:--muted)">{m.room}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EvidenceFooter moveIn={moveIn} moveOut={moveOut} models={comparison.models} generatedAt={comparison.createdAt} />
    </>
  );
}
