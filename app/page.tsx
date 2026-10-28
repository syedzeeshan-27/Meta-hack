import type { Metadata } from "next";
import Home from "@/components/Home";

export const metadata: Metadata = {
  title: "Deposit Guard",
  description: "Film your flat at move-in and move-out. Only new damage counts against your deposit.",
};

export default function HomePage() {
  return <Home />;
}
