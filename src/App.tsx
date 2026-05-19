import { useState } from 'react';
import type { PageId } from '@/types';
import { PipelineProvider, usePipelines } from '@/context/PipelineContext';
import { AgentProvider } from '@/context/AgentContext';
import { ModelProvider } from '@/context/ModelContext';
import SetupCheck from '@/components/onboarding/SetupCheck';
import { TopBar } from '@/components/layout/TopBar';
import { PipelinesPage } from '@/components/pipelines/PipelinesPage';
import { AgentsPage } from '@/components/agents/AgentsPage';
import { ModelsPage } from '@/components/models/ModelsPage';
import { SettingsPage } from '@/components/settings/SettingsPage';

function AppContent() {
  const [page, setPage] = useState<PageId>('pipelines');
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const { pipelines, loading } = usePipelines();

  const pendingCount = pipelines
    .flatMap((p) => p.tasks)
    .filter((t) => t.status === 'awaiting_approval').length;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-0">
        <span className="font-mono text-sm text-text-dim">Connecting to AgentFlow API...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-surface-0 text-text-primary">
      <TopBar page={page} setPage={setPage} pendingCount={pendingCount} />

      <div className="flex flex-1 overflow-hidden">
        {page === 'pipelines' && (
          <PipelinesPage
            newPipelineOpen={newPipelineOpen}
            onNewPipelineOpen={() => setNewPipelineOpen(true)}
            onNewPipelineClose={() => setNewPipelineOpen(false)}
          />
        )}
        {page === 'agents' && <AgentsPage />}
        {page === 'models' && <ModelsPage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SetupCheck>
      <PipelineProvider>
        <ModelProvider>
          <AgentProvider>
            <AppContent />
          </AgentProvider>
        </ModelProvider>
      </PipelineProvider>
    </SetupCheck>
  );
}
