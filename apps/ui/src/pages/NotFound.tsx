import { Compass, ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';

export function NotFoundPage() {
  return (
    <PageContainer>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card padding="lg" className="max-w-md">
          <EmptyState
            size="lg"
            icon={<Compass className="size-10 text-fg-subtle" />}
            title="Page not found"
            description="The page you're looking for doesn't exist or has been moved."
            action={
              <div className="flex items-center gap-2 mt-2">
                <Button variant="ghost" asChild>
                  <Link to="/">
                    <ArrowLeft className="size-3" />
                    Back to dashboard
                  </Link>
                </Button>
                <Button asChild>
                  <Link to="/playground">
                    <Sparkles className="size-3" />
                    Try playground
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    </PageContainer>
  );
}
