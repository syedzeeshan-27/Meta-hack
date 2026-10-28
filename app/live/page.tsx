import type { Metadata } from "next";
import LiveView from "@/components/LiveView";

export const metadata: Metadata = { title: "FixCam Live" };

export default function LivePage() {
  return <LiveView />;
}
