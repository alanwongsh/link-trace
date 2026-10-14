import { redirect } from "next/navigation";
import { SetupForm } from "@/components/setup-form";
import { countUsers } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// First run only: creates the first org admin. Gone once any user exists.
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return <SetupForm configured={Boolean(process.env.ADMIN_PASSWORD)} />;
}
