import type { Metadata } from "next";
import { SumobotApp } from "./components/SumobotApp";

export const metadata: Metadata = {
  description: "Analyze the replays, build the bots, and code a real portfolio.",
};

export default function Home() {
  return <SumobotApp />;
}
