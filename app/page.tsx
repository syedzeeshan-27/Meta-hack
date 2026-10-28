import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "FixCam",
  description: "A repair technician in your phone: it finds what's wrong, checks it's safe, and walks you through the fix.",
};

export default function HomePage() {
  return <Landing />;
}
