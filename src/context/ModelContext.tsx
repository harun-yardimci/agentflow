import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ModelDef, ProviderDef } from '@/lib/api';
import * as api from '@/lib/api';

interface ModelContextValue {
  providers: ProviderDef[];
  models: ModelDef[];
  loading: boolean;
  refresh: () => Promise<void>;
  getModel: (id: string) => ModelDef | undefined;
  getProviderModels: (providerId: string) => ModelDef[];
  getProviderForModel: (modelId: string) => ProviderDef | undefined;
  getProviderKey: (modelId: string) => string;
}

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.fetchModelsAndProviders();
      setProviders(data.providers);
      setModels(data.models);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const modelMap = useMemo(() => {
    const map = new Map<string, ModelDef>();
    for (const m of models) {
      map.set(m.id, m);
    }
    return map;
  }, [models]);

  const providerMap = useMemo(() => {
    const map = new Map<string, ProviderDef>();
    for (const p of providers) {
      map.set(p.id, p);
    }
    return map;
  }, [providers]);

  const getModel = useCallback((id: string) => modelMap.get(id), [modelMap]);

  const getProviderModels = useCallback(
    (providerId: string) => models.filter((m) => m.provider === providerId),
    [models],
  );

  const getProviderForModel = useCallback(
    (modelId: string) => {
      const model = modelMap.get(modelId);
      return model ? providerMap.get(model.provider) : undefined;
    },
    [modelMap, providerMap],
  );

  const getProviderKey = useCallback(
    (modelId: string) => {
      const model = modelMap.get(modelId);
      if (model) return model.provider;
      // Fallback: parse prefix
      const prefix = modelId.split(':')[0];
      return prefix ?? 'claude';
    },
    [modelMap],
  );

  return (
    <ModelContext.Provider
      value={{
        providers,
        models,
        loading,
        refresh,
        getModel,
        getProviderModels,
        getProviderForModel,
        getProviderKey,
      }}
    >
      {children}
    </ModelContext.Provider>
  );
}

export function useModels() {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error('useModels must be used within ModelProvider');
  return ctx;
}
