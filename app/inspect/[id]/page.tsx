import type { Metadata } from "next";
import { Suspense } from "react";
import Walkthrough from "@/components/Walkthrough";

export const metadata: Metadata = { title: "Walkthrough · Deposit Guard" };

type Params = Promise<{ id: string }>;

// Cache Components is on: the id is request data, so it's read inside a Suspense boundary.
export default function InspectPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<main className="h-dvh w-full bg-black" />}>
      <WalkthroughFor params={params} />
    </Suspense>
  );
}

async function WalkthroughFor({ params }: { params: Params }) {
  const { id } = await params;
  return <Walkthrough id={id} />;
}
