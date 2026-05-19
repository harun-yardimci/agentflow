import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { Agent } from '@/types';
import * as api from '@/lib/api';

interface AgentContextValue {
  agents: Agent[];
  loading: boolean;
  refresh: () => Promise<void>;
  updateAgent: (id: string, update: Partial<Agent>) => Promise<void>;
  addAgent: (agent: Omit<Agent, 'id'>) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.fetchAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateAgent = useCallback(async (id: string, update: Partial<Agent>) => {
    await api.updateAgent(id, update);
    await refresh();
  }, [refresh]);

  const addAgent = useCallback(async (agent: Omit<Agent, 'id'>): Promise<Agent> => {
    const created = await api.createAgent(agent);
    await refresh();
    return created;
  }, [refresh]);

  const deleteAgent = useCallback(async (id: string) => {
    await api.deleteAgent(id);
    await refresh();
  }, [refresh]);

  return (
    <AgentContext.Provider value={{ agents, loading, refresh, updateAgent, addAgent, deleteAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgents() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgents must be used within AgentProvider');
  return ctx;
}
