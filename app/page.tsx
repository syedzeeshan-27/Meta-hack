import type { Metadata } from "next";
import Home from "@/components/Home";

export const metadata: Metadata = {
  title: "Deposit Guard",
  description: "Proof of your flat's condition, so your deposit comes back.",
};

export default function HomePage() {
  return <Home />;
}
