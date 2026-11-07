import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { WalletScreen } from "@/components/screens/WalletScreen";

export default async function CarteiraPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profProfile = await prisma.professionalProfile.findUnique({
    where: { userId: user.id },
    select: { verificationStatus: true },
  });

  return (
    <WalletScreen
      user={{
        name: user.name,
        tradeName: user.tradeName ?? null,
        verificationStatus: profProfile?.verificationStatus ?? "NAO_VERIFICADO",
      }}
    />
  );
}
