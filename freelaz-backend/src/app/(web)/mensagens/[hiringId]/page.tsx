import { ChatScreen } from "@/components/screens/ChatScreen";

export default function ConversaPage({ params }: { params: { hiringId: string } }) {
  return <ChatScreen hiringId={params.hiringId} />;
}
