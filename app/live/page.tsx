import type { Metadata } from "next";
import LiveView from "@/components/LiveView";

export const metadata: Metadata = { title: "Ask · Deposit Guard" };

export default function LivePage() {
  return <LiveView />;
}
