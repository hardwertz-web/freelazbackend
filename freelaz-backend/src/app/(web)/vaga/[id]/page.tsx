import { JobDetailScreen } from "@/components/screens/JobDetailScreen";

export default function VagaPage({ params }: { params: { id: string } }) {
  return <JobDetailScreen jobId={params.id} />;
}
