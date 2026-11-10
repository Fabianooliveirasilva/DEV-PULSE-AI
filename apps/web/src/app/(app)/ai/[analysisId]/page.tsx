'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/page';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { AnalysisBody, useAnalysis } from '@/features/ai/analysis-view';
import { errorMessage } from '@/lib/api';

export default function AnalysisPage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const { data, isPending, error, refetch } = useAnalysis(analysisId);
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-96" />;
  const subject = data.incident
    ? { href: `/incidents/${data.incident.id}`, label: data.incident.title }
    : data.errorGroup
      ? { href: `/logs/groups/${data.errorGroup.id}`, label: data.errorGroup.title }
      : null;
  return (
    <>
      <Link
        href="/ai"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> AI Intelligence
      </Link>
      <Card className="max-w-3xl">
        <CardHeader>
          <div>
            <CardTitle>Analysis</CardTitle>
            {subject && (
              <Link href={subject.href} className="text-sm text-accent-text hover:underline">
                {subject.label}
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <AnalysisBody analysis={data} />
        </CardContent>
      </Card>
    </>
  );
}
