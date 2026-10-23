import { CheckoutScreen } from "@/components/screens/CheckoutScreen";

export default function CheckoutPage({ params }: { params: { hiringId: string } }) {
  return <CheckoutScreen hiringId={params.hiringId} />;
}
