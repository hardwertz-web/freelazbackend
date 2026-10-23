import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { HomeScreen } from "@/components/screens/HomeScreen";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <HomeScreen userName={user.name} />;
}
