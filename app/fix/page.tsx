import type { Metadata } from "next";
import FixView from "@/components/fix/FixView";

export const metadata: Metadata = {
  title: "Fix it · FixCam",
  description: "Point your camera at something broken and talk. FixCam finds the cause and walks you through the fix.",
};

export default function FixPage() {
  return <FixView />;
}
