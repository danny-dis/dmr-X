import { CreditCard, Plus, ArrowUpRight, ArrowDownLeft, RefreshCw, DollarSign, TrendingUp, Clock } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { interpretError } from '@/components/primitives/ErrorState';
import { StatTile } from '@/components/primitives/StatTile';
import { toast } from '@/components/primitives/Toast';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { useCreditBalance, useCreditTransactions, useTopupCredits } from '@/lib/queries/credits';

const TYPE_CONFIG: Record<string, { label: string; tone: 'success' | 'danger' | 'info' | 'warning'; icon: React.ReactNode }> = {
  topup: { label: 'Top-up', tone: 'success', icon: <ArrowUpRight className="size-3" /> },
  usage: { label: 'Usage', tone: 'danger', icon: <ArrowDownLeft className="size-3" /> },
  refund: { label: 'Refund', tone: 'info', icon: <RefreshCw className="size-3" /> },
  adjustment: { label: 'Adjustment', tone: 'warning', icon: <DollarSign className="size-3" /> },
};

export function CreditsPage() {
  const [topupOpen, setTopupOpen] = React.useState(false);
  const [topupAmount, setTopupAmount] = React.useState('');
  const [topupDescription, setTopupDescription] = React.useState('');
  const balance = useCreditBalance(undefined, { refetchInterval: 10000 });
  const transactions = useCreditTransactions({ limit: 50 }, { refetchInterval: 15000 });
  const topupCredits = useTopupCredits();
  const isSubmitting = topupCredits.isPending;

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      await topupCredits.mutateAsync({ amountCents: Math.round(amount * 100), description: topupDescription || undefined });
      toast.success('Credits added', { description: `${formatCurrency(amount)} added to your account` });
      setTopupOpen(false);
      setTopupAmount('');
      setTopupDescription('');
    } catch (err) {
      const interpreted = interpretError(err);
      toast.error(interpreted.title, { description: interpreted.description });
    }
  };

  const bal = balance.data;
  const txs = transactions.data?.transactions ?? [];

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Credits & Balance"
        description="Prepaid credit management, top-ups, and transaction history"
        icon={<CreditCard className="size-5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void balance.refetch()}
              leftIcon={<RefreshCw className="size-3" />}
              aria-label="Refresh balance"
            >
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setTopupOpen(true)}
              leftIcon={<Plus className="size-3" />}
              aria-label="Add credits"
            >
              Top up
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Current balance"
          value={bal ? formatCurrency(bal.balanceCents / 100) : '$0.00'}
          tone="success"
          icon={<DollarSign className="size-3.5" />}
        />
        <StatTile
          label="Total topped up"
          value={bal ? formatCurrency(bal.totalTopupCents / 100) : '$0.00'}
          tone="primary"
          icon={<TrendingUp className="size-3.5" />}
        />
        <StatTile
          label="Total used"
          value={bal ? formatCurrency(bal.totalUsedCents / 100) : '$0.00'}
          tone="warning"
          icon={<ArrowDownLeft className="size-3.5" />}
        />
        <StatTile
          label="Transactions"
          value={formatNumber(txs.length)}
          tone="accent"
          icon={<Clock className="size-3.5" />}
        />
      </div>

      {/* Balance Card */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Balance Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <DataState
            data={bal}
            isLoading={balance.isLoading}
            error={balance.error}
            onRetry={balance.refetch}
            skeletonRows={1}
            empty={{
              title: 'No credit account yet',
              description: 'Create an account and top up to start using prepaid credits.',
              action: <Button size="sm" onClick={() => setTopupOpen(true)} leftIcon={<Plus className="size-3" />}>
                Create account & top up
              </Button>,
            }}
          >
            {(data) => (
              <div className="flex items-center gap-8">
                <div>
                  <div className="text-3xl font-bold text-fg">
                    {formatCurrency(data.balanceCents / 100)}
                  </div>
                  <div className="text-sm text-fg-muted mt-1">Available balance</div>
                </div>
                <div className="h-12 w-px bg-border" />
                <div className="flex-1">
                  <div className="text-sm text-fg-muted mb-2">Usage breakdown</div>
                  <div className="flex gap-4">
                    <div>
                      <div className="text-lg font-semibold">{formatCurrency(data.totalTopupCents / 100)}</div>
                      <div className="text-xs text-fg-muted">Total added</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-fg">{formatCurrency(data.totalUsedCents / 100)}</div>
                      <div className="text-xs text-fg-muted">Total spent</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DataState>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <DataState
            data={transactions.data?.transactions}
            isLoading={transactions.isLoading}
            error={transactions.error}
            onRetry={transactions.refetch}
            skeletonRows={4}
            empty={{
              icon: <CreditCard className="size-8" />,
              title: 'No transactions yet',
              description: 'Top up your balance to start using credits',
            }}
          >
            {(txs) => (
              <div className="space-y-1">
                {txs.map((tx) => {
                  const config = TYPE_CONFIG[tx.type] ?? TYPE_CONFIG.adjustment;
                  const isPositive = tx.type === 'topup' || tx.type === 'refund';
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-surface-2 transition-colors"
                    >
                      <div className="p-1.5 rounded-full bg-surface-3">
                        {config.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge size="sm" tone={config.tone}>
                            {config.label}
                          </Badge>
                          {tx.description && (
                            <span className="text-xs text-fg-muted truncate">{tx.description}</span>
                          )}
                        </div>
                        <div className="text-xs text-fg-subtle mt-0.5">
                          {new Date(tx.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono text-sm font-medium ${isPositive ? 'text-success' : 'text-danger'}`}>
                          {isPositive ? '+' : '-'}{formatCurrency(Math.abs(tx.amountCents) / 100)}
                        </div>
                        <div className="text-xs text-fg-subtle">
                          Balance: {formatCurrency(tx.balanceAfterCents / 100)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataState>
        </CardContent>
      </Card>

      {/* Top-up Dialog */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Top up credits</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Amount (USD)</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="10.00"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
                <Input
                  placeholder="Monthly budget"
                  value={topupDescription}
                  onChange={(e) => setTopupDescription(e.target.value)}
                />
              </div>
              {topupAmount && !isNaN(parseFloat(topupAmount)) && (
                <div className="p-3 rounded-lg bg-surface-2 text-sm">
                  <div className="flex justify-between">
                    <span>Top-up amount</span>
                    <span className="font-medium">{formatCurrency(parseFloat(topupAmount))}</span>
                  </div>
                  {bal && (
                    <div className="flex justify-between mt-1 text-fg-muted">
                      <span>Current balance</span>
                      <span>{formatCurrency(bal.balanceCents / 100)}</span>
                    </div>
                  )}
                  {bal && (
                    <div className="flex justify-between mt-1 font-medium border-t border-border pt-1">
                      <span>New balance</span>
                      <span className="text-fg">
                        {formatCurrency((bal.balanceCents / 100) + parseFloat(topupAmount || '0'))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTopupOpen(false)}>Cancel</Button>
            <Button
              onClick={handleTopup}
              disabled={!topupAmount || isNaN(parseFloat(topupAmount)) || parseFloat(topupAmount) <= 0}
              loading={isSubmitting}
              leftIcon={<Plus className="size-3" />}
            >
              Top up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
