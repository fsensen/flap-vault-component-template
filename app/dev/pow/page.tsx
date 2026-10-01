import { notFound } from "next/navigation";
import PowDemo from "./PowDemo";
export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.NODE_ENV !== "development" || process.env.FLAP_POW_LOCAL !== "1") notFound();
  return <PowDemo />;
}
